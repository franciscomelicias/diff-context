import { useContext, useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { DiffLine, ReviewThread, Token } from "../shared/diff";
import type { SyntaxSet } from "./colors";
import type { ReviewComment } from "./comments";
import type { DisplayRow } from "./rows";
import type { Styles } from "./styles";
import { findRanges, isActiveMatch, SearchContext } from "./search";
import { scrollIntoView, webMouse } from "./web";
import type { Ranges } from "./word-diff";

/** Mouse down on a line number: starts a selection, or extends it with Shift. */
export type GutterPress = (line: DiffLine, shift: boolean) => void;

interface RowProps {
  row: DisplayRow;
  /** GitHub review threads anchored on a line (old side for deletions, new side otherwise). */
  threadsOf: (line: DiffLine) => ReviewThread[];
  onThreadPress: (thread: ReviewThread) => void;
  tokensOf: (line: DiffLine) => Token[] | undefined;
  changesOf: (line: DiffLine) => Ranges | undefined;
  syntax: SyntaxSet;
  selected: boolean;
  onGutterPress: GutterPress;
  /** The mouse entered the row; extends a drag selection. */
  onEnter: () => void;
  styles: Styles;
}

export function UnifiedRow({ row, tokensOf, changesOf, threadsOf, onThreadPress, syntax, selected, onGutterPress, onEnter, styles }: RowProps) {
  const { line } = row;
  const ref = useActiveMatchScroll([line]);
  return (
    <View ref={ref} {...webMouse({ onMouseEnter: onEnter })} style={[kindStyle(line, styles), selected ? styles.lineSelected : null]}>
      <Gutter line={line} numbers={[line.oldNo, line.newNo]} onPress={onGutterPress} styles={styles} />
      <ThreadIcon threads={threadsOf(line)} onPress={onThreadPress} styles={styles} />
      <Text style={signStyle(line, styles)}>{sign(line)}</Text>
      <Code line={line} tokens={tokensOf(line)} changes={changesOf(line)} syntax={syntax} styles={styles} />
    </View>
  );
}

export function SplitRow({ row, tokensOf, changesOf, threadsOf, onThreadPress, syntax, selected, onGutterPress, onEnter, styles }: RowProps) {
  const ref = useActiveMatchScroll([row.left, row.right]);
  return (
    <View ref={ref} {...webMouse({ onMouseEnter: onEnter })} style={[styles.splitRow, selected ? styles.lineSelected : null]}>
      {[row.left, row.right].map((line, index) =>
        line ? (
          <View key={index} style={[styles.splitHalf, line.kind === "ctx" ? null : kindStyle(line, styles)]}>
            <Gutter line={line} numbers={[index === 0 ? line.oldNo : line.newNo]} onPress={onGutterPress} styles={styles} />
            <ThreadIcon threads={index === 0 && line.kind === "ctx" ? [] : threadsOf(line)} onPress={onThreadPress} styles={styles} />
            <Text style={signStyle(line, styles)}>{line.kind === "ctx" ? " " : sign(line)}</Text>
            <Code line={line} tokens={tokensOf(line)} changes={changesOf(line)} syntax={syntax} styles={styles} />
          </View>
        ) : (
          <View key={index} style={[styles.splitHalf, styles.emptyHalf]} />
        ),
      )}
    </View>
  );
}

/**
 * Only the line numbers take the mouse, so the code itself stays selectable for copying. Mouse down here
 * (not a press) so a drag down the gutter selects a range, like GitHub.
 */
function Gutter({
  line,
  numbers,
  onPress,
  styles,
}: {
  line: DiffLine;
  numbers: (number | null)[];
  onPress: GutterPress;
  styles: Styles;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <View
      accessibilityLabel="Comment on this line (drag or Shift+click to select a range)"
      {...webMouse({
        onMouseDown: (event) => {
          // Stops the browser from starting a text selection while dragging.
          event.preventDefault();
          onPress(line, event.shiftKey);
        },
        onMouseEnter: () => setHovered(true),
        onMouseLeave: () => setHovered(false),
      })}
      style={[styles.gutter, styles.gutterPointer]}
    >
      {numbers.map((number, index) => (
        <Text key={index} style={styles.lineNo}>
          {number ?? ""}
        </Text>
      ))}
      <Text style={styles.gutterPlus}>{hovered ? "+" : " "}</Text>
    </View>
  );
}

/** Scrolls the row into the middle of the screen when it holds the search match being jumped to. */
function useActiveMatchScroll(lines: (DiffLine | null)[]) {
  const { active, filePath } = useContext(SearchContext);
  const ref = useRef<View>(null);
  const isActive = lines.some((line) => line !== null && isActiveMatch(active, filePath, line));
  useEffect(() => {
    if (isActive) scrollIntoView(ref.current);
  }, [isActive, active]);
  return ref;
}

/** 💬 with the thread count; opens the PR comments side panel on the first (unresolved first) thread. */
function ThreadIcon({
  threads,
  onPress,
  styles,
}: {
  threads: ReviewThread[];
  onPress: (thread: ReviewThread) => void;
  styles: Styles;
}) {
  if (threads.length === 0) return <View style={styles.threadIconSpace} />;
  const first = [...threads].sort((a, b) => Number(a.isResolved) - Number(b.isResolved))[0];
  const open = threads.some((thread) => !thread.isResolved);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Show PR comments" onPress={() => onPress(first)} style={styles.threadIconSpace}>
      <Text style={open ? styles.threadIcon : styles.threadIconResolved}>💬{threads.length > 1 ? threads.length : ""}</Text>
    </Pressable>
  );
}

