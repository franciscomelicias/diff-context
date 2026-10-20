import { useState, type Ref } from "react";
import { Image, Pressable, Text, View, type ViewStyle } from "react-native";
import type { ChangedFile, DiffMode, EditorId, ReviewThread } from "../shared/diff";
import type { SyntaxSet } from "./colors";
import { EDITOR_ICONS } from "./editor-icons";
import { FileDiff, type ViewMode } from "./file-diff";
import type { Styles } from "./styles";
import { copyText } from "./web";

// GitHub also holds back big diffs until asked, so opening every file stays fast.
const LARGE_DIFF_LINES = 800;
// Rough height of a not yet loaded diff, so the scrollbar is close before it loads.
const ESTIMATED_LINE_HEIGHT = 20;

/**
 * A file's header row. The panel renders it as its own ScrollView child so it can be a native sticky
 * header: it pins to the top while its file scrolls by and the next header pushes it away.
 */
export function FileHeaderRow({
  file,
  open,
  current,
  viewed,
  changedSinceViewed,
  canShowSince,
  showFull,
  threadCount,
  onThreadsPress,
  editors,
  onOpenInEditor,
  onToggleOpen,
  onToggleViewed,
  onToggleFull,
  headerRef,
  styles,
}: {
  file: ChangedFile;
  open: boolean;
  current: boolean;
  viewed: boolean;
  changedSinceViewed: boolean;
  /** A blob from the last view exists, so "only changes since last view" can be shown. */
  canShowSince: boolean;
  showFull: boolean;
  /** Unresolved GitHub review threads on this file. */
  threadCount: number;
  /** Opens the PR comments side panel with every thread of the PR. */
  onThreadsPress: () => void;
  /** Installed code editors; each gets an icon button that opens the file at its first change. */
  editors: { id: EditorId; label: string }[];
  onOpenInEditor: (editor: EditorId) => void;
  onToggleOpen: () => void;
  onToggleViewed: () => void;
  onToggleFull: () => void;
  headerRef?: Ref<View>;
  styles: Styles;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <View
      ref={headerRef}
      style={[styles.fileHeader, styles.fileHeaderRow, open ? null : styles.fileHeaderClosed, current ? styles.fileCurrent : null]}
    >
      <Pressable accessibilityRole="button" accessibilityLabel={open ? "Collapse file" : "Expand file"} onPress={onToggleOpen}>
        <Text style={styles.chevron}>{open ? "▾" : "▸"}</Text>
      </Pressable>
      <Text style={styles.diffCount}>{file.additions + file.deletions}</Text>
      <DiffStat additions={file.additions} deletions={file.deletions} styles={styles} />
      <Text selectable style={styles.filePath} numberOfLines={1}>
        {file.oldPath ? (
          <>
            <Text style={styles.oldPath}>{file.oldPath}</Text> → {file.path}
          </>
        ) : (
          file.path
        )}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Copy file path"
        onPress={() =>
          void copyText(file.path).then((ok) => {
            setCopied(ok);
            if (ok) setTimeout(() => setCopied(false), 1500);
          })
        }
      >
        <Text style={styles.muted}>{copied ? "✓ Copied" : "⧉"}</Text>
      </Pressable>
      {file.status === "D" ? null : <EditorButtons editors={editors} target="file" onOpen={onOpenInEditor} styles={styles} />}
      {file.generated ? <Text style={styles.generatedBadge}>Generated</Text> : null}
      {threadCount > 0 ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Show all PR comments" onPress={onThreadsPress}>
          <Text style={styles.threadBadge}>💬 {threadCount}</Text>
        </Pressable>
      ) : null}
      {changedSinceViewed ? <Text style={styles.changedBadge}>Changed since last view</Text> : null}
      {changedSinceViewed && canShowSince && open ? (
        <Pressable accessibilityRole="button" onPress={onToggleFull}>
          <Text style={styles.link}>{showFull ? "Only changes since last view" : "Show full diff"}</Text>
        </Pressable>
      ) : null}
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: viewed }} onPress={onToggleViewed}>
        <Text style={viewed ? styles.viewedOn : styles.viewedOff}>{viewed ? "☑ Viewed" : "☐ Viewed"}</Text>
      </Pressable>
    </View>
  );
}

