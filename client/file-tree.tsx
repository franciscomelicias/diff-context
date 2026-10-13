import { useState, type RefObject } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { ChangedFile } from "../shared/diff";
import type { Styles } from "./styles";

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  file: ChangedFile | null;
}

export function FileTree({
  files,
  isViewed,
  currentPath,
  onSelect,
  searchRef,
  styles,
}: {
  files: ChangedFile[];
  isViewed: (file: ChangedFile) => boolean;
  currentPath: string | null;
  onSelect: (file: ChangedFile) => void;
  searchRef: RefObject<TextInput | null>;
  styles: Styles;
}) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "unviewed">("all");
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const visible = files
    .filter((file) => filter === "all" || !isViewed(file))
    .filter((file) => terms.every((term) => `${file.oldPath ?? ""} ${file.path}`.toLowerCase().includes(term)));
  const root = compress(buildTree(visible));

  const toggle = (path: string) => {
    const next = new Set(collapsed);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setCollapsed(next);
  };

  const renderNode = (node: TreeNode, depth: number) => {
    if (node.file) {
      const file = node.file;
      return (
        <Pressable
          key={node.path}
          accessibilityRole="link"
          onPress={() => onSelect(file)}
          style={[styles.treeItem, file.path === currentPath ? styles.treeItemCurrent : null, { paddingLeft: 8 + depth * 12 }]}
        >
          <Text style={statusStyle(file.status, styles)}>{statusIcon(file.status)}</Text>
          <Text style={isViewed(file) ? styles.treeFileViewed : styles.treeFile} numberOfLines={1}>
            {node.name}
          </Text>
        </Pressable>
      );
    }
    const open = !collapsed.has(node.path);
    return (
      <View key={node.path}>
        <Pressable accessibilityRole="button" onPress={() => toggle(node.path)} style={[styles.treeItem, { paddingLeft: 8 + depth * 12 }]}>
          <Text style={styles.treeDir} numberOfLines={1}>
            {open ? "▾" : "▸"} {node.name}
          </Text>
        </Pressable>
        {open ? node.children.map((child) => renderNode(child, depth + 1)) : null}
      </View>
    );
  };

  return (
    <View style={styles.treePane}>
      <TextInput
        ref={searchRef}
        value={query}
        onChangeText={setQuery}
        placeholder="Filter files…  ( / )"
        placeholderTextColor={styles.muted.color}
        style={styles.treeSearch}
      />
      <View style={styles.treeFilter}>
        {(["all", "unviewed"] as const).map((option) => (
          <Pressable key={option} accessibilityRole="button" onPress={() => setFilter(option)}>
            <Text style={filter === option ? styles.tabActive : styles.tab}>{option === "all" ? "All" : "Unviewed"}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView style={styles.treeScroll}>
        {root.children.map((child) => renderNode(child, 0))}
        {visible.length === 0 ? <Text style={[styles.muted, { padding: 8 }]}>No matching files.</Text> : null}
      </ScrollView>
    </View>
  );
}

function buildTree(files: ChangedFile[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: [], file: null };
  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join("/");
      let child = node.children.find((candidate) => candidate.name === part && candidate.file === null);
      if (index === parts.length - 1) {
        node.children.push({ name: part, path, children: [], file });
        return;
      }
      if (!child) {
        child = { name: part, path, children: [], file: null };
        node.children.push(child);
      }
      node = child;
    });
  }
  return root;
}

/** Folds single-child folder chains into one row, like GitHub's "src/main/java/com/…". */
function compress(node: TreeNode): TreeNode {
  let current = { ...node, children: node.children.map(compress) };
  while (current.file === null && current.name !== "" && current.children.length === 1 && current.children[0].file === null) {
    const only = current.children[0];
    current = { ...only, name: `${current.name}/${only.name}` };
  }
  current.children.sort((a, b) => Number(a.file !== null) - Number(b.file !== null) || a.name.localeCompare(b.name));
  return current;
}

function statusIcon(status: string): string {
  if (status.startsWith("R")) return "→";
  if (status.startsWith("A")) return "+";
  if (status.startsWith("D")) return "−";
  return "•";
}

function statusStyle(status: string, styles: Styles) {
  if (status.startsWith("A")) return styles.treeStatusAdd;
  if (status.startsWith("D")) return styles.treeStatusDel;
  return styles.treeStatusMod;
}
