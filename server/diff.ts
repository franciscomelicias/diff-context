import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { highlightCode, highlightLine, resolveSyntaxColors, SYNTAX_THEME_OPTIONS } from "@getpaseo/highlight";
import type { ChangedFile, DiffLine, DiffMode, Hunk, SearchMatch, Token } from "../shared/diff";

const execFileAsync = promisify(execFile);

// The daemon is launched by the desktop app, so its PATH usually lacks Homebrew.
const find = (name: string) =>
  [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `/usr/bin/${name}`].find(existsSync) ?? name;
const GIT = find("git");
const GH = find("gh");
const MAX_FILE_BYTES = 1024 * 1024;
// jOOQ codegen lands in persistence/jooq/db; the rest is what GitHub's linguist also treats as generated.
const GENERATED = [
  /(^|\/)persistence\/jooq\/db\//,
  /(^|\/)(yarn\.lock|package-lock\.json|pnpm-lock\.yaml|[^/]*\.lockfile)$/,
  /\.min\.(js|css)$/,
  /(^|\/)__snapshots__\//,
];
const TESTS = [
  /(^|\/)src\/(test|testFixtures|integrationTest|aiIntegrationTest)\//,
  /(^|\/)(test-utils|__tests__)\//,
  /\.(test|spec|ct)\.[jt]sx?$/,
  /(Test|Tests|IT)\.(java|kt)$/,
];
const MAX_SEARCH_MATCHES = 1000;
const TRANSLATIONS = [
  /(^|\/)translations\/[^/]+\.json$/,
  /(^|\/)i18n\/messages[^/]*\.properties$/,
  /(^|\/)locales?\/.+\.(json|ya?ml)$/,
  /\.po$/,
];
const BLOB_ID = /^[0-9a-f]{40}$/;
// The panel polls for changes; a PR's base branch rarely moves, so don't ask GitHub on every poll.
const PR_BASE_TTL_MS = 5 * 60 * 1000;
const PR_BASE_RETRY_MS = 60 * 1000;
const prBaseCache = new Map<string, { at: number; base: string }>();

