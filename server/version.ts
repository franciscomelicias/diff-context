import { homedir } from "node:os";
import { compareVersions } from "../shared/diff";
import { git } from "./diff";

// Public https remote: no SSH key or GitHub API budget needed.
const REPO = "https://github.com/franciscomelicias/diff-context.git";

export async function latestVersion(): Promise<{ latest: string | null }> {
  const refs = await git(homedir(), ["ls-remote", "--tags", "--refs", REPO]).catch(() => "");
  const versions = [...refs.matchAll(/refs\/tags\/v(\d+\.\d+\.\d+)$/gm)].map((match) => match[1]);
  return { latest: versions.sort(compareVersions).at(-1) ?? null };
}
