import type { RpcOutput } from "@getpaseo/plugin";
import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactElement, type RefObject } from "react";
import { FlatList, Pressable, Text, TextInput, View, type ViewToken } from "react-native";
import { filesRpc, palettesRpc, threadsRpc, type ChangedFile, type DiffMode, type ReviewThread, type SearchMatch } from "../shared/diff";
import { AskContext, useAskAgent } from "./ask";
import { readableSyntax } from "./colors";
import { commentKey } from "./comments";
import { FileBody, FileHeaderRow } from "./file-card";
import { useFileScroller } from "./file-scroller";
import { FileTree } from "./file-tree";
import { usePrefs } from "./prefs";
import { SearchContext } from "./search";
import { SearchBar } from "./search-bar";
import { SendBar } from "./send-bar";
import { Toolbar } from "./toolbar";
import { createStyles } from "./styles";
import { showThread } from "./threads-store";
import { useViewed } from "./useViewed";
import { listenFind, listenShortcuts } from "./web";

const CHANGE_CHECK_MS = 15 * 1000;
const SHORTCUTS: [string, string][] = [
  ["↓ / ↑  (j / k)", "Next / previous file"],
  ["v", "Toggle Viewed on the current file"],
  ["o", "Open / collapse the current file"],
  ["/", "Filter files"],
  ["⌘F", "Search the diff (Enter / Shift+Enter: next / previous match)"],
  ["?", "Show / hide this list"],
];

type FilesData = RpcOutput<typeof filesRpc>;

/** One row of the virtualised list: each file is a sticky header row followed by its body. */
interface ListItem {
  key: string;
  element: ReactElement;
  filePath: string | null;
}