export async function listFiles({
  directory,
  mode,
  ignoreWhitespace,
}: {
  directory: string;
  mode: DiffMode;
  ignoreWhitespace: boolean;
}) {
  const whitespace = ignoreWhitespace ? ["-w"] : [];
  const { refs, label, baseRef, stack } = await resolveRefs(directory, mode);
  // -z keeps paths verbatim and gives renames as separate old/new fields.
  const [numstat, raw] = await Promise.all([
    git(directory, ["diff", "-z", "--numstat", "-M", ...whitespace, ...refs]),
    git(directory, ["diff", "-z", "--raw", "--abbrev=40", "-M", ...refs]),
  ]);
  const rawByPath = parseRaw(raw);
  const markedGenerated = await linguistGenerated(directory, parseNumstat(numstat).map((entry) => entry.path));
  const files: ChangedFile[] = await Promise.all(
    parseNumstat(numstat).map(async ({ added, deleted, path, oldPath }) => {
      const binary = added === "-";
      const entry = rawByPath.get(path);
      return {
        path,
        oldPath,
        status: entry?.status ?? "M",
        additions: binary ? 0 : Number(added),
        deletions: binary ? 0 : Number(deleted),
        binary,
        fingerprint: await fingerprint({ directory, path, entry }),
        generated: markedGenerated.has(path) || GENERATED.some((pattern) => pattern.test(path)),
        test: TESTS.some((pattern) => pattern.test(path)),
        translation: TRANSLATIONS.some((pattern) => pattern.test(path)),
      };
    }),
  );
  if (mode === "uncommitted") {
    const untracked = await git(directory, ["ls-files", "--others", "--exclude-standard"]);
    for (const path of untracked.split("\n").filter(Boolean)) {
      const content = await readFile(join(directory, path), "utf8").catch(() => "");
      files.push({
        path,
        oldPath: null,
        status: "A",
        additions: splitLines(content).length,
        deletions: 0,
        binary: false,
        fingerprint: await fingerprint({ directory, path, entry: undefined }),
        generated: GENERATED.some((pattern) => pattern.test(path)),
        test: TESTS.some((pattern) => pattern.test(path)),
        translation: TRANSLATIONS.some((pattern) => pattern.test(path)),
      });
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return {
    compareLabel: label,
    baseRef,
    stack: stack && { position: stack.position, size: stack.size, parent: stack.parent, trunk: stack.trunk },
    files,
  };
}

export async function fileDiff({
  directory,
  mode,
  path,
  oldPath,
  ignoreWhitespace,
  since,
}: {
  directory: string;
  mode: DiffMode;
  path: string;
  oldPath: string | null;
  ignoreWhitespace: boolean;
  since: string | null;
}) {
  const whitespace = ignoreWhitespace ? ["-w"] : [];
  const { refs } = await resolveRefs(directory, mode);
  const newContent = await readNewContent({ directory, mode, path });
  if (newContent === null) return { hunks: [], newContent: [], newTokens: [], tooLarge: true };
  const newTokens = highlight(newContent, path);

  const tracked = await git(directory, ["ls-files", "--error-unmatch", "--", path]).then(
    () => true,
    () => mode === "branch",
  );
  if (!tracked) {
    const lines: DiffLine[] = newContent.map((text, index) => ({ kind: "add", text, oldNo: null, newNo: index + 1 }));
    return {
      hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: newContent.length, section: "", lines }],
      newContent,
      newTokens,
      tooLarge: false,
    };
  }
  const paths = oldPath ? [oldPath, path] : [path];
  // Since-last-view compares the two blob versions directly; only branch mode has blob ids to compare.
  const current = since && BLOB_ID.test(since) && mode !== "uncommitted" ? await git(directory, ["rev-parse", `HEAD:${path}`]).catch(() => "") : "";
  const patch = current
    ? await git(directory, ["diff", "--no-color", "--no-ext-diff", "-U3", ...whitespace, since as string, current])
    : await git(directory, ["diff", "--no-color", "--no-ext-diff", "-M", "-U3", ...whitespace, ...refs, "--", ...paths]);
  const hunks = parseHunks(patch).map((hunk) => ({
    ...hunk,
    lines: hunk.lines.map((line) => (line.kind === "del" ? { ...line, tokens: highlightDeleted(line.text, path) } : line)),
  }));
  return { hunks, newContent, newTokens, tooLarge: false };
}

/** Matches in the same diff the panel shows (3 lines of context), smart case like the client's highlight. */
export async function searchDiff({
  directory,
  mode,
  ignoreWhitespace,
  query,
}: {
  directory: string;
  mode: DiffMode;
  ignoreWhitespace: boolean;
  query: string;
}) {
  const sensitive = query !== query.toLowerCase();
  const contains = (text: string) => (sensitive ? text : text.toLowerCase()).includes(sensitive ? query : query.toLowerCase());
  const whitespace = ignoreWhitespace ? ["-w"] : [];
  const { refs } = await resolveRefs(directory, mode);
  const patch = await git(directory, ["-c", "core.quotePath=false", "diff", "--no-color", "--no-ext-diff", "-M", "-U3", ...whitespace, ...refs]);

  const matches: SearchMatch[] = [];
  for (const { path, body } of splitPatch(patch)) {
    for (const hunk of parseHunks(body)) {
      for (const line of hunk.lines) {
        if (contains(line.text)) matches.push({ path, kind: line.kind, oldNo: line.oldNo, newNo: line.newNo });
      }
    }
  }
  if (mode === "uncommitted") {
    const untracked = await git(directory, ["ls-files", "--others", "--exclude-standard"]);
    for (const path of untracked.split("\n").filter(Boolean)) {
      const content = await readFile(join(directory, path), "utf8").catch(() => "");
      if (content.length > MAX_FILE_BYTES) continue;
      splitLines(content).forEach((text, index) => {
        if (contains(text)) matches.push({ path, kind: "add", oldNo: null, newNo: index + 1 });
      });
    }
  }
  return { matches: matches.slice(0, MAX_SEARCH_MATCHES), truncated: matches.length > MAX_SEARCH_MATCHES };
}

