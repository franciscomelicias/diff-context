import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useContext, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { fileDiffRpc, type ChangedFile, type DiffLine, type DiffMode, type ReviewThread, type Token } from "../shared/diff";
import { AskContext } from "./ask";
import { commentTarget, toContextLine, useComments } from "./comments";
import { buildSegments, gapLines, type Gap } from "./gaps";
import { CommentBubble, CommentEditor, SplitRow, UnifiedRow } from "./line";
import { ThreadCard, threadAskContext } from "./thread-card";
import { linesOf, toSplitRows, toUnifiedRows, type DisplayRow } from "./rows";
import { SearchContext } from "./search";
import type { SyntaxSet } from "./colors";
import type { Styles } from "./styles";
import { onMouseUpOnce } from "./web";
import { wordChanges } from "./word-diff";

const STEP = 20;
const CONTEXT_RADIUS = 3;

export type ViewMode = "unified" | "split";

/** Revealed lines per gap, counted from its top edge and from its bottom edge. */
type Revealed = Record<string, { top: number; bottom: number }>;

interface ListContext {
  directory: string;
  filePath: string;
  threads: ReviewThread[];
  commentsKey: string;
  viewMode: ViewMode;
  syntax: SyntaxSet;
  tokensOf: (line: DiffLine) => Token[] | undefined;
  styles: Styles;
}

export function FileDiff({
  directory,
  mode,
  file,
  viewMode,
  since,
  ignoreWhitespace,
  threads,
  commentsKey,
  syntax,
  styles,
}: {
  directory: string;
  mode: DiffMode;
  file: ChangedFile;
  viewMode: ViewMode;
  ignoreWhitespace: boolean;
  threads: ReviewThread[];
  /** Blob id seen when marked viewed: show only the changes since then. */
  since: string | null;
  commentsKey: string;
  syntax: SyntaxSet;
  styles: Styles;
}) {
  const loadDiff = useRpc(fileDiffRpc);
  const search = useContext(SearchContext);
  const [revealed, setRevealed] = useState<Revealed>({});
  const diff = useQuery({
    queryKey: ["diff-file", directory, mode, file.path, file.fingerprint, since, ignoreWhitespace],
    queryFn: () => loadDiff({ directory, mode, path: file.path, oldPath: file.oldPath, ignoreWhitespace, since }),
    enabled: !file.binary,
  });

  if (file.binary) return <Text style={styles.note}>Binary file not shown.</Text>;
  if (diff.isLoading) return <Text style={styles.note}>Loading…</Text>;
  if (diff.error) return <Text style={[styles.note, styles.error]}>{String(diff.error)}</Text>;
  if (!diff.data) return null;
  if (diff.data.tooLarge) return <Text style={styles.note}>File too large to show.</Text>;

  const { hunks, newContent, newTokens } = diff.data;
  const segments = buildSegments(hunks, newContent.length);
  const gaps = segments.flatMap((segment) => (segment.kind === "gap" ? [segment.gap] : []));
  const allShown = gaps.every((gap) => hiddenCount(gap, revealed) === 0);
  const context: ListContext = {
    directory,
    filePath: file.path,
    threads,
    commentsKey,
    viewMode,
    syntax,
    tokensOf: (line) => line.tokens ?? (line.newNo === null ? undefined : newTokens[line.newNo - 1]),
    styles,
  };

  const reveal = (gap: Gap, edge: "top" | "bottom" | "all") => {
    const current = revealed[gap.id] ?? { top: 0, bottom: 0 };
    const size = gap.to - gap.from + 1;
    const next =
      edge === "all"
        ? { top: size, bottom: 0 }
        : { ...current, [edge]: Math.min(current[edge] + STEP, size - (edge === "top" ? current.bottom : current.top)) };
    setRevealed({ ...revealed, [gap.id]: next });
  };

  return (
    <SearchContext.Provider value={{ ...search, filePath: file.path }}>
      {segments.map((segment, index) => {
        if (segment.kind === "hunk") {
          const { hunk } = segment;
          const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
          const previous = segments[index - 1];
          return (
            <View key={`h${hunk.newStart}-${hunk.oldStart}`}>
              {/* GitHub shows the hunk range and enclosing function when no expand bar sits above it. */}
              {previous?.kind !== "gap" || hiddenCount(previous.gap, revealed) === 0 ? (
                <Text style={styles.hunkHeader}>
                  {header} {hunk.section}
                </Text>
              ) : null}
              <RowList lines={hunk.lines} header={header} {...context} />
            </View>
          );
        }
        const { gap } = segment;
        const shown = revealed[gap.id] ?? { top: 0, bottom: 0 };
        const hidden = hiddenCount(gap, revealed);
        const next = segments[index + 1];
        const section = next?.kind === "hunk" ? next.hunk.section : "";
        const header = `@@ -${gap.from + gap.oldOffset} +${gap.from} @@`;
        return (
          <View key={gap.id}>
            <RowList lines={gapLines(gap, newContent, gap.from, gap.from + shown.top - 1)} header={header} {...context} />
            {hidden > 0 ? (
              <View style={styles.gap}>
                {gap.from > 1 ? <GapButton label="↓" hint={`Show ${Math.min(STEP, hidden)} more`} onPress={() => reveal(gap, "top")} styles={styles} /> : null}
                {gap.to < newContent.length ? (
                  <GapButton label="↑" hint={`Show ${Math.min(STEP, hidden)} more`} onPress={() => reveal(gap, "bottom")} styles={styles} />
                ) : null}
                <GapButton label="↕" hint={`Show all ${hidden} lines`} onPress={() => reveal(gap, "all")} styles={styles} />
                <Text style={styles.gapSection} numberOfLines={1}>
                  {hidden} hidden lines{section ? ` · ${section}` : ""}
                </Text>
              </View>
            ) : null}
            <RowList lines={gapLines(gap, newContent, gap.to - shown.bottom + 1, gap.to)} header={header} {...context} />
          </View>
        );
      })}
      {gaps.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          style={styles.fileActions}
          onPress={() =>
            setRevealed(allShown ? {} : Object.fromEntries(gaps.map((gap) => [gap.id, { top: gap.to - gap.from + 1, bottom: 0 }])))
          }
        >
          <Text style={styles.link}>{allShown ? "Collapse unchanged lines" : "Expand whole file"}</Text>
        </Pressable>
      ) : null}
    </SearchContext.Provider>
  );
}

