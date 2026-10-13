import { useRef, type RefObject } from "react";
import type { FlatList } from "react-native";
import { boxOf } from "./web";

const STEP_DELAY_MS = 80;
const MAX_STEPS = 40;
// Diffs above the target may still be loading and push it down; re-aim while the user has not scrolled.
const SETTLE_DELAYS_MS = [250, 700];

interface FileNodes {
  header: unknown;
  body: unknown;
}

/**
 * Scrolls a file's header to the top from the rendered DOM. The list's own scrollToIndex trusts row offsets
 * measured before the diffs above finished loading, so it lands short; a file that is not rendered yet is
 * reached by scrolling past the rendered window in steps until it mounts.
 */
export function useFileScroller(listRef: RefObject<FlatList<unknown> | null>, order: string[]) {
  const nodes = useRef(new Map<string, FileNodes>());
  const job = useRef(0);
  const latestOrder = useRef(order);
  latestOrder.current = order;

  const register = (path: string, part: keyof FileNodes) => (node: unknown) => {
    const entry = nodes.current.get(path) ?? { header: null, body: null };
    entry[part] = node;
    if (entry.header || entry.body) nodes.current.set(path, entry);
    else nodes.current.delete(path);
  };

  const step = (path: string, id: number, attempt: number, align: boolean) => {
    const list = listRef.current;
    const container = list?.getScrollableNode() as { scrollTop: number } | undefined;
    const frame = boxOf(container);
    if (id !== job.current || attempt > MAX_STEPS || !list || !container || !frame) return;
    const offsetOf = (node: unknown) => container.scrollTop + (boxOf(node)?.top ?? 0) - frame.top;

    const target = nodes.current.get(path);
    if (target?.header && target.body) {
      if (!align) return;
      const offset = Math.max(0, offsetOf(target.body) - (boxOf(target.header)?.height ?? 0));
      list.scrollToOffset({ offset, animated: false });
      for (const delay of SETTLE_DELAYS_MS) {
        setTimeout(() => {
          if (id !== job.current || Math.abs(container.scrollTop - offset) > 2) return;
          const again = Math.max(0, offsetOf(target.body) - (boxOf(target.header)?.height ?? 0));
          if (Math.abs(again - offset) > 2) step(path, id, MAX_STEPS, true);
        }, delay);
      }
      return;
    }

    const files = latestOrder.current;
    const mounted = files.filter((file) => nodes.current.get(file)?.body);
    const first = mounted[0];
    const last = mounted.at(-1);
    if (!first || !last) return;
    const below = files.indexOf(path) > files.indexOf(last);
    const edge = nodes.current.get(below ? last : first)?.body;
    const offset = below ? offsetOf(edge) + (boxOf(edge)?.height ?? 0) : offsetOf(edge) - frame.height;
    list.scrollToOffset({ offset: Math.max(0, offset), animated: false });
    setTimeout(() => step(path, id, attempt + 1, align), STEP_DELAY_MS);
  };

  /** `align: false` only brings the file into the rendered window (a search match then centres its own line). */
  const scrollToFile = (path: string, align = true) => {
    job.current += 1;
    const id = job.current;
    // After the state change that triggered the jump (open, collapse) has rendered.
    requestAnimationFrame(() => step(path, id, 0, align));
  };

  return { register, scrollToFile };
}