/** One entry per file of a multi-file patch, keyed by its new path (old path for a deletion). */
function splitPatch(patch: string): { path: string; body: string }[] {
  const files: { path: string; lines: string[] }[] = [];
  let current: { path: string; lines: string[] } | null = null;
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      current = { path: "", lines: [] };
      files.push(current);
    } else if (current && current.lines.length === 0 && line.startsWith("--- a/")) {
      current.path = line.slice(6);
    } else if (current && current.lines.length === 0 && line.startsWith("+++ b/")) {
      current.path = line.slice(6);
    } else if (current && (line.startsWith("@@") || current.lines.length > 0)) {
      current.lines.push(line);
    }
  }
  return files.filter((file) => file.path).map((file) => ({ path: file.path, body: file.lines.join("\n") }));
}

/** Paseo's own highlighter and syntax themes, so the panel matches the built-in review colours. */
export function palettes() {
  return {
    themes: SYNTAX_THEME_OPTIONS.map((option) => ({ id: option.id, label: option.label })),
    palettes: Object.fromEntries(
      SYNTAX_THEME_OPTIONS.map((option) => [
        option.id,
        { light: resolveSyntaxColors(option.id, "light"), dark: resolveSyntaxColors(option.id, "dark") },
      ]),
    ),
  };
}

function highlight(lines: string[], path: string): Token[][] {
  try {
    return highlightCode(lines.join("\n"), path);
  } catch {
    return lines.map((text) => [{ text, style: null }]);
  }
}

function highlightDeleted(text: string, path: string): Token[] {
  try {
    return highlightLine(text, path);
  } catch {
    return [{ text, style: null }];
  }
}

/** Paths marked `linguist-generated` in .gitattributes, the way GitHub collapses them. */
function linguistGenerated(directory: string, paths: string[]): Promise<Set<string>> {
  if (paths.length === 0) return Promise.resolve(new Set());
  return new Promise((resolve) => {
    const child = spawn(GIT, ["check-attr", "--stdin", "-z", "linguist-generated"], { cwd: directory });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.on("error", () => resolve(new Set()));
    child.on("close", () => {
      const fields = output.split("\0");
      const marked = new Set<string>();
      for (let index = 0; index + 2 < fields.length; index += 3) {
        if (fields[index + 2] === "set" || fields[index + 2] === "true") marked.add(fields[index]);
      }
      resolve(marked);
    });
    child.stdin.end(paths.join("\0") + "\0");
  });
}

/** ":100644 100644 <old blob> <new blob> R087\0old\0new\0" — blob ids tell whether a file changed since it was viewed. */
function parseRaw(raw: string): Map<string, { status: string; oldBlob: string; newBlob: string }> {
  const result = new Map<string, { status: string; oldBlob: string; newBlob: string }>();
  const fields = raw.split("\0");
  for (let index = 0; index < fields.length; index++) {
    const meta = fields[index];
    if (!meta.startsWith(":")) continue;
    const [, , oldBlob, newBlob, status] = meta.split(" ");
    const paired = status.startsWith("R") || status.startsWith("C");
    const path = fields[index + (paired ? 2 : 1)];
    index += paired ? 2 : 1;
    result.set(path, { status, oldBlob, newBlob });
  }
  return result;
}

/** "add\tdel\tpath\0", or for a rename "add\tdel\t\0old\0new\0". */
function parseNumstat(numstat: string): { added: string; deleted: string; path: string; oldPath: string | null }[] {
  const entries: { added: string; deleted: string; path: string; oldPath: string | null }[] = [];
  const fields = numstat.split("\0");
  for (let index = 0; index < fields.length; index++) {
    const [added, deleted, path] = fields[index].split("\t");
    if (deleted === undefined) continue;
    if (path) {
      entries.push({ added, deleted, path, oldPath: null });
      continue;
    }
    entries.push({ added, deleted, oldPath: fields[index + 1], path: fields[index + 2] });
    index += 2;
  }
  return entries;
}

