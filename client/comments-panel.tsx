import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { threadsRpc } from "../shared/diff";
import { useAskAgent } from "./ask";
import { createStyles } from "./styles";
import { ThreadCard, threadAskContext } from "./thread-card";
import { useSelectedThread } from "./threads-store";

/** The PR's GitHub review threads, opened from a 💬 icon in the diff; Ask AI talks a thread through. */
export function CommentsPanel({ workspaceId, theme, navigation }: PluginWorkspacePanelProps) {
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const listThreads = useRpc(threadsRpc);
  const selected = useSelectedThread();
  const [showResolved, setShowResolved] = useState(false);
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const threads = useQuery({
    queryKey: ["diff-threads", directory],
    queryFn: () => listThreads({ directory: directory ?? "" }),
    enabled: directory !== null,
    staleTime: 2 * 60 * 1000,
  });
  const ask = useAskAgent(workspaceId, threads.data?.pr ? `PR #${threads.data.pr.number}` : "this branch", navigation);

  const all = threads.data?.threads ?? [];
  const visible = all
    .filter((thread) => showResolved || !thread.isResolved || thread.id === selected)
    .sort((a, b) => Number(b.id === selected) - Number(a.id === selected));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.toolbar}>
        <Text style={styles.sendCount}>
          {threads.data?.pr ? `PR #${threads.data.pr.number} comments` : "PR comments"}
        </Text>
        <Pressable accessibilityRole="button" onPress={() => setShowResolved(!showResolved)}>
          <Text style={showResolved ? styles.tabActive : styles.tab}>
            {showResolved ? "All" : "Unresolved"} ({showResolved ? all.length : all.filter((t) => !t.isResolved).length})
          </Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => void threads.refetch()}>
          <Text style={styles.link}>{threads.isFetching ? "Loading…" : "Refresh"}</Text>
        </Pressable>
      </View>
      {threads.error ? <Text style={styles.error}>{String(threads.error)}</Text> : null}
      {threads.data && !threads.data.pr ? <Text style={styles.muted}>No open PR for this branch.</Text> : null}
      {threads.data?.pr && visible.length === 0 ? <Text style={styles.muted}>No unresolved comments.</Text> : null}
      {visible.map((thread) => (
        <ThreadCard
          key={thread.id}
          thread={thread}
          directory={directory ?? ""}
          showPath
          highlighted={thread.id === selected}
          onAsk={(question) => void ask(threadAskContext(thread, question))}
          styles={styles}
        />
      ))}
    </ScrollView>
  );
}
