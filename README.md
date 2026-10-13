# diff-context: Paseo plugin

A GitHub-style diff panel for any git workspace. Open it with the **Diff** button in the workspace header.

- **Branch** (changes since the branch left its base: the PR's base branch, else the default branch) or **Uncommitted** changes
- Stacked PRs: **Layer n/m** (default, only the current layer's changes) or **Stack** (everything since the trunk); uses gh-stack's local data when present
- Unified or split view, zoom, syntax colours from Paseo's own highlighter, word-level change highlights
- Settings (mode, view, zoom, colours, filters, file tree) are remembered across restarts
- Big diffs stay fast: only files near the screen are rendered; file headers (with the Viewed checkbox) stick to the top while scrolling
- Hidden lines between hunks: expand 20 up/down, show all, or expand the whole file
- **Viewed** checkbox per file (remembered), **Mark all viewed**, and a progress bar; a file that changes afterwards reopens showing only the changes since you viewed it
- Generated files (jOOQ codegen, lockfiles, minified bundles, `linguist-generated`) start collapsed and are marked viewed automatically
- **Filters** menu: hide whitespace changes, tests, generated files or translations (`translations/*.json`, `i18n/messages_*.properties`, `locales/`), colour theme
- **Search** the whole diff (⌘F): match count, Enter / Shift+Enter to jump between matches
- File tree with a filter box, renames shown as `old → new`; clicking a file jumps to it
- Comments: click or drag over line numbers (Shift+click extends), "Suggest change" inserts a ```suggestion block; send the comments to a Paseo agent in the same format as Paseo's built-in review (the send bar stays pinned at the top). Unsent comments survive restarts
- **✦ Ask AI** on selected lines: sends them with your question to an "Ask about diff" chat in the workspace
- GitHub PR review threads: click 💬 on a line to open its thread under it, then **Reply on GitHub**, **Add comment** (a follow-up for the agent that quotes the thread, not posted to GitHub) or **✦ Ask AI**. The 💬 count in a file header opens the **PR comments** side panel. Fetched on open and on refresh only
- A banner when the diff changed since you loaded it, with an **Update** button
- Shortcuts: `↓`/`↑` (or `j`/`k`) next/previous file, `v` viewed, `o` open/collapse, `/` filter files, `⌘F` search, `?` help

## Requirements

- Paseo >= 0.10.3 with plugins enabled: Settings → Plugins → Enable plugins
- Node.js and npm
- `gh` logged in (`gh auth status`): used to find a PR's base branch and its review comments. Without it, Branch mode compares with the default branch and no PR comments are shown.

## Install

```bash
mkdir -p ~/.paseo/plugins
git clone git@github.com:franciscomelicias/diff-context.git ~/.paseo/plugins/diff-context
cd ~/.paseo/plugins/diff-context
npm install
npm run typecheck
paseo plugin install ~/.paseo/plugins/diff-context
paseo plugin ls        # diff-context must be "running"
```

If `paseo` is not on your PATH, use `/Applications/Paseo.app/Contents/Resources/bin/paseo`.

## Update / debug

- Get the latest version: `cd ~/.paseo/plugins/diff-context && git pull && npm install && paseo plugin reload diff-context`
- After editing: `paseo plugin reload diff-context`
- Logs: `paseo plugin logs diff-context`
- Viewed state, settings and unsent comments: `~/.cache/diff-context/` (`viewed.json`, `prefs.json`, `drafts.json`)
- "+ New agent" when sending comments uses `claude/claude-opus-5-5` (`client/send-bar.tsx`); Ask AI uses `claude/claude-sonnet-5-5` (`client/ask.ts`)
- Generated / test file patterns: `GENERATED` and `TESTS` in `server/diff.ts`