export function DiffPanel({ workspaceId, theme, navigation }: PluginWorkspacePanelProps) {
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const listFiles = useRpc(filesRpc);
  const loadPalettes = useRpc(palettesRpc);
  const listThreads = useRpc(threadsRpc);
  const [prefs, setPrefs] = usePrefs();
  const [showHelp, setShowHelp] = useState(false);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  // Files are open unless viewed; an explicit chevron click wins until the mode changes.
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({});
  const [showFull, setShowFull] = useState<Record<string, boolean>>({});
  const [loadLarge, setLoadLarge] = useState<Record<string, boolean>>({});
  const listRef = useRef<FlatList<ListItem>>(null);
  const searchRef = useRef<TextInput>(null);
  const diffSearchRef = useRef<TextInput>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState<SearchMatch | null>(null);
  const styles = useMemo(() => createStyles(theme.colors, prefs.zoom), [theme, prefs.zoom]);

  const palettes = useQuery({ queryKey: ["diff-palettes"], queryFn: () => loadPalettes({}), staleTime: Infinity });
  const scheme = isDark(theme.colors.surface0) ? "dark" : "light";
  const rawSyntax = palettes.data?.palettes[prefs.syntaxTheme]?.[scheme];
  const syntax = useMemo(() => readableSyntax(rawSyntax ?? {}, theme.colors), [rawSyntax, theme.colors]);

  // `latest` is polled; the view shows `shown` and only moves to `latest` when the user clicks Update.
  const wantedMode = prefs.mode;
  const latest = useQuery({
    queryKey: ["diff-files", directory, wantedMode, prefs.hideWhitespace],
    queryFn: () => listFiles({ directory: directory ?? "", mode: wantedMode, ignoreWhitespace: prefs.hideWhitespace }),
    enabled: directory !== null,
    refetchInterval: CHANGE_CHECK_MS,
  });
  // "All layers" saved from a stacked branch means "Branch" on a branch that is not stacked.
  const mode: DiffMode = wantedMode === "stack" && latest.data && !latest.data.stack ? "branch" : wantedMode;
  const viewKey = `${directory}:${wantedMode}:${prefs.hideWhitespace}`;
  const [shown, setShown] = useState<{ key: string; data: FilesData } | null>(null);
  useEffect(() => {
    if (latest.data && shown?.key !== viewKey) setShown({ key: viewKey, data: latest.data });
  }, [latest.data, shown?.key, viewKey]);
  const data = shown?.key === viewKey ? shown.data : null;
  const pendingChanges = data && latest.data ? changedFiles(data, latest.data) : 0;
  const applyLatest = () => latest.data && setShown({ key: viewKey, data: latest.data });

  // GitHub review threads: fetched on open and on Refresh only, never polled (shared GraphQL budget).
  const threads = useQuery({
    queryKey: ["diff-threads", directory],
    queryFn: () => listThreads({ directory: directory ?? "" }),
    enabled: directory !== null && mode !== "uncommitted",
    staleTime: 2 * 60 * 1000,
  });
  const threadsByPath = useMemo(() => {
    const map = new Map<string, ReviewThread[]>();
    for (const thread of threads.data?.threads ?? []) map.set(thread.path, [...(map.get(thread.path) ?? []), thread]);
    return map;
  }, [threads.data]);

  const { viewed, update: updateViewed, ready: viewedReady } = useViewed(`${workspaceId}:${mode}`);
  const allFiles = data?.files ?? [];
  const hidden = {
    tests: prefs.hideTests ? allFiles.filter((file) => file.test).length : 0,
    generated: prefs.hideGenerated ? allFiles.filter((file) => file.generated).length : 0,
    translations: prefs.hideTranslations ? allFiles.filter((file) => file.translation).length : 0,
  };
  const fileList = allFiles.filter((file) => {
    const hiddenTest = prefs.hideTests && file.test;
    const hiddenGenerated = prefs.hideGenerated && file.generated;
    const hiddenTranslation = prefs.hideTranslations && file.translation;
    return !hiddenTest && !hiddenGenerated && !hiddenTranslation;
  });
  const ask = useAskAgent(workspaceId, data?.compareLabel ?? "", navigation);
  const { register, scrollToFile } = useFileScroller(listRef as RefObject<FlatList<unknown> | null>, fileList.map((file) => file.path));
  // Known from any mode's listing, so the toggle stays put while switching between them.
  const stackInfo = data?.stack ?? latest.data?.stack ?? null;
  // A "!" prefix records an explicit untick, so an unticked generated file is not auto-marked again.
  const isViewed = (file: ChangedFile) => viewed[file.path] === file.fingerprint;
  const isOpen = (file: ChangedFile) => openOverrides[file.path] ?? (!isViewed(file) && !file.generated);
  const seenBlob = (file: ChangedFile) => {
    const value = viewed[file.path];
    return value && !value.startsWith("!") && /^[0-9a-f]{40}$/.test(value) && mode !== "uncommitted" ? value : null;
  };
  const changedSinceViewed = (file: ChangedFile) => {
    const value = viewed[file.path];
    return value !== undefined && !value.startsWith("!") && !isViewed(file) && !file.generated;
  };

  // Generated files count as reviewed on sight, like GitHub collapsing them; a manual untick wins.
  useEffect(() => {
    if (!viewedReady) return;
    const changes: Record<string, string> = {};
    for (const file of allFiles) {
      const value = viewed[file.path];
      if (file.generated && value !== file.fingerprint && !value?.startsWith("!")) changes[file.path] = file.fingerprint;
    }
    if (Object.keys(changes).length > 0) updateViewed(changes);
  }, [allFiles, viewed, updateViewed, viewedReady]);
  const viewedCount = fileList.filter(isViewed).length;
  const allViewed = fileList.length > 0 && viewedCount === fileList.length;

  const switchMode = (next: DiffMode) => {
    setPrefs({ mode: next });
    setOpenOverrides({});
    setCurrentPath(null);
  };
  const toggleViewed = (file: ChangedFile) => {
    const nowViewed = !isViewed(file);
    updateViewed({ [file.path]: nowViewed ? file.fingerprint : file.generated ? `!${file.fingerprint}` : null });
    setOpenOverrides({ ...openOverrides, [file.path]: !nowViewed });
    // Collapsing the file being read would leave the scroll offset deep inside the files below it.
    if (nowViewed && file.path === currentPath) scrollToFile(file.path);
  };
  const toggleAllViewed = () => {
    updateViewed(
      Object.fromEntries(
        fileList.map((file) => [file.path, allViewed ? (file.generated ? `!${file.fingerprint}` : null) : file.fingerprint]),
      ),
    );
    setOpenOverrides(Object.fromEntries(fileList.map((file) => [file.path, allViewed])));
  };

  const items: ListItem[] = [];
  const sticky: number[] = [];
  if (data) {
    items.push({
      key: "summary",
      filePath: null,
      element: (
        <Text style={styles.summary}>
          {data.compareLabel} · {fileList.length} files ·{" "}
          <Text style={styles.additions}>+{fileList.reduce((sum, file) => sum + file.additions, 0)}</Text>{" "}
          <Text style={styles.deletions}>−{fileList.reduce((sum, file) => sum + file.deletions, 0)}</Text>
        </Text>
      ),
    });
  }
  if (latest.error) items.push({ key: "error", filePath: null, element: <Text style={styles.error}>{String(latest.error)}</Text> });
  if (data && fileList.length === 0) items.push({ key: "empty", filePath: null, element: <Text style={styles.muted}>No changes.</Text> });
  if (directory) {
    for (const file of fileList) {
      const open = isOpen(file);
      const current = file.path === currentPath;
      const blob = seenBlob(file);
      const changed = changedSinceViewed(file);
      const fileThreads = threadsByPath.get(file.path) ?? [];
      sticky.push(items.length);
      items.push({
        key: `h:${file.path}`,
        filePath: file.path,
        element: (
          <FileHeaderRow
            file={file}
            open={open}
            current={current}
            viewed={isViewed(file)}
            changedSinceViewed={changed}
            canShowSince={blob !== null}
            showFull={showFull[file.path] === true}
            threadCount={fileThreads.filter((thread) => !thread.isResolved).length}
            onThreadsPress={() => {
              const first = fileThreads.find((thread) => !thread.isResolved) ?? fileThreads[0];
              if (first) showThread(workspaceId, first.id);
            }}
            onToggleOpen={() => setOpenOverrides({ ...openOverrides, [file.path]: !open })}
            onToggleViewed={() => toggleViewed(file)}
            onToggleFull={() => setShowFull({ ...showFull, [file.path]: !showFull[file.path] })}
            headerRef={register(file.path, "header")}
            styles={styles}
          />
        ),
      });
      items.push({
        key: `b:${file.path}`,
        filePath: file.path,
        element: (
          <FileBody
            directory={directory}
            mode={mode}
            file={file}
            viewMode={prefs.viewMode}
            open={open}
            current={current}
            since={changed && blob && !showFull[file.path] ? blob : null}
            ignoreWhitespace={prefs.hideWhitespace}
            threads={fileThreads}
            loadLarge={loadLarge[file.path] === true}
            onLoadLarge={() => setLoadLarge({ ...loadLarge, [file.path]: true })}
            commentsKey={commentKey(workspaceId, mode)}
            syntax={syntax}
            bodyRef={register(file.path, "body")}
            styles={styles}
          />
        ),
      });
    }
  }

  const jumpTo = (file: ChangedFile) => {
    setCurrentPath(file.path);
    scrollToFile(file.path);
  };
  // Open the file (full diff, large ones loaded) and render it; its row then scrolls itself to the middle.
  const goToMatch = (match: SearchMatch | null) => {
    setActiveMatch(match);
    if (!match) return;
    setOpenOverrides((overrides) => ({ ...overrides, [match.path]: true }));
    setLoadLarge((large) => ({ ...large, [match.path]: true }));
    setShowFull((full) => ({ ...full, [match.path]: true }));
    setCurrentPath(match.path);
    scrollToFile(match.path, false);
  };
  // FlatList wants one stable callback; the latest file list is read through a ref.
  const latestItems = useRef(items);
  latestItems.current = items;
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken<ListItem>[] }) => {
    const first = viewableItems.find((token) => token.item?.filePath);
    if (first?.item?.filePath) setCurrentPath(first.item.filePath);
  });

  // Shortcuts read the latest render's state through a ref, so the listener is registered once.
  const shortcut = useRef<(key: string) => boolean>(() => false);
  shortcut.current = (key) => {
    const index = fileList.findIndex((file) => file.path === currentPath);
    const current = fileList[index] ?? fileList[0];
    const next = key === "j" || key === "ArrowDown" ? 1 : key === "k" || key === "ArrowUp" ? -1 : 0;
    if (next !== 0) {
      const target = fileList[Math.min(fileList.length - 1, Math.max(0, index + next))];
      if (target) jumpTo(target);
      return true;
    }
    if (key === "v" && current) {
      toggleViewed(current);
      return true;
    }
    if (key === "o" && current) {
      setOpenOverrides({ ...openOverrides, [current.path]: !isOpen(current) });
      return true;
    }
    if (key === "/") {
      setPrefs({ showTree: true });
      setTimeout(() => searchRef.current?.focus(), 0);
      return true;
    }
    if (key === "?") {
      setShowHelp(!showHelp);
      return true;
    }
    if (key === "Escape" && showHelp) {
      setShowHelp(false);
      return true;
    }
    return false;
  };
  useEffect(() => listenShortcuts((key) => shortcut.current(key)), []);
  useEffect(() => listenFind(() => diffSearchRef.current?.focus()), []);

  return (
    <AskContext.Provider value={ask}>
      <SearchContext.Provider value={{ query: searchQuery, active: activeMatch, filePath: "" }}>
      <View style={styles.screen}>
        <Toolbar
          prefs={prefs}
          setPrefs={setPrefs}
          mode={mode}
          stack={stackInfo}
          onMode={switchMode}
          search={
            directory ? (
              <SearchBar
                directory={directory}
                mode={mode}
                ignoreWhitespace={prefs.hideWhitespace}
                fileOrder={fileList.map((file) => file.path)}
                onQuery={setSearchQuery}
                onGo={goToMatch}
                inputRef={diffSearchRef}
                styles={styles}
              />
            ) : null
          }
          viewedCount={viewedCount}
          fileCount={fileList.length}
          hidden={hidden}
          themes={palettes.data?.themes ?? null}
          allViewed={allViewed}
          anyClosed={fileList.some((file) => !isOpen(file))}
          loading={latest.isFetching}
          onToggleAllViewed={toggleAllViewed}
          onToggleAllOpen={() => {
            const open = fileList.some((file) => !isOpen(file));
            setOpenOverrides(Object.fromEntries(fileList.map((file) => [file.path, open])));
          }}
          onRefresh={() => {
            void threads.refetch();
            void latest.refetch().then((result) => result.data && setShown({ key: viewKey, data: result.data }));
          }}
          onHelp={() => setShowHelp(!showHelp)}
          styles={styles}
        />

        {pendingChanges > 0 ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              ⚠ {pendingChanges} file{pendingChanges === 1 ? "" : "s"} changed since you loaded this view.
            </Text>
            <Pressable accessibilityRole="button" onPress={applyLatest}>
              <Text style={styles.primaryButton}>Update</Text>
            </Pressable>
          </View>
        ) : null}

        {showHelp ? (
          <View style={styles.shortcuts}>
            {SHORTCUTS.map(([keys, label]) => (
              <Text key={keys} style={styles.muted}>
                <Text style={styles.kbd}>{keys}</Text>  {label}
              </Text>
            ))}
          </View>
        ) : null}

        {directory && data ? (
          <SendBar
            workspaceId={workspaceId}
            directory={directory}
            mode={mode}
            baseRef={data.baseRef}
            commentsKey={commentKey(workspaceId, mode)}
            navigation={navigation}
            styles={styles}
          />
        ) : null}

        <View style={styles.body}>
          {prefs.showTree && fileList.length > 0 ? (
            <FileTree
              files={fileList}
              isViewed={isViewed}
              currentPath={currentPath}
              onSelect={jumpTo}
              searchRef={searchRef}
              styles={styles}
            />
          ) : null}
          {/* Virtualised: only files on or near the screen are rendered and loaded. */}
          <FlatList
            ref={listRef}
            style={styles.main}
            contentContainerStyle={styles.content}
            data={items}
            keyExtractor={(item) => item.key}
            renderItem={({ item }) => item.element}
            stickyHeaderIndices={sticky}
            initialNumToRender={8}
            maxToRenderPerBatch={6}
            windowSize={9}
            onViewableItemsChanged={onViewable.current}
            viewabilityConfig={{ itemVisiblePercentThreshold: 1 }}
            onScrollToIndexFailed={(info) => {
              // Unmeasured rows: jump near the target first, then aim precisely once it is rendered.
              listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
              setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0 }), 150);
            }}
          />
        </View>
      </View>
      </SearchContext.Provider>
    </AskContext.Provider>
  );
}

/** Files whose content, counts or presence differ between two listings. */
function changedFiles(before: FilesData, after: FilesData): number {
  const signature = (data: FilesData) =>
    new Map(data.files.map((file) => [file.path, `${file.fingerprint}:${file.additions}:${file.deletions}`]));
  const [a, b] = [signature(before), signature(after)];
  const paths = new Set([...a.keys(), ...b.keys()]);
  return [...paths].filter((path) => a.get(path) !== b.get(path)).length;
}

function isDark(color: string): boolean {
  const match = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!match) return true;
  const [r, g, b] = match.slice(1).map((hex) => parseInt(hex, 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}
