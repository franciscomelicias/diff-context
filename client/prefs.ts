import { useRpc } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { storeGetRpc, storeSetRpc, type DiffMode } from "../shared/diff";
import type { ViewMode } from "./file-diff";

export interface Prefs {
  mode: DiffMode;
  viewMode: ViewMode;
  syntaxTheme: string;
  zoom: number;
  showTree: boolean;
  hideTests: boolean;
  hideGenerated: boolean;
  hideTranslations: boolean;
  hideWhitespace: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  mode: "branch",
  viewMode: "unified",
  syntaxTheme: "one",
  zoom: 1,
  showTree: true,
  hideTests: false,
  hideGenerated: false,
  hideTranslations: false,
  hideWhitespace: false,
};

// Module-level copy so reopening the panel shows the last settings at once, before the daemon answers.
let cached: Prefs | null = null;

/** Panel settings, kept by the daemon so they survive Paseo restarts. */
export function usePrefs(): [Prefs, (patch: Partial<Prefs>) => void] {
  const load = useRpc(storeGetRpc);
  const save = useRpc(storeSetRpc);
  const [prefs, setPrefs] = useState<Prefs>(cached ?? DEFAULT_PREFS);

  useEffect(() => {
    if (cached) return;
    void load({ space: "prefs", key: "panel" }).then(({ value }) => {
      cached = { ...DEFAULT_PREFS, ...((value as Partial<Prefs> | null) ?? {}) };
      setPrefs(cached);
    });
  }, [load]);

  const update = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch };
    cached = next;
    setPrefs(next);
    void save({ space: "prefs", key: "panel", value: next });
  };
  return [prefs, update];
}
