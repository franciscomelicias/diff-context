import { useEffect, useRef, useState, type RefObject } from "react";
import type { ScrollView } from "react-native";
import { boxOf, canObserveNear, nearObserver, type NearObserver } from "./web";

// Diffs above the target may still be loading and push it down; re-aim while the user has not scrolled.
const SETTLE_DELAYS_MS = [250, 700];

interface FileNodes {
  header: unknown;
  body: unknown;
}

/**
 * Every file is in the DOM, but a file loads its diff only once its body comes near the screen. Positions
 * are always read from the rendered DOM, so hiding, collapsing or loading files never leaves them stale.
 */
export function useFileScroller(scrollRef: RefObject<ScrollView | null>, order: string[]) {
  const nodes = useRef(new Map<string, FileNodes>());
  // One stable ref callback per node: a new one each render would detach and re-observe every file.
  const refs = useRef(new Map<string, (node: unknown) => void>());
  const observer = useRef<NearObserver | null>(null);
  const loaded = useRef(new Set<string>());
  const [near, setNear] = useState<ReadonlySet<string>>(new Set());
  const job = useRef(0);

  const watch = (path: string, body: unknown) => {
    if (loaded.current.has(path)) return;
    observer.current?.observe(body, () => {
      loaded.current.add(path);
      setNear(new Set(loaded.current));
    });
  };

  // Bodies mount before the scroll view gets its ref, so the observer starts here and picks them up.
  useEffect(() => {
    const created = nearObserver(scrollRef.current?.getScrollableNode());
    observer.current = created;
    for (const [path, entry] of nodes.current) if (entry.body) watch(path, entry.body);
    return () => created?.disconnect();
  }, [scrollRef]);

  const register = (path: string, part: keyof FileNodes) => {
    const id = `${part}:${path}`;
    const existing = refs.current.get(id);
    if (existing) return existing;
    const ref = (node: unknown) => {
      const entry = nodes.current.get(path) ?? { header: null, body: null };
      if (part === "body" && entry.body) observer.current?.unobserve(entry.body);
      entry[part] = node;
      if (part === "body" && node) watch(path, node);
      if (entry.header || entry.body) nodes.current.set(path, entry);
      else nodes.current.delete(path);
    };
    refs.current.set(id, ref);
    return ref;
  };

  const aim = (path: string, id: number, settle: boolean) => {
    const scroll = scrollRef.current;
    const container = scroll?.getScrollableNode() as { scrollTop: number } | undefined;
    const frame = boxOf(container);
    const target = nodes.current.get(path);
    if (id !== job.current || !scroll || !container || !frame || !target?.header || !target.body) return;
    // From the body: a stuck sticky header reports where it is pinned, not where it sits in the list.
    const offsetOf = () =>
      Math.max(0, container.scrollTop + (boxOf(target.body)?.top ?? 0) - frame.top - (boxOf(target.header)?.height ?? 0));
    let aimed = offsetOf();
    scroll.scrollTo({ y: aimed, animated: false });
    if (!settle) return;
    for (const delay of SETTLE_DELAYS_MS) {
      setTimeout(() => {
        if (id !== job.current || Math.abs(container.scrollTop - aimed) > 2) return;
        aimed = offsetOf();
        scroll.scrollTo({ y: aimed, animated: false });
      }, delay);
    }
  };

  /** `settle: false` scrolls once (a search match then centres its own line). */
  const scrollToFile = (path: string, settle = true) => {
    job.current += 1;
    const id = job.current;
    // After the state change that triggered the jump (open, collapse) has rendered.
    requestAnimationFrame(() => aim(path, id, settle));
  };

  /** The file whose body is under the sticky header at the top of the list. */
  const fileAtTop = () => {
    const frame = boxOf(scrollRef.current?.getScrollableNode());
    if (!frame) return null;
    return (
      order.find((path) => {
        const entry = nodes.current.get(path);
        const body = boxOf(entry?.body);
        return body !== null && body.top + body.height > frame.top + (boxOf(entry?.header)?.height ?? 0) + 1;
      }) ?? null
    );
  };

  const isNear = (path: string) => !canObserveNear || near.has(path);

  return { register, scrollToFile, fileAtTop, isNear };
}
