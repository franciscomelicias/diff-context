import type { PluginClientContext } from "@getpaseo/plugin/client";
import { useSyncExternalStore } from "react";

export const PR_COMMENTS_PANEL = "pr-comments";

// The diff panel and the side panel are separate components; they share the selected thread through here.
let selected: string | null = null;
const listeners = new Set<() => void>();
let openPanel: ((workspaceId: string) => void) | null = null;

export function setPanelOpener(client: PluginClientContext) {
  openPanel = (workspaceId) => client.openPanel(PR_COMMENTS_PANEL, { workspaceId, location: "explorer" });
}

export function showThread(workspaceId: string, threadId: string) {
  selected = threadId;
  listeners.forEach((listener) => listener());
  openPanel?.(workspaceId);
}

export function useSelectedThread(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => selected,
  );
}