/** The file's diff under its header; always rendered (empty when closed) so sticky header indices stay stable. */
export function FileBody({
  directory,
  mode,
  file,
  viewMode,
  open,
  current,
  near,
  since,
  ignoreWhitespace,
  threads,
  loadLarge,
  onLoadLarge,
  commentsKey,
  syntax,
  bodyRef,
  styles,
}: {
  directory: string;
  mode: DiffMode;
  file: ChangedFile;
  viewMode: ViewMode;
  open: boolean;
  current: boolean;
  /** Near the screen at least once: only then is the diff fetched and rendered. */
  near: boolean;
  since: string | null;
  ignoreWhitespace: boolean;
  threads: ReviewThread[];
  loadLarge: boolean;
  onLoadLarge: () => void;
  commentsKey: string;
  syntax: SyntaxSet;
  bodyRef?: Ref<View>;
  styles: Styles;
}) {
  if (!open) return <View ref={bodyRef} style={styles.fileGap} />;
  const size = file.additions + file.deletions;
  const estimate = Math.min(size, LARGE_DIFF_LINES) * ESTIMATED_LINE_HEIGHT;
  const gated = size > LARGE_DIFF_LINES && !loadLarge;
  return (
    <View ref={bodyRef} style={[styles.fileBody, offscreenSkipped(estimate), current ? styles.fileCurrent : null]}>
      {gated ? (
        <Pressable accessibilityRole="button" style={styles.largeDiff} onPress={onLoadLarge}>
          <Text style={styles.link}>Large diff ({size} changed lines) · Load diff</Text>
        </Pressable>
      ) : !near ? (
        <View style={{ height: estimate }} />
      ) : (
        <FileDiff
          directory={directory}
          mode={mode}
          file={file}
          viewMode={viewMode}
          since={since}
          ignoreWhitespace={ignoreWhitespace}
          threads={threads}
          commentsKey={commentsKey}
          syntax={syntax}
          styles={styles}
        />
      )}
    </View>
  );
}

/** The browser skips layout and paint of a diff while it is off screen, keeping its last size meanwhile. */
function offscreenSkipped(estimate: number): ViewStyle {
  return { contentVisibility: "auto", containIntrinsicSize: `auto ${estimate}px` } as ViewStyle;
}

/** Tight row of editor icons; only installed editors are listed. */
export function EditorButtons({
  editors,
  target,
  onOpen,
  styles,
}: {
  editors: { id: EditorId; label: string }[];
  target: "file" | "project";
  onOpen: (editor: EditorId) => void;
  styles: Styles;
}) {
  if (editors.length === 0) return null;
  return (
    <View style={styles.editorGroup}>
      {editors.map((editor) => (
        <Pressable
          key={editor.id}
          accessibilityRole="button"
          accessibilityLabel={target === "file" ? `Open file in ${editor.label}` : `Open project in ${editor.label}`}
          onPress={() => onOpen(editor.id)}
          style={styles.editorButton}
        >
          <Image source={{ uri: EDITOR_ICONS[editor.id] }} style={styles.editorIcon} />
        </Pressable>
      ))}
    </View>
  );
}

/** GitHub's five-block bar: green for additions, red for deletions, grey for the rest. */
function DiffStat({ additions, deletions, styles }: { additions: number; deletions: number; styles: Styles }) {
  const total = additions + deletions;
  const green = total === 0 ? 0 : Math.round((additions / total) * 5);
  const red = total === 0 ? 0 : Math.min(5 - green, Math.round((deletions / total) * 5));
  return (
    <View style={styles.diffStat}>
      {[0, 1, 2, 3, 4].map((index) => (
        <View
          key={index}
          style={[styles.diffBlock, index < green ? styles.diffBlockAdd : index < green + red ? styles.diffBlockDel : null]}
        />
      ))}
    </View>
  );
}
