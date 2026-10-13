import type { DiffLine } from "../shared/diff";

/** Character ranges [start, end) that differ between a deleted line and the added line replacing it. */
export type Ranges = [number, number][];

const MAX_TOKENS = 300;
// Below this share of unchanged text the lines are simply different, so GitHub marks nothing.
const MIN_SIMILARITY = 0.3;

/** Pairs each run of deletions with the run of additions after it, then word-diffs the pairs. */
export function wordChanges(lines: DiffLine[]): Map<DiffLine, Ranges> {
  const result = new Map<DiffLine, Ranges>();
  let deleted: DiffLine[] = [];
  let added: DiffLine[] = [];
  const flush = () => {
    for (let index = 0; index < Math.min(deleted.length, added.length); index++) {
      const ranges = diffWords(deleted[index].text, added[index].text);
      if (ranges) {
        result.set(deleted[index], ranges.old);
        result.set(added[index], ranges.new);
      }
    }
    deleted = [];
    added = [];
  };
  for (const line of lines) {
    if (line.kind === "del") {
      if (added.length > 0) flush();
      deleted.push(line);
    } else if (line.kind === "add") added.push(line);
    else flush();
  }
  flush();
  return result;
}

function diffWords(before: string, after: string): { old: Ranges; new: Ranges } | null {
  const a = tokenize(before);
  const b = tokenize(after);
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) return null;

  const keptA = new Set<number>();
  const keptB = new Set<number>();
  // The shared start and end are kept as-is, so an insertion reads as one block rather than scattered pieces.
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix].text === b[prefix].text) {
    keptA.add(prefix);
    keptB.add(prefix);
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix].text === b[b.length - 1 - suffix].text
  ) {
    keptA.add(a.length - 1 - suffix);
    keptB.add(b.length - 1 - suffix);
    suffix++;
  }
  const midA = a.slice(prefix, a.length - suffix);
  const midB = b.slice(prefix, b.length - suffix);

  // Longest common subsequence over the middle tokens; lines are short, so O(n·m) is fine.
  const table: number[][] = Array.from({ length: midA.length + 1 }, () => new Array<number>(midB.length + 1).fill(0));
  for (let i = midA.length - 1; i >= 0; i--) {
    for (let j = midB.length - 1; j >= 0; j--) {
      table[i][j] =
        midA[i].text === midB[j].text ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  for (let i = 0, j = 0; i < midA.length && j < midB.length; ) {
    if (midA[i].text === midB[j].text) {
      keptA.add(prefix + i++);
      keptB.add(prefix + j++);
    } else if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  }

  const common = [...keptA].reduce((sum, index) => sum + (a[index].text.trim() ? a[index].text.length : 0), 0);
  const longest = Math.max(before.trim().length, after.trim().length, 1);
  if (common / longest < MIN_SIMILARITY) return null;
  return { old: toRanges(before, a, keptA), new: toRanges(after, b, keptB) };
}

function tokenize(text: string): { text: string; start: number }[] {
  return [...text.matchAll(/\w+|\s+|[^\w\s]/g)].map((match) => ({ text: match[0], start: match.index ?? 0 }));
}

function toRanges(text: string, tokens: { text: string; start: number }[], kept: Set<number>): Ranges {
  const ranges: Ranges = [];
  tokens.forEach((token, index) => {
    if (kept.has(index)) return;
    const end = token.start + token.text.length;
    const last = ranges.at(-1);
    if (last && last[1] === token.start) last[1] = end;
    else ranges.push([token.start, end]);
  });
  // A whitespace-only change (re-indent, extra space) is noise next to real edits.
  return ranges.filter(([start, end]) => text.slice(start, end).trim().length > 0);
}
