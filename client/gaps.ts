import type { DiffLine, Hunk } from "../shared/diff";

/** Unchanged new-file lines hidden between hunks (1-based, inclusive), with the old-file offset at that point. */
export interface Gap {
  id: string;
  from: number;
  to: number;
  oldOffset: number;
}

export type Segment = { kind: "hunk"; hunk: Hunk } | { kind: "gap"; gap: Gap };

export function buildSegments(hunks: Hunk[], totalLines: number): Segment[] {
  const segments: Segment[] = [];
  let nextNew = 1;
  let oldOffset = 0;
  for (const [index, hunk] of hunks.entries()) {
    // A hunk with zero new lines (pure deletion) sits after line newStart, not on it.
    const firstNew = hunk.newLines > 0 ? hunk.newStart : hunk.newStart + 1;
    if (firstNew > nextNew) segments.push({ kind: "gap", gap: { id: `g${index}`, from: nextNew, to: firstNew - 1, oldOffset } });
    segments.push({ kind: "hunk", hunk });
    nextNew = firstNew + hunk.newLines;
    const nextOld = (hunk.oldLines > 0 ? hunk.oldStart : hunk.oldStart + 1) + hunk.oldLines;
    oldOffset = nextOld - nextNew;
  }
  if (hunks.length > 0 && totalLines >= nextNew) {
    segments.push({ kind: "gap", gap: { id: "gEnd", from: nextNew, to: totalLines, oldOffset } });
  }
  return segments;
}

export function gapLines(gap: Gap, content: string[], from: number, to: number): DiffLine[] {
  const lines: DiffLine[] = [];
  for (let newNo = from; newNo <= to; newNo++) {
    lines.push({ kind: "ctx", text: content[newNo - 1] ?? "", oldNo: newNo + gap.oldOffset, newNo });
  }
  return lines;
}
