import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { usePaseo } from "@getpaseo/plugin/client";
import { createContext } from "react";

export interface AskInput {
  filePath: string;
  lines: string;
  code: string;
  question: string;
}

export type Ask = (input: AskInput) => Promise<void>;

export const AskContext = createContext<Ask | null>(null);

const TITLE = "Ask about diff";
const PROVIDER = "claude/claude-sonnet-5-5";
const INTRO = `You answer my questions about code I am reviewing in this workspace.
Read the surrounding code when it helps. This is read-only: do not edit files, commit, push or post anything.
Keep answers short and concrete.`;

/** One "Ask about diff" chat per workspace: questions land there, so the working agent's thread stays clean. */
export function useAskAgent(workspaceId: string, compareLabel: string, navigation: PluginWorkspacePanelProps["navigation"]): Ask {
  const paseo = usePaseo();
  return async ({ filePath, lines, code, question }) => {
    const message = `In \`${filePath}\` ${lines} (${compareLabel}):\n\n\`\`\`diff\n${code}\n\`\`\`\n\n${question}`;
    const { entries } = await paseo.agents.list();
    const existing = entries
      .map((entry) => entry.agent)
      .find((agent) => agent.workspaceId === workspaceId && agent.title === TITLE && !agent.archivedAt);
    if (existing) {
      await paseo.agents.ref(existing.id).send(message);
      navigation?.openAgent({ agentId: existing.id });
      return;
    }
    const agent = await paseo.workspaces.ref(workspaceId).agents.create({
      config: { provider: PROVIDER },
      title: TITLE,
      prompt: `${INTRO}\n\n${message}`,
    });
    navigation?.openAgent({ agentId: agent.id });
  };
}
