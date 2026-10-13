import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { viewedGetRpc, viewedSetRpc } from "../shared/diff";

/** Viewed files (path → fingerprint when marked), persisted by the daemon per workspace and mode. */
export function useViewed(key: string) {
  const getViewed = useRpc(viewedGetRpc);
  const setViewed = useRpc(viewedSetRpc);
  const stored = useQuery({ queryKey: ["diff-viewed", key], queryFn: () => getViewed({ key }), staleTime: Infinity });
  const [local, setLocal] = useState<{ key: string; viewed: Record<string, string> } | null>(null);
  const viewed = local?.key === key ? local.viewed : (stored.data?.viewed ?? {});

  const update = (changes: Record<string, string | null>) => {
    const next = { ...viewed };
    for (const [path, fingerprint] of Object.entries(changes)) {
      if (fingerprint === null) delete next[path];
      else next[path] = fingerprint;
    }
    setLocal({ key, viewed: next });
    void setViewed({ key, changes });
  };
  return { viewed, update, ready: stored.data !== undefined };
}