function Code({
  line,
  tokens,
  changes,
  syntax,
  styles,
}: {
  line: DiffLine;
  tokens: Token[] | undefined;
  changes: Ranges | undefined;
  syntax: SyntaxSet;
  styles: Styles;
}) {
  const { query, active, filePath } = useContext(SearchContext);
  if (line.text.length === 0) return <Text style={styles.code}> </Text>;
  const found = query ? findRanges(line.text, query) : [];
  const foundStyle = isActiveMatch(active, filePath, line) ? styles.foundActive : styles.found;
  const marked = line.kind === "add" ? styles.wordAdd : styles.wordDel;
  const palette = line.kind === "add" ? syntax.add : line.kind === "del" ? syntax.del : syntax.ctx;
  const markedPalette = line.kind === "add" ? syntax.wordAdd : syntax.wordDel;
  return (
    <Text selectable style={styles.code}>
      {pieces(tokens && tokens.length > 0 ? tokens : [{ text: line.text, style: null }], changes ?? [], found).map((piece, index) => (
        <Text
          key={index}
          style={[
            piece.style ? { color: (piece.changed ? markedPalette : palette)[piece.style] } : null,
            piece.changed ? marked : null,
            piece.found ? foundStyle : null,
          ]}
        >
          {piece.text}
        </Text>
      ))}
    </Text>
  );
}

/** Cuts syntax tokens at word-change and search-match boundaries so each piece carries its colour and marks. */
function pieces(tokens: Token[], changes: Ranges, found: Ranges): { text: string; style: string | null; changed: boolean; found: boolean }[] {
  const result: { text: string; style: string | null; changed: boolean; found: boolean }[] = [];
  let offset = 0;
  for (const token of tokens) {
    const end = offset + token.text.length;
    const cuts = new Set([offset, end]);
    for (const [start, stop] of [...changes, ...found]) {
      if (start > offset && start < end) cuts.add(start);
      if (stop > offset && stop < end) cuts.add(stop);
    }
    const points = [...cuts].sort((a, b) => a - b);
    for (let index = 0; index < points.length - 1; index++) {
      const [from, to] = [points[index], points[index + 1]];
      result.push({
        text: token.text.slice(from - offset, to - offset),
        style: token.style,
        changed: changes.some(([start, stop]) => from >= start && to <= stop),
        found: found.some(([start, stop]) => from >= start && to <= stop),
      });
    }
    offset = end;
  }
  return result;
}

export function CommentBubble({
  comment,
  onUpdate,
  onRemove,
  styles,
}: {
  comment: ReviewComment;
  onUpdate: (id: string, body: string) => void;
  onRemove: (id: string) => void;
  styles: Styles;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(comment.body);
  if (editing) {
    return (
      <CommentEditor
        body={body}
        onChange={setBody}
        onSave={(next) => {
          onUpdate(comment.id, next);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
        suggestion={null}
        styles={styles}
      />
    );
  }
  return (
    <View style={styles.comment}>
      {comment.startLineNumber !== null ? (
        <Text style={styles.muted}>
          Lines {comment.startLineNumber}–{comment.lineNumber}
        </Text>
      ) : null}
      <Text selectable style={styles.commentBody}>
        {comment.body}
      </Text>
      <View style={styles.commentActions}>
        <Pressable accessibilityRole="button" onPress={() => setEditing(true)}>
          <Text style={styles.link}>Edit</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => onRemove(comment.id)}>
          <Text style={styles.linkDanger}>Delete</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function CommentEditor({
  body,
  onChange,
  onSave,
  onCancel,
  suggestion,
  onAsk,
  styles,
}: {
  body: string;
  onChange: (body: string) => void;
  onSave: (body: string) => void;
  onCancel: () => void;
  /** The selected new-side lines, offered as a ```suggestion block. */
  suggestion: string | null;
  /** Sends the selected lines and the typed question to the "Ask about diff" chat. */
  onAsk?: ((question: string) => void) | null;
  styles: Styles;
}) {
  const empty = body.trim().length === 0;
  const [asking, setAsking] = useState(false);
  return (
    <View style={styles.comment}>
      <TextInput
        autoFocus
        multiline
        value={body}
        onChangeText={onChange}
        placeholder="Comment, or a question for ✦ Ask AI… (drag or Shift+click line numbers to select a range)"
        placeholderTextColor={styles.placeholder.color}
        style={styles.commentInput}
      />
      <View style={styles.commentActions}>
        <Pressable accessibilityRole="button" disabled={empty} onPress={() => onSave(body.trim())}>
          <Text style={empty ? styles.buttonDisabledText : styles.primaryButton}>Add comment</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onCancel}>
          <Text style={styles.link}>Cancel</Text>
        </Pressable>
        {suggestion !== null ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => onChange(`${body}${body && !body.endsWith("\n") ? "\n" : ""}\`\`\`suggestion\n${suggestion}\n\`\`\`\n`)}
          >
            <Text style={styles.link}>± Suggest change</Text>
          </Pressable>
        ) : null}
        {onAsk ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ask AI about the selected lines"
            disabled={asking}
            onPress={() => {
              setAsking(true);
              onAsk(body.trim() || "Explain what these lines do and why they changed.");
            }}
          >
            <Text style={styles.link}>{asking ? "Asking…" : "✦ Ask AI"}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function kindStyle(line: DiffLine, styles: Styles) {
  if (line.kind === "add") return styles.lineAdd;
  if (line.kind === "del") return styles.lineDel;
  return styles.line;
}

function signStyle(line: DiffLine, styles: Styles) {
  if (line.kind === "add") return styles.signAdd;
  if (line.kind === "del") return styles.signDel;
  return styles.sign;
}

function sign(line: DiffLine): string {
  if (line.kind === "add") return "+";
  if (line.kind === "del") return "−";
  return " ";
}