async function fingerprint(input: {
  directory: string;
  path: string;
  entry: { oldBlob: string; newBlob: string } | undefined;
}): Promise<string> {
  const { directory, path, entry } = input;
  const unhashed = !entry || /^0+$/.test(entry.newBlob);
  if (!unhashed) return entry.newBlob;
  // Working-tree files have no blob id yet; size + mtime changes whenever the file is edited.
  const info = await stat(join(directory, path)).catch(() => null);
  return info ? `wt:${info.size}:${info.mtimeMs}` : `deleted:${entry?.oldBlob ?? ""}`;
}

async function readNewContent(input: { directory: string; mode: DiffMode; path: string }): Promise<string[] | null> {
  const { directory, mode, path } = input;
  if (mode === "uncommitted") {
    const absolute = join(directory, path);
    const info = await stat(absolute).catch(() => null);
    if (!info) return [];
    if (info.size > MAX_FILE_BYTES) return null;
    return splitLines(await readFile(absolute, "utf8"));
  }
  const content = await git(directory, ["show", `HEAD:${path}`]).catch(() => "");
  return content.length > MAX_FILE_BYTES ? null : splitLines(content);
}

function parseHunks(patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  for (const line of patch.split("\n")) {
    const header = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/);
    if (header) {
      current = {
        oldStart: Number(header[1]),
        oldLines: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newLines: header[4] === undefined ? 1 : Number(header[4]),
        section: header[5] ?? "",
        lines: [],
      };
      hunks.push(current);
      oldNo = current.oldStart;
      newNo = current.newStart;
      continue;
    }
    if (!current) continue;
    if (line.startsWith("+")) current.lines.push({ kind: "add", text: line.slice(1), oldNo: null, newNo: newNo++ });
    else if (line.startsWith("-")) current.lines.push({ kind: "del", text: line.slice(1), oldNo: oldNo++, newNo: null });
    else if (line.startsWith(" ")) current.lines.push({ kind: "ctx", text: line.slice(1), oldNo: oldNo++, newNo: newNo++ });
  }
  return hunks;
}

/** Same two views as Paseo's own diff: working tree vs HEAD, or the branch vs its merge base. */
interface StackInfo {
  position: number | null;
  size: number | null;
  parent: string;
  trunk: string;
  /** The parent commit gh-stack last rebased this layer onto; survives the parent being rebased later. */
  recordedBase: string | null;
}

/** Same views as Paseo's own diff (working tree vs HEAD, branch vs its base), plus one layer of a stack. */
async function resolveRefs(
  directory: string,
  mode: DiffMode,
): Promise<{ refs: string[]; label: string; baseRef: string | null; stack: StackInfo | null }> {
  const branch = await git(directory, ["branch", "--show-current"]);
  const trunk = await defaultBranch(directory);
  const stack = branch ? await stackInfo({ directory, branch, trunk }) : null;
  if (mode === "uncommitted") return { refs: ["HEAD"], label: "Uncommitted changes vs HEAD", baseRef: null, stack };

  if (stack && mode === "branch") {
    const base = await layerBase(directory, stack);
    const where = stack.position && stack.size ? ` · layer ${stack.position}/${stack.size}` : "";
    return { refs: [base, "HEAD"], label: `${branch} vs ${stack.parent}${where}`, baseRef: base, stack };
  }
  const against = stack?.trunk ?? trunk;
  const mergeBase = await git(directory, ["merge-base", `origin/${against}`, "HEAD"]);
  const label = stack ? `All layers up to ${branch} vs origin/${against}` : `${branch || "HEAD"} vs origin/${against}`;
  return { refs: [mergeBase, "HEAD"], label, baseRef: `origin/${against}`, stack };
}

