import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { usePaseo } from "@getpaseo/plugin/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { DiffMode } from "../shared/diff";
import { toAttachmentComment, useComments } from "./comments";
import type { Styles } from "./styles";

const NEW_AGENT_PROVIDER = "claude/claude-opus-5-5";
const MESSAGE = "Please address my review comments on the diff.";

/** Sends the comments the way Paseo's own review does: an application/paseo-review attachment. */
export function SendBar({
  workspaceId,
  directory,
  mode,
  baseRef,
  commentsKey,
  navigation,
  styles,
}: {
  workspaceId: string;
  directory: string;
  mode: DiffMode;
  baseRef: string | null;
  commentsKey: string;
  navigation: PluginWorkspacePanelProps["navigation"];
  styles: Styles;
}) {
  const paseo = usePaseo();
  const { comments, clear } = useComments(commentsKey);
  const [picking, setPicking] = useState(false);
  const agents = useQuery({
    queryKey: ["diff-agents", workspaceId],
    queryFn: async () => {
      const { entries } = await paseo.agents.list();
      return entries
        .map((entry) => entry.agent)
        .filter((agent) => agent.workspaceId === workspaceId && !agent.archivedAt);
    },
    enabled: picking,
  });

  const attachment = {
    type: "review" as const,
    mimeType: "application/paseo-review" as const,
    cwd: directory,
    mode: mode === "uncommitted" ? ("uncommitted" as const) : ("base" as const),
    baseRef,
    comments: comments.map(toAttachmentComment),
  };
  const send = useMutation({
    mutationFn: async (agentId: string | null) => {
      if (agentId) {
        await paseo.agents.ref(agentId).send(MESSAGE, { attachments: [attachment] });
        return agentId;
      }
      const agent = await paseo.workspaces.ref(workspaceId).agents.create({
        config: { provider: NEW_AGENT_PROVIDER },
        prompt: MESSAGE,
        attachments: [attachment],
      });
      return agent.id;
    },
    onSuccess: (agentId) => {
      clear();
      setPicking(false);
      navigation?.openAgent({ agentId });
    },
  });

  if (comments.length === 0) return null;
  return (
    <View style={styles.sendBarPinned}>
      <View style={styles.toolbar}>
        <Text style={styles.sendCount}>
          {comments.length} comment{comments.length === 1 ? "" : "s"}
        </Text>
        <Pressable accessibilityRole="button" disabled={send.isPending} onPress={() => setPicking(!picking)}>
          <Text style={styles.tabActive}>{send.isPending ? "Sending…" : "Send to agent ▾"}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={clear}>
          <Text style={styles.linkDanger}>Discard all</Text>
        </Pressable>
      </View>
      {picking ? (
        <View style={styles.toolbar}>
          {agents.isLoading ? <Text style={styles.muted}>Loading agents…</Text> : null}
          {(agents.data ?? []).map((agent) => (
            <Pressable key={agent.id} accessibilityRole="button" onPress={() => send.mutate(agent.id)}>
              <Text style={styles.tab}>{agent.title ?? agent.id.slice(0, 8)}</Text>
            </Pressable>
          ))}
          <Pressable accessibilityRole="button" onPress={() => send.mutate(null)}>
            <Text style={styles.tab}>+ New agent</Text>
          </Pressable>
        </View>
      ) : null}
      {send.error ? <Text style={styles.error}>{String(send.error)}</Text> : null}
    </View>
  );
}
