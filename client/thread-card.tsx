import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { threadReplyRpc, type ReviewThread } from "../shared/diff";
import type { Styles } from "./styles";

/** A GitHub review thread: its comments, a reply box that posts to GitHub, Ask AI and a link to GitHub. */
export function ThreadCard({
  thread,
  directory,
  showPath,
  highlighted,
  onAsk,
  onAddComment,
  onClose,
  styles,
}: {
  thread: ReviewThread;
  directory: string;
  showPath: boolean;
  highlighted?: boolean;
  onAsk: ((question: string) => void) | null;
  /** Saves the text as one of your own line comments (sent to the agent with the others), not on GitHub. */
  onAddComment?: (body: string) => void;
  onClose?: () => void;
  styles: Styles;
}) {
  const reply = useRpc(threadReplyRpc);
  const queryClient = useQueryClient();
  const [replying, setReplying] = useState(false);
  const [body, setBody] = useState("");
  const [added, setAdded] = useState(false);
  const send = useMutation({
    mutationFn: () => reply({ directory, threadId: thread.id, body: body.trim() }),
    onSuccess: () => {
      setBody("");
      setReplying(false);
      void queryClient.invalidateQueries({ queryKey: ["diff-threads", directory] });
    },
  });
  const empty = body.trim().length === 0;

  return (
    <View style={[styles.threadCard, highlighted ? styles.threadCardSelected : null]}>
      <View style={styles.toolbar}>
        {showPath ? (
          <Text style={styles.threadPath} numberOfLines={2}>
            {thread.path}
            {thread.line ? `:${thread.line}` : ""}
          </Text>
        ) : null}
        {thread.isResolved ? <Text style={styles.generatedBadge}>resolved</Text> : null}
        {thread.isOutdated ? <Text style={styles.generatedBadge}>outdated</Text> : null}
        {onClose ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Hide comments" onPress={onClose} style={{ marginLeft: "auto" }}>
            <Text style={styles.muted}>✕</Text>
          </Pressable>
        ) : null}
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
      {replying ? (
        <TextInput
          autoFocus
          multiline
          value={body}
          onChangeText={setBody}
          placeholder={onAddComment ? "Reply on GitHub, add a comment for the agent, or ask ✦ AI…" : "Reply on GitHub, or a question for ✦ Ask AI…"}
          placeholderTextColor={styles.placeholder.color}
          style={styles.commentInput}
        />
      ) : null}
      {send.error ? <Text style={styles.error}>{String(send.error)}</Text> : null}
      {added && !replying ? <Text style={styles.success}>Added to your comments: send them to the agent from the bar at the top.</Text> : null}
      <View style={styles.commentActions}>
        {replying ? (
          <>
            <Pressable accessibilityRole="button" disabled={empty || send.isPending} onPress={() => send.mutate()}>
              <Text style={empty ? styles.buttonDisabledText : styles.primaryButton}>{send.isPending ? "Sending…" : "Reply on GitHub"}</Text>
            </Pressable>
            {onAddComment ? (
              <Pressable
                accessibilityRole="button"
                disabled={empty}
                onPress={() => {
                  onAddComment(body.trim());
                  setBody("");
                  setReplying(false);
                  setAdded(true);
                }}
              >
                <Text style={empty ? styles.buttonDisabledText : styles.link}>Add comment</Text>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" onPress={() => setReplying(false)}>
              <Text style={styles.link}>Cancel</Text>
            </Pressable>
          </>
        ) : (
          <Pressable accessibilityRole="button" onPress={() => setReplying(true)}>
            <Text style={styles.primaryButton}>{onAddComment ? "Reply / comment" : "Reply"}</Text>
          </Pressable>
        )}
        {onAsk ? (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              onAsk(
                body.trim() ||
                  "Help me understand this review comment: what is the reviewer asking, is it right, and how should I address or answer it?",
              )
            }
          >
            <Text style={styles.link}>✦ Ask AI</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="link" onPress={() => void openExternalUrl(thread.comments[0]?.url ?? "")}>
          <Text style={styles.link}>Open on GitHub ↗</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** What Ask AI receives for a thread: where it is and the conversation so far. */
export function threadAskContext(thread: ReviewThread, question: string) {
  return {
    filePath: thread.path,
    lines: thread.line ? `line ${thread.line}` : "(outdated position)",
    code: thread.comments.map((comment) => `@${comment.author}: ${comment.body}`).join("\n\n"),
    question,
  };
}