/** gh-stack's local file first (no GitHub call, knows each layer's recorded base), then the PR's base branch. */
async function stackInfo(input: { directory: string; branch: string; trunk: string }): Promise<StackInfo | null> {
  const { directory, branch, trunk } = input;
  for (const stack of await readLocalStacks(directory)) {
    const index = stack.branches.findIndex((entry) => entry.branch === branch);
    if (index === -1 || stack.branches.length < 2) continue;
    return {
      position: index + 1,
      size: stack.branches.length,
      parent: index === 0 ? stack.trunk.branch : stack.branches[index - 1].branch,
      trunk: stack.trunk.branch,
      recordedBase: stack.branches[index].base ?? null,
    };
  }
  const prBase = await cachedPrBase(directory, branch);
  if (!prBase || prBase === trunk) return null;
  return { position: null, size: null, parent: prBase, trunk, recordedBase: null };
}

/**
 * Where this layer starts: of every plausible base that lies in HEAD's history (the parent's local and remote
 * tips, the commit gh-stack recorded, the merge base with the parent), the most recent one. A stale local
 * `develop`, or a parent rebased after this layer, then never drags older commits into the layer's diff.
 */
async function layerBase(directory: string, stack: StackInfo): Promise<string> {
  const remoteParent = `origin/${stack.parent}`;
  const hasRemote = (await git(directory, ["rev-parse", "--verify", "--quiet", remoteParent]).catch(() => "")) !== "";
  const mergeBase = await git(directory, ["merge-base", hasRemote ? remoteParent : stack.parent, "HEAD"]).catch(() => "");
  const candidates: string[] = [];
  for (const ref of [stack.parent, remoteParent, stack.recordedBase, mergeBase]) {
    if (!ref) continue;
    const sha = await git(directory, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).catch(() => "");
    if (sha && !candidates.includes(sha) && (await isAncestor(directory, sha, "HEAD"))) candidates.push(sha);
  }
  let newest = candidates[0] ?? mergeBase;
  for (const sha of candidates.slice(1)) {
    if (await isAncestor(directory, newest, sha)) newest = sha;
  }
  return newest;
}

function isAncestor(directory: string, ancestor: string, descendant: string): Promise<boolean> {
  return git(directory, ["merge-base", "--is-ancestor", ancestor, descendant]).then(
    () => true,
    () => false,
  );
}

async function readLocalStacks(
  directory: string,
): Promise<{ trunk: { branch: string }; branches: { branch: string; base?: string }[] }[]> {
  try {
    const commonDir = await git(directory, ["rev-parse", "--git-common-dir"]);
    const file = join(isAbsolute(commonDir) ? commonDir : join(directory, commonDir), "gh-stack");
    return JSON.parse(await readFile(file, "utf8")).stacks ?? [];
  } catch {
    return [];
  }
}

async function defaultBranch(directory: string): Promise<string> {
  const ref = await git(directory, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).catch(() => "origin/develop");
  return ref.replace(/^origin\//, "");
}

/** Only successful lookups are cached long; a failure (rate limit, offline) is retried after a minute. */
async function cachedPrBase(directory: string, branch: string): Promise<string> {
  const key = `${directory}:${branch}`;
  const cached = prBaseCache.get(key);
  if (cached && Date.now() - cached.at < (cached.base ? PR_BASE_TTL_MS : PR_BASE_RETRY_MS)) return cached.base;
  const base = await run(GH, ["pr", "view", branch, "--json", "baseRefName", "--jq", ".baseRefName"], directory)
    .then((output) => output.trim())
    .catch(() => "");
  prBaseCache.set(key, { at: Date.now(), base });
  return base;
}

function splitLines(content: string): string[] {
  if (content.length === 0) return [];
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

async function git(directory: string, args: string[]): Promise<string> {
  return (await run(GIT, args, directory)).replace(/\n$/, "");
}

async function run(command: string, args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    cwd,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    maxBuffer: 50 * 1024 * 1024,
    timeout: 60_000,
  });
  return stdout;
}
