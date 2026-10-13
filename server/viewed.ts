import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const FILE = join(homedir(), ".cache", "diff-context", "viewed.json");

type Store = Record<string, Record<string, string>>;

/** Viewed files per workspace + mode, as path → fingerprint at the time it was marked. */
export async function getViewed({ key }: { key: string }) {
  return { viewed: (await read())[key] ?? {} };
}

export async function setViewed({ key, changes }: { key: string; changes: Record<string, string | null> }) {
  const store = await read();
  const viewed = { ...(store[key] ?? {}) };
  for (const [path, fingerprint] of Object.entries(changes)) {
    if (fingerprint === null) delete viewed[path];
    else viewed[path] = fingerprint;
  }
  store[key] = viewed;
  await mkdir(dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(store, null, 2));
  return { viewed };
}

async function read(): Promise<Store> {
  try {
    return JSON.parse(await readFile(FILE, "utf8"));
  } catch {
    return {};
  }
}
