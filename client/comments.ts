import { useRpc } from "@getpaseo/plugin/client";
import { useEffect, useSyncExternalStore } from "react";
import { storeGetRpc, storeSetRpc, type DiffLine, type DiffMode } from "../shared/diff";

type LineType = "context" | "add" | "remove";

interface ContextLine {
  oldLineNumber: number | null;
  newLineNumber: number | null;
  type: LineType;
  content: string;
}

/** A comment in Paseo's built-in "application/paseo-review" shape, plus the selected range for display. */
export interface ReviewComment {
  id: string;
  /** First line of a multi-line selection; lineNumber is the last one, like GitHub. */
  startLineNumber: number | null;
  filePath: string;
  side: "old" | "new";
  lineNumber: number;
  body: string;
  context: { hunkHeader: string; targetLine: ContextLine; lines: ContextLine[] };
}

// Kept outside React so drafts survive closing and reopening the panel; also saved by the daemon
// (debounced) so they survive a Paseo restart until sent or discarded.
const store = new Map<string, ReviewComment[]>();
const hydrated = new Set<string>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
const EMPTY: ReviewComment[] = [];

export function useComments(key: string) {
  const load = useRpc(storeGetRpc);
  const save = useRpc(storeSetRpc);
  useEffect(() => {
    if (hydrated.has(key)) return;
    hydrated.add(key);
    void load({ space: "drafts", key }).then(({ value }) => {
      if (!store.has(key) && Array.isArray(value) && value.length > 0) {
        store.set(key, value as ReviewComment[]);
        listeners.forEach((listener) => listener());
      }
    });
  }, [key, load]);
  const comments = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => store.get(key) ?? EMPTY,
  );
  const set = (next: ReviewComment[]) => {
    store.set(key, next);
    listeners.forEach((listener) => listener());
    clearTimeout(saveTimers.get(key));
    saveTimers.set(key, setTimeout(() => void save({ space: "drafts", key, value: next }), 500));
  };
  return {
    comments,
    add: (comment: Omit<ReviewComment, "id">) => set([...comments, { ...comment, id: `${Date.now()}-${comments.length}` }]),
    update: (id: string, body: string) => set(comments.map((comment) => (comment.id === id ? { ...comment, body } : comment))),
    remove: (id: string) => set(comments.filter((comment) => comment.id !== id)),
    clear: () => set([]),
  };
}

/** Paseo's review schema has a single line number, so a range is spelled out in the body. */
export function toAttachmentComment(comment: ReviewComment) {
  const { filePath, side, lineNumber, body, context, startLineNumber } = comment;
  const prefix = startLineNumber === null ? "" : `(lines ${startLineNumber}–${lineNumber}) `;
  return { filePath, side, lineNumber, body: `${prefix}${body}`, context };
}

export function commentKey(workspaceId: string, mode: DiffMode): string {
  return `${workspaceId}:${mode}`;
}

export function lineKey(line: DiffLine): string {
  return line.kind === "del" ? `old:${line.oldNo}` : `new:${line.newNo}`;
}

export function commentTarget(line: DiffLine): { side: "old" | "new"; lineNumber: number } {
  return line.kind === "del" ? { side: "old", lineNumber: line.oldNo ?? 0 } : { side: "new", lineNumber: line.newNo ?? 0 };
}

export function toContextLine(line: DiffLine): ContextLine {
  return {
    oldLineNumber: line.oldNo,
    newLineNumber: line.newNo,
    type: line.kind === "add" ? "add" : line.kind === "del" ? "remove" : "context",
    content: line.text,
  };
}
