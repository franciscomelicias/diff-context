import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** branch = this branch's own changes (one layer when stacked); stack = every layer up to here vs the trunk. */
export const modeSchema = z.enum(["uncommitted", "branch", "stack"]);
export type DiffMode = z.infer<typeof modeSchema>;

const fileSchema = z.object({
  path: z.string(),
  /** Set when git detected a rename; the diff then only shows the real edits. */
  oldPath: z.string().nullable(),
  status: z.string(),
  additions: z.number(),
  deletions: z.number(),
  binary: z.boolean(),
  /** Changes whenever the file's content changes, so "Viewed" resets like on GitHub. */
  fingerprint: z.string(),
  /** Lockfiles, codegen output, minified bundles, or linguist-generated in .gitattributes. */
  generated: z.boolean(),
  test: z.boolean(),
  translation: z.boolean(),
});

export type ChangedFile = z.infer<typeof fileSchema>;

const tokenSchema = z.object({ text: z.string(), style: z.string().nullable() });
export type Token = z.infer<typeof tokenSchema>;

const lineSchema = z.object({
  kind: z.enum(["add", "del", "ctx"]),
  text: z.string(),
  oldNo: z.number().nullable(),
  newNo: z.number().nullable(),
  /** Only on deleted lines; other lines take their colours from newTokens. */
  tokens: z.array(tokenSchema).optional(),
});

export type DiffLine = z.infer<typeof lineSchema>;

const hunkSchema = z.object({
  oldStart: z.number(),
  oldLines: z.number(),
  newStart: z.number(),
  newLines: z.number(),
  /** The enclosing function or class git prints after the hunk range. */
  section: z.string(),
  lines: z.array(lineSchema),
});

export type Hunk = z.infer<typeof hunkSchema>;

export const filesRpc = defineRpc({
  name: "diff.files",
  input: z.object({ directory: z.string(), mode: modeSchema, ignoreWhitespace: z.boolean() }),
  output: z.object({
    compareLabel: z.string(),
    baseRef: z.string().nullable(),
    /** Set when the branch is a layer of a stacked PR, whatever the mode, so the panel can offer the layer toggle. */
    stack: z
      .object({ position: z.number().nullable(), size: z.number().nullable(), parent: z.string(), trunk: z.string() })
      .nullable(),
    files: z.array(fileSchema),
  }),
});

export const fileDiffRpc = defineRpc({
  name: "diff.file",
  input: z.object({
    directory: z.string(),
    mode: modeSchema,
    path: z.string(),
    oldPath: z.string().nullable(),
    ignoreWhitespace: z.boolean(),
    /** Blob id the file had when it was marked viewed: diff only what changed since. */
    since: z.string().nullable(),
  }),
  output: z.object({
    hunks: z.array(hunkSchema),
    /** The file after the change, so the unchanged lines between hunks can be revealed. */
    newContent: z.array(z.string()),
    newTokens: z.array(z.array(tokenSchema)),
    tooLarge: z.boolean(),
  }),
});

export const palettesRpc = defineRpc({
  name: "diff.palettes",
  input: z.object({}),
  output: z.object({
    themes: z.array(z.object({ id: z.string(), label: z.string() })),
    palettes: z.record(z.string(), z.object({ light: z.record(z.string(), z.string()), dark: z.record(z.string(), z.string()) })),
  }),
});

export const viewedGetRpc = defineRpc({
  name: "viewed.get",
  input: z.object({ key: z.string() }),
  output: z.object({ viewed: z.record(z.string(), z.string()) }),
});

export const viewedSetRpc = defineRpc({
  name: "viewed.set",
  input: z.object({ key: z.string(), changes: z.record(z.string(), z.string().nullable()) }),
  output: z.object({ viewed: z.record(z.string(), z.string()) }),
});

const threadSchema = z.object({
  id: z.string(),
  path: z.string(),
  /** Line in the PR's current diff; null when the thread is outdated (its code changed since). */
  line: z.number().nullable(),
  side: z.enum(["LEFT", "RIGHT"]),
  isResolved: z.boolean(),
  isOutdated: z.boolean(),
  comments: z.array(z.object({ author: z.string(), body: z.string(), createdAt: z.string(), url: z.string() })),
});

export type ReviewThread = z.infer<typeof threadSchema>;

export const threadsRpc = defineRpc({
  name: "diff.threads",
  input: z.object({ directory: z.string() }),
  output: z.object({
    pr: z.object({ number: z.number(), url: z.string(), title: z.string() }).nullable(),
    threads: z.array(threadSchema),
  }),
});

const searchMatchSchema = z.object({
  path: z.string(),
  kind: z.enum(["add", "del", "ctx"]),
  oldNo: z.number().nullable(),
  newNo: z.number().nullable(),
});

export type SearchMatch = z.infer<typeof searchMatchSchema>;

/** Text search over every file's diff, so it finds lines in files the virtualised list has not rendered. */
export const searchRpc = defineRpc({
  name: "diff.search",
  input: z.object({ directory: z.string(), mode: modeSchema, ignoreWhitespace: z.boolean(), query: z.string() }),
  output: z.object({ matches: z.array(searchMatchSchema), truncated: z.boolean() }),
});

/** Posts a reply to a GitHub review thread (one GraphQL mutation, only on click). */
export const threadReplyRpc = defineRpc({
  name: "diff.thread.reply",
  input: z.object({ directory: z.string(), threadId: z.string(), body: z.string() }),
  output: z.object({}),
});

export const editorIdSchema = z.enum(["zed", "vscode", "intellij"]);
export type EditorId = z.infer<typeof editorIdSchema>;

/** Code editors installed on this machine. */
export const editorsRpc = defineRpc({
  name: "editors.list",
  input: z.object({}),
  output: z.object({ editors: z.array(z.object({ id: editorIdSchema, label: z.string() })) }),
});

export const openInEditorRpc = defineRpc({
  name: "editors.open",
  input: z.object({ directory: z.string(), mode: modeSchema, path: z.string(), editor: editorIdSchema }),
  output: z.object({}),
});

export const openProjectInEditorRpc = defineRpc({
  name: "editors.open.project",
  input: z.object({ directory: z.string(), editor: editorIdSchema }),
  output: z.object({}),
});

/** Small JSON documents the daemon keeps across restarts: panel settings, unsent comment drafts. */
export const storeGetRpc = defineRpc({
  name: "store.get",
  input: z.object({ space: z.enum(["prefs", "drafts"]), key: z.string() }),
  output: z.object({ value: z.unknown() }),
});

export const storeSetRpc = defineRpc({
  name: "store.set",
  input: z.object({ space: z.enum(["prefs", "drafts"]), key: z.string(), value: z.unknown() }),
  output: z.object({}),
});
