import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { CommentsPanel } from "./client/comments-panel";
import { DiffPanel } from "./client/panel";
import { PR_COMMENTS_PANEL, setPanelOpener } from "./client/threads-store";

interface WorkspaceLike {
  id: string;
  projectKind: string;
  archivingAt?: string | null;
}

const PANEL_ID = "diff-context";

export default function contribute(client: PluginClientContext) {
  const removePanel = client.addWorkspacePanel({
    id: PANEL_ID,
    title: "Diff",
    icon: "FileDiff",
    context: "workspace",
    Component: DiffPanel,
  });

  const removeCommentsPanel = client.addWorkspacePanel({
    id: PR_COMMENTS_PANEL,
    title: "PR comments",
    icon: "MessageSquare",
    context: "workspace",
    locations: ["explorer", "workspace"],
    Component: CommentsPanel,
  });
  setPanelOpener(client);

  // Header buttons are registered per workspace, so follow the workspace list as it changes.
  const buttons = new Map<string, PluginButtonRegistration>();
  const sync = (workspace: WorkspaceLike) => {
    // Paseo may label a git checkout as a plain "directory" project, so only rule out known non-git ones.
    const eligible = workspace.projectKind !== "non_git" && !workspace.archivingAt;
    const existing = buttons.get(workspace.id);
    if (eligible && !existing) {
      buttons.set(
        workspace.id,
        client.addHeaderButton({
          id: "diff-context",
          workspaceId: workspace.id,
          button: {
            title: "Diff with expandable context",
            icon: "FileDiff",
            label: "Diff",
            behavior: { kind: "action", onPress: () => client.openPanel(PANEL_ID, { workspaceId: workspace.id }) },
          },
        }),
      );
    }
    if (!eligible && existing) {
      existing.remove();
      buttons.delete(workspace.id);
    }
  };

  const unsubscribe = client.paseo.workspaces.subscribe((update) => {
    if (update.kind === "upsert") sync(update.workspace);
    else {
      buttons.get(update.id)?.remove();
      buttons.delete(update.id);
    }
  });
  // `subscribe: {}` makes the daemon stream updates, so workspaces created later get the button too.
  let disposed = false;
  let release: (() => Promise<void>) | null = null;
  void client.paseo.workspaces.list({ subscribe: {} }).then(({ entries, subscription }) => {
    if (disposed) {
      void subscription.release();
      return;
    }
    release = () => subscription.release();
    entries.forEach(sync);
  });

  return () => {
    disposed = true;
    void release?.();
    unsubscribe();
    buttons.forEach((button) => button.remove());
    buttons.clear();
    removePanel();
    removeCommentsPanel();
  };
}
