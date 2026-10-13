import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type RefObject } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { searchRpc, type DiffMode, type SearchMatch } from "../shared/diff";
import type { Styles } from "./styles";

const DEBOUNCE_MS = 300;
const MIN_QUERY = 2;

/** Search box for the whole diff: Enter / Shift+Enter (or ↓ / ↑) walk the matches, Escape clears. */
export function SearchBar({
  directory,
  mode,
  ignoreWhitespace,
  fileOrder,
  onQuery,
  onGo,
  inputRef,
  styles,
}: {
  directory: string;
  mode: DiffMode;
  ignoreWhitespace: boolean;
  /** Paths in the order the panel lists them; matches in other (hidden) files are left out. */
  fileOrder: string[];
  onQuery: (query: string) => void;
  onGo: (match: SearchMatch | null) => void;
  inputRef: RefObject<TextInput | null>;
  styles: Styles;
}) {
  const search = useRpc(searchRpc);
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState(-1);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.length >= MIN_QUERY ? text : ""), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  useEffect(() => {
    onQuery(query);
    setPosition(-1);
    onGo(null);
  }, [query]);

  const result = useQuery({
    queryKey: ["diff-search", directory, mode, ignoreWhitespace, query],
    queryFn: () => search({ directory, mode, ignoreWhitespace, query }),
    enabled: query.length > 0,
    staleTime: 30 * 1000,
  });
  const order = new Map(fileOrder.map((path, index) => [path, index]));
  const matches = (result.data?.matches ?? [])
    .filter((match) => order.has(match.path))
    .sort((a, b) => (order.get(a.path) ?? 0) - (order.get(b.path) ?? 0));

  const step = (direction: 1 | -1) => {
    if (matches.length === 0) return;
    const next = position === -1 ? (direction === 1 ? 0 : matches.length - 1) : (position + direction + matches.length) % matches.length;
    setPosition(next);
    onGo(matches[next]);
  };
  const clear = () => {
    setText("");
    setQuery("");
  };

  return (
    <View style={styles.searchBox}>
      <Text style={styles.muted}>⌕</Text>
      <TextInput
        ref={inputRef}
        value={text}
        onChangeText={setText}
        placeholder="Search diff (⌘F)"
        placeholderTextColor={styles.placeholder.color}
        style={styles.searchInput}
        onKeyPress={(event) => {
          const { key, shiftKey } = event.nativeEvent as { key: string; shiftKey?: boolean };
          if (key === "Enter") {
            event.preventDefault();
            step(shiftKey ? -1 : 1);
          } else if (key === "Escape") clear();
        }}
      />
      {query ? (
        <Text style={styles.muted}>
          {result.isFetching
            ? "…"
            : matches.length === 0
              ? "No results"
              : `${position === -1 ? "–" : position + 1} / ${matches.length}${result.data?.truncated ? "+" : ""}`}
        </Text>
      ) : null}
      {matches.length > 0 ? (
        <>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous match" onPress={() => step(-1)}>
            <Text style={styles.link}>↑</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Next match" onPress={() => step(1)}>
            <Text style={styles.link}>↓</Text>
          </Pressable>
        </>
      ) : null}
      {text ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={clear}>
          <Text style={styles.muted}>✕</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
