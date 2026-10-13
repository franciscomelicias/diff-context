import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import type { ReviewThread } from "../shared/diff";

const execFileAsync = promisify(execFile);
const find = (name: string) =>
  [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `/usr/bin/${name}`].find(existsSync) ?? name;
const GIT = find("git");
const GH = find("gh");
// Fetched on demand (panel open / Refresh), never polled: GitHub's GraphQL budget is shared with gh and Paseo.
const CACHE_MS = 2 * 60 * 1000;

const repos = new Map<string, Promise<{ owner: string; name: string }>>();
const cache = new Map<string, { at: number; value: Promise<ThreadsResult> }>();

interface ThreadsResult {
  pr: { number: number; url: string; title: string } | null;
  threads: ReviewThread[];
}

/** Review threads of the open PR for the checked-out branch. */
export async function listThreads({ directory }: { directory: string }): Promise<ThreadsResult> {
  const branch = (await run(GIT, ["branch", "--show-current"], directory)).trim();
  if (!branch) return { pr: null, threads: [] };
  const key = `${directory}:${branch}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const value = fetchThreads(directory, branch);
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  return value;
}

export async function replyToThread({ directory, threadId, body }: { directory: string; threadId: string; body: string }) {
  const query = `mutation($thread: ID!, $body: String!) {
    addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $thread, body: $body }) { comment { id } }
  }`;
  await run(GH, ["api", "graphql", "-f", `query=${query}`, "-f", `thread=${threadId}`, "-f", `body=${body}`], directory);
  for (const key of cache.keys()) if (key.startsWith(`${directory}:`)) cache.delete(key);
  return {};
}

async function fetchThreads(directory: string, branch: string): Promise<ThreadsResult> {
  const { owner, name } = await repoOf(directory);
  const query = `query($owner: String!, $name: String!, $branch: String!) {
    repository(owner: $owner, name: $name) {
      pullRequests(headRefName: $branch, states: [OPEN], first: 1, orderBy: { field: CREATED_AT, direction: DESC }) {
        nodes {
          number url title
          reviewThreads(first: 100) {
            nodes {
              id path line diffSide isResolved isOutdated
              comments(first: 30) { nodes { author { login } body createdAt url } }
            }
          }
        }
      }
    }
  }`;
  const output = await run(
    GH,
    ["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-f", `branch=${branch}`],
    directory,
  );
  const pr = JSON.parse(output).data.repository.pullRequests.nodes[0];
  if (!pr) return { pr: null, threads: [] };
  return {
    pr: { number: pr.number, url: pr.url, title: pr.title },
    threads: pr.reviewThreads.nodes.map(
      (thread: {
        id: string;
        path: string;
        line: number | null;
        diffSide: "LEFT" | "RIGHT";
        isResolved: boolean;
        isOutdated: boolean;
        comments: { nodes: { author: { login: string } | null; body: string; createdAt: string; url: string }[] };
      }): ReviewThread => ({
        id: thread.id,
        path: thread.path,
        line: thread.line,
        side: thread.diffSide,
        isResolved: thread.isResolved,
        isOutdated: thread.isOutdated,
        comments: thread.comments.nodes.map((comment) => ({
          author: comment.author?.login ?? "ghost",
          body: comment.body,
          createdAt: comment.createdAt,
          url: comment.url,
        })),
      }),
    ),
  };
}

function repoOf(directory: string): Promise<{ owner: string; name: string }> {
  let repo = repos.get(directory);
  if (!repo) {
    repo = run(GH, ["repo", "view", "--json", "owner,name", "--jq", '.owner.login + "/" + .name'], directory).then((out) => {
      const [owner, name] = out.trim().split("/");
      return { owner, name };
    });
    repo.catch(() => repos.delete(directory));
    repos.set(directory, repo);
  }
  return repo;
}

async function run(command: string, args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync(command, args, { cwd, timeout: 60_000, maxBuffer: 20 * 1024 * 1024 });
  return stdout;
}
