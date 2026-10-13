import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { DiffMode, EditorId } from "../shared/diff";
import { git, resolveRefs } from "./diff";

const execFileAsync = promisify(execFile);
const HOME = homedir();
const APP_DIRS = ["/Applications", join(HOME, "Applications"), join(HOME, "Applications/JetBrains Toolbox")];

interface Editor {
  id: EditorId;
  label: string;
  apps: string[];
  /** Command-line launchers, tried before the app bundle because they can jump to a line. */
  clis: string[];
  /** Opens `directory` as the project with `file` focused at `line`. */
  open: (input: { cli: string | null; app: string; directory: string; file: string; line: number }) => [string, string[]];
}

const EDITORS: Editor[] = [
  {
    id: "intellij",
    label: "IntelliJ IDEA",
    apps: ["IntelliJ IDEA.app", "IntelliJ IDEA Ultimate.app", "IntelliJ IDEA CE.app"],
    clis: [join(HOME, "Library/Application Support/JetBrains/Toolbox/scripts/idea"), "/usr/local/bin/idea", "/opt/homebrew/bin/idea"],
    open: ({ cli, app, directory, file, line }) =>
      cli
        ? [cli, [directory, "--line", String(line), file]]
        : ["open", ["-na", app, "--args", directory, "--line", String(line), file]],
  },
  {
    id: "zed",
    label: "Zed",
    apps: ["Zed.app", "Zed Preview.app"],
    clis: ["/opt/homebrew/bin/zed", "/usr/local/bin/zed"],
    open: ({ cli, app, directory, file, line }) =>
      cli ? [cli, [directory, `${file}:${line}`]] : ["open", ["-a", app, directory, file]],
  },
  {
    id: "vscode",
    label: "VS Code",
    apps: ["Visual Studio Code.app"],
    clis: ["/opt/homebrew/bin/code", "/usr/local/bin/code"],
    open: ({ cli, directory, file, line }) =>
      cli ? [cli, [directory, "-g", `${file}:${line}`]] : ["open", [`vscode://file${file}:${line}`]],
  },
];

/** Editors installed on this Mac; only these get a button. */
export function listEditors() {
  return { editors: EDITORS.filter((editor) => findApp(editor) !== null).map(({ id, label }) => ({ id, label })) };
}

/** Opens the workspace as the project, on the file at its first changed line (top of the file when new or unchanged). */
export async function openInEditor({ directory, mode, path, editor }: { directory: string; mode: DiffMode; path: string; editor: EditorId }) {
  const definition = EDITORS.find((candidate) => candidate.id === editor);
  const app = definition && findApp(definition);
  if (!definition || !app) throw new Error(`${editor} is not installed`);
  const file = join(directory, path);
  const line = await firstChangedLine({ directory, mode, path });
  const cli = definition.clis.find(existsSync) ?? null;
  const [command, args] = definition.open({ cli, app, directory, file, line });
  await execFileAsync(command, args, { cwd: directory, timeout: 30_000 });
  return {};
}

/** Opens the whole workspace folder; every supported launcher and app takes a folder as is. */
export async function openProjectInEditor({ directory, editor }: { directory: string; editor: EditorId }) {
  const definition = EDITORS.find((candidate) => candidate.id === editor);
  const app = definition && findApp(definition);
  if (!definition || !app) throw new Error(`${editor} is not installed`);
  const cli = definition.clis.find(existsSync) ?? null;
  await execFileAsync(cli ?? "open", cli ? [directory] : ["-a", app, directory], { cwd: directory, timeout: 30_000 });
  return {};
}

async function firstChangedLine({ directory, mode, path }: { directory: string; mode: DiffMode; path: string }): Promise<number> {
  const { refs } = await resolveRefs(directory, mode);
  const patch = await git(directory, ["diff", "-U0", "--no-color", "--no-ext-diff", ...refs, "--", path]).catch(() => "");
  const match = patch.match(/^@@ -\d+(?:,\d+)? \+(\d+)/m);
  return Math.max(1, Number(match?.[1] ?? 1));
}

function findApp(editor: Editor): string | null {
  for (const dir of APP_DIRS) {
    for (const app of editor.apps) {
      if (existsSync(join(dir, app))) return join(dir, app);
    }
  }
  return null;
}
