import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { openExternalUrl, useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { threadsRpc, type ReviewThread } from "../shared/diff";
import { useAskAgent } from "./ask";
import { createStyles, type Styles } from "./styles";
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
          highlighted={thread.id === selected}
          onAsk={() =>
            void ask({
              filePath: thread.path,
              lines: thread.line ? `line ${thread.line}` : "(outdated position)",
              code: thread.comments.map((comment) => `@${comment.author}: ${comment.body}`).join("\n\n"),
              question: "Help me understand this review comment: what is the reviewer asking, is it right, and how should I address or answer it?",
            })
          }
          styles={styles}
        />
      ))}
    </ScrollView>
  );
}

function ThreadCard({
  thread,
  highlighted,
  onAsk,
  styles,
}: {
  thread: ReviewThread;
  highlighted: boolean;
  onAsk: () => void;
  styles: Styles;
}) {
  return (
    <View style={[styles.threadCard, highlighted ? styles.threadCardSelected : null]}>
      <View style={styles.toolbar}>
        <Text style={styles.threadPath} numberOfLines={2}>
          {thread.path}
          {thread.line ? `:${thread.line}` : ""}
        </Text>
        {thread.isResolved ? <Text style={styles.generatedBadge}>resolved</Text> : null}
        {thread.isOutdated ? <Text style={styles.generatedBadge}>outdated</Text> : null}
      </View>
      {thread.comments.map((comment) => (
        <View key={comment.url} style={styles.threadComment}>
          <Text style={styles.threadAuthor}>
            @{comment.author} <Text style={styles.muted}>{new Date(comment.createdAt).toLocaleDateString()}</Text>
          </Text>
          <Text selectable style={styles.commentBody}>
            {comment.body}
          </Text>
        </View>
      ))}
      <View style={styles.commentActions}>
        <Pressable accessibilityRole="button" onPress={onAsk}>
          <Text style={styles.primaryButton}>✦ Ask AI</Text>
        </Pressable>
        <Pressable accessibilityRole="link" onPress={() => void openExternalUrl(thread.comments[0]?.url ?? "")}>
          <Text style={styles.link}>Open on GitHub ↗</Text>
        </Pressable>
      </View>
    </View>
  );
}
