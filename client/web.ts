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
    }
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

/** Cmd/Ctrl+F, caught before the browser's own find (which misses files scrolled out of the virtualised list). */
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
