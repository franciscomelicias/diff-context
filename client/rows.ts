import type { DiffLine } from "../shared/diff";

/** One visual row: unified shows `line`; split shows `left` (old) and `right` (new) side by side. */
export interface DisplayRow {
  line: DiffLine;
  left: DiffLine | null;
  right: DiffLine | null;
}

export function toUnifiedRows(lines: DiffLine[]): DisplayRow[] {
  return lines.map((line) => ({
    line,
    left: line.kind === "add" ? null : line,
    right: line.kind === "del" ? null : line,
  }));
}

/** Pairs each run of deletions with the run of additions after it, like GitHub's split view. */
export function toSplitRows(lines: DiffLine[]): DisplayRow[] {
  const rows: DisplayRow[] = [];
  let deleted: DiffLine[] = [];
  let added: DiffLine[] = [];
  const flush = () => {
    for (let index = 0; index < Math.max(deleted.length, added.length); index++) {
      const left = deleted[index] ?? null;
      const right = added[index] ?? null;
      rows.push({ line: (right ?? left) as DiffLine, left, right });
    }
    deleted = [];
    added = [];
  };
  for (const line of lines) {
    if (line.kind === "del") {
      if (added.length > 0) flush();
      deleted.push(line);
    } else if (line.kind === "add") added.push(line);
    else {
      flush();
      rows.push({ line, left: line, right: line });
    }
  }
  flush();
  return rows;
}

export function linesOf(row: DisplayRow): DiffLine[] {
  return [...new Set([row.left, row.right, row.line].filter((line): line is DiffLine => line !== null))];
}
