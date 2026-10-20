import { Platform } from "react-native";

// This plugin typechecks without the DOM library. Declare only what this module uses.
declare const navigator: { clipboard?: { writeText(text: string): Promise<void> } } | undefined;
interface KeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  target: { tagName?: string; isContentEditable?: boolean } | null;
  preventDefault(): void;
}
interface MouseEvent {
  shiftKey: boolean;
  preventDefault(): void;
}
declare const document:
  | {
      addEventListener(type: "keydown", listener: (event: KeyEvent) => void, options?: { capture?: boolean }): void;
      removeEventListener(type: "keydown", listener: (event: KeyEvent) => void, options?: { capture?: boolean }): void;
      addEventListener(type: "mouseup", listener: () => void, options?: { once?: boolean }): void;
      addEventListener(type: "mousedown", listener: (event: { target: unknown }) => void, options?: { capture?: boolean }): void;
      removeEventListener(type: "mousedown", listener: (event: { target: unknown }) => void, options?: { capture?: boolean }): void;
    }
  | undefined;
declare const IntersectionObserver:
  | (new (
      callback: (entries: { target: unknown; isIntersecting: boolean }[]) => void,
      options: { root: unknown; rootMargin: string },
    ) => { observe(target: unknown): void; unobserve(target: unknown): void; disconnect(): void })
  | undefined;

export async function copyText(text: string): Promise<boolean> {
  if (Platform.OS !== "web" || typeof navigator === "undefined" || !navigator.clipboard) return false;
  await navigator.clipboard.writeText(text);
  return true;
}

/** Single-key shortcuts; ignored while typing anywhere (composer, comment box, search) or with modifiers held. */
export function listenShortcuts(handler: (key: string) => boolean): () => void {
  if (Platform.OS !== "web" || typeof document === "undefined") return () => {};
  const listener = (event: KeyEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const tag = event.target?.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || event.target?.isContentEditable) return;
    if (handler(event.key)) event.preventDefault();
  };
  document.addEventListener("keydown", listener);
  return () => document.removeEventListener("keydown", listener);
}

/** Cmd/Ctrl+F, caught before the browser's own find (which misses diffs not loaded yet). */
export function listenFind(handler: () => void): () => void {
  if (Platform.OS !== "web" || typeof document === "undefined") return () => {};
  const listener = (event: KeyEvent) => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      handler();
    }
  };
  document.addEventListener("keydown", listener, { capture: true });
  return () => document.removeEventListener("keydown", listener, { capture: true });
}

/** react-native-web forwards DOM mouse handlers on a View, but React Native's types do not declare them. */
export function webMouse(handlers: {
  onMouseDown?: (event: MouseEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}): object {
  return Platform.OS === "web" ? handlers : {};
}

/** The release can happen anywhere, even outside the row the drag started on. */
export function onMouseUpOnce(handler: () => void) {
  if (Platform.OS !== "web" || typeof document === "undefined") return handler();
  document.addEventListener("mouseup", handler, { once: true });
}

/** On web a View ref is its DOM node. */
export function scrollIntoView(node: unknown) {
  const element = node as { scrollIntoView?: (options: { block: string }) => void } | null;
  element?.scrollIntoView?.({ block: "center" });
}

/** On web a View ref is its DOM node; its box relative to the window. */
export function boxOf(node: unknown): { top: number; height: number } | null {
  const element = node as { getBoundingClientRect?: () => { top: number; height: number } } | null;
  return element?.getBoundingClientRect ? element.getBoundingClientRect() : null;
}

export const canObserveNear = typeof IntersectionObserver !== "undefined";

export interface NearObserver {
  observe(node: unknown, onNear: () => void): void;
  unobserve(node: unknown): void;
  disconnect(): void;
}

/** Calls each node's `onNear` once, the first time it comes within one screen of `root`'s visible area. */
export function nearObserver(root: unknown): NearObserver | null {
  if (typeof IntersectionObserver === "undefined" || !root) return null;
  const handlers = new Map<unknown, () => void>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const handler = handlers.get(entry.target);
        if (!entry.isIntersecting || !handler) continue;
        handlers.delete(entry.target);
        observer.unobserve(entry.target);
        handler();
      }
    },
    { root, rootMargin: "100% 0px" },
  );
  return {
    observe: (node, onNear) => {
      handlers.set(node, onNear);
      observer.observe(node);
    },
    unobserve: (node) => {
      handlers.delete(node);
      observer.unobserve(node);
    },
    disconnect: () => observer.disconnect(),
  };
}

/** Calls `handler` on a mouse press outside `node`, or on Escape. */
export function listenOutsidePress(node: unknown, handler: () => void): () => void {
  if (Platform.OS !== "web" || typeof document === "undefined") return () => {};
  const element = node as { contains?: (target: unknown) => boolean } | null;
  const onPress = (event: { target: unknown }) => {
    if (!element?.contains?.(event.target)) handler();
  };
  const onKey = (event: KeyEvent) => {
    if (event.key === "Escape") handler();
  };
  document.addEventListener("mousedown", onPress, { capture: true });
  document.addEventListener("keydown", onKey, { capture: true });
  return () => {
    document.removeEventListener("mousedown", onPress, { capture: true });
    document.removeEventListener("keydown", onKey, { capture: true });
  };
}
