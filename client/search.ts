import { createContext } from "react";
import type { DiffLine, SearchMatch } from "../shared/diff";
import type { Ranges } from "./word-diff";

/** The diff search: what to highlight, and the match being jumped to. FileDiff narrows filePath to its file. */
export const SearchContext = createContext<{ query: string; active: SearchMatch | null; filePath: string }>({
  query: "",
  active: null,
  filePath: "",
});

/** Smart case, like the server: case-insensitive unless the query has a capital letter. */
export function findRanges(text: string, query: string): Ranges {
  const sensitive = query !== query.toLowerCase();
  const haystack = sensitive ? text : text.toLowerCase();
  const needle = sensitive ? query : query.toLowerCase();
  const ranges: Ranges = [];
  for (let index = haystack.indexOf(needle); index !== -1; index = haystack.indexOf(needle, index + needle.length)) {
    ranges.push([index, index + needle.length]);
  }
  return ranges;
}

export function isActiveMatch(active: SearchMatch | null, filePath: string, line: DiffLine): boolean {
  return active !== null && active.path === filePath && active.kind === line.kind && active.oldNo === line.oldNo && active.newNo === line.newNo;
}