function RowList({
  lines,
  header,
  directory,
  filePath,
  threads,
  commentsKey,
  viewMode,
  syntax,
  tokensOf,
  styles,
}: ListContext & { lines: DiffLine[]; header: string }) {
  const store = useComments(commentsKey);
  const ask = useContext(AskContext);
  const rows = viewMode === "split" ? toSplitRows(lines) : toUnifiedRows(lines);
  const changes = wordChanges(lines);
  // Mouse down on a line number starts a selection, dragging extends it, Shift+click extends an open one.
  const [selection, setSelection] = useState<{ anchor: number; end: number; anchorLine: DiffLine; endLine: DiffLine } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [draft, setDraft] = useState("");
  const [openThreads, setOpenThreads] = useState<ReadonlySet<string>>(new Set());
  const threadsOf = (line: DiffLine) =>
    threads.filter((thread) =>
      thread.side === "LEFT" ? line.kind !== "add" && thread.line === line.oldNo : line.kind !== "del" && thread.line === line.newNo,
    );
  const toggleThreads = (lineThreads: ReviewThread[]) => {
    const allOpen = lineThreads.every((thread) => openThreads.has(thread.id));
    const next = new Set(openThreads);
    for (const thread of lineThreads) {
      if (allOpen) next.delete(thread.id);
      else next.add(thread.id);
    }
    setOpenThreads(next);
  };
  const first = selection ? Math.min(selection.anchor, selection.end) : -1;
  const last = selection ? Math.max(selection.anchor, selection.end) : -1;
  const selectedLines = rows.slice(first, last + 1).flatMap(linesOf);
  // GitHub anchors a range comment on its bottom line.
  const targetLine = selection ? (selection.end >= selection.anchor ? selection.endLine : selection.anchorLine) : null;

  const close = () => {
    setSelection(null);
    setDraft("");
  };
  const startSelection = (index: number, line: DiffLine, shift: boolean) => {
    setSelection(shift && selection ? { ...selection, end: index, endLine: line } : { anchor: index, end: index, anchorLine: line, endLine: line });
    setDragging(true);
    onMouseUpOnce(() => setDragging(false));
  };
  const extendSelection = (index: number, row: DisplayRow) => {
    if (!dragging || !selection || selection.end === index) return;
    const side = commentTarget(selection.anchorLine).side;
    const line = linesOf(row).find((candidate) => commentTarget(candidate).side === side) ?? linesOf(row)[0];
    if (line) setSelection({ ...selection, end: index, endLine: line });
  };
  const addComment = ({ from, to, line, body }: { from: number; to: number; line: DiffLine; body: string }) => {
    const target = commentTarget(line);
    const start = commentTarget(linesOf(rows[from]).find((candidate) => commentTarget(candidate).side === target.side) ?? line);
    store.add({
      filePath,
      ...target,
      startLineNumber: from === to ? null : start.lineNumber,
      body,
      context: {
        hunkHeader: header,
        targetLine: toContextLine(line),
        lines: rows
          .slice(Math.max(0, from - CONTEXT_RADIUS), to + CONTEXT_RADIUS + 1)
          .flatMap(linesOf)
          .map(toContextLine),
      },
    });
  };
  const save = (body: string) => {
    if (!targetLine) return;
    addComment({ from: first, to: last, line: targetLine, body });
    close();
  };

  return (
    <>
      {rows.map((row, index) => {
        const rowComments = store.comments.filter(
          (comment) =>
            comment.filePath === filePath &&
            linesOf(row).some((line) => {
              const target = commentTarget(line);
              return target.side === comment.side && target.lineNumber === comment.lineNumber;
            }),
        );
        const Row = viewMode === "split" ? SplitRow : UnifiedRow;
        return (
          <View key={`${row.left?.oldNo ?? "x"}-${row.right?.newNo ?? "x"}-${index}`}>
            <Row
              row={row}
              tokensOf={tokensOf}
              changesOf={(line) => changes.get(line)}
              threadsOf={threadsOf}
              onThreadPress={toggleThreads}
              syntax={syntax}
              selected={index >= first && index <= last}
              onGutterPress={(line, shift) => startSelection(index, line, shift)}
              onEnter={() => extendSelection(index, row)}
              styles={styles}
            />
            {[...new Set(linesOf(row).flatMap(threadsOf))]
              .filter((thread) => openThreads.has(thread.id))
              .map((thread) => (
                <View key={thread.id} style={styles.inlineThread}>
                  <ThreadCard
                    thread={thread}
                    directory={directory}
                    showPath={false}
                    onAsk={ask ? (question) => void ask(threadAskContext(thread, question)) : null}
                    onAddComment={(body) => {
                      const line = linesOf(row).find((candidate) => threadsOf(candidate).includes(thread));
                      if (line) addComment({ from: index, to: index, line, body: followUpBody(thread, body) });
                    }}
                    onClose={() => toggleThreads([thread])}
                    styles={styles}
                  />
                </View>
              ))}
            {rowComments.map((comment) => (
              <CommentBubble key={comment.id} comment={comment} onUpdate={store.update} onRemove={store.remove} styles={styles} />
            ))}
            {index === last && !dragging ? (
              <CommentEditor
                body={draft}
                onChange={setDraft}
                onSave={save}
                onCancel={close}
                suggestion={selectedLines.filter((line) => line.kind !== "del").map((line) => line.text).join("\n")}
                onAsk={
                  ask
                    ? (question) => {
                        const numbers = selectedLines.map((line) => line.newNo ?? line.oldNo).filter((n): n is number => n !== null);
                        const range = numbers.length > 1 ? `lines ${Math.min(...numbers)}–${Math.max(...numbers)}` : `line ${numbers[0]}`;
                        const code = selectedLines
                          .map((line) => `${line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}${line.text}`)
                          .join("\n");
                        void ask({ filePath, lines: range, code, question }).finally(close);
                      }
                    : null
                }
                styles={styles}
              />
            ) : null}
          </View>
        );
      })}
    </>
  );
}

/** Quotes the GitHub thread so the agent knows what the comment follows up on. */
function followUpBody(thread: ReviewThread, body: string): string {
  const quoted = thread.comments.map((comment) => `> @${comment.author}: ${comment.body.replace(/\n/g, "\n> ")}`).join("\n>\n");
  return `Follow-up on this GitHub review thread:\n${quoted}\n\n${body}`;
}

function hiddenCount(gap: Gap, revealed: Revealed): number {
  const shown = revealed[gap.id] ?? { top: 0, bottom: 0 };
  return Math.max(0, gap.to - gap.from + 1 - shown.top - shown.bottom);
}

function GapButton({ label, hint, onPress, styles }: { label: string; hint: string; onPress: () => void; styles: Styles }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={hint} onPress={onPress} style={styles.gapButtonBox}>
      <Text style={styles.gapButton}>{label}</Text>
    </Pressable>
  );
}
