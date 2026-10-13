import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const DIR = join(homedir(), ".cache", "diff-context");

type Space = "prefs" | "drafts";

export async function storeGet({ space, key }: { space: Space; key: string }) {
  return { value: (await read(space))[key] ?? null };
}

export async function storeSet({ space, key, value }: { space: Space; key: string; value: unknown }) {
  const all = await read(space);
  if (value === null || (Array.isArray(value) && value.length === 0)) delete all[key];
  else all[key] = value;
  await mkdir(DIR, { recursive: true });
  await writeFile(join(DIR, `${space}.json`), JSON.stringify(all, null, 2));
  return {};
}

async function read(space: Space): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(join(DIR, `${space}.json`), "utf8"));
  } catch {
    return {};
  }
}
