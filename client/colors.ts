import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";

type ThemeColors = PluginWorkspacePanelProps["theme"]["colors"];
type Rgb = [number, number, number];

export const LINE_ALPHA = 0.15;
export const WORD_ALPHA = 0.4;
// WCAG AA for normal text.
const MIN_CONTRAST = 4.5;

/** Syntax colours per line background, so dim colours (comments) stay readable on green and red. */
export interface SyntaxSet {
  ctx: Record<string, string>;
  add: Record<string, string>;
  del: Record<string, string>;
  wordAdd: Record<string, string>;
  wordDel: Record<string, string>;
}

/** A faint background from a theme colour; falls back when the colour is not #rrggbb. */
export function tint(color: string, fallback: string, alpha = LINE_ALPHA): string {
  const rgb = parseHex(color);
  if (!rgb) return fallback;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

export function readableSyntax(syntax: Record<string, string>, colors: ThemeColors): SyntaxSet {
  const base = parseHex(colors.surface0) ?? [30, 30, 30];
  const over = (color: string, alpha: number, under: Rgb): Rgb => {
    const rgb = parseHex(color);
    return rgb ? mix(under, rgb, alpha) : (parseHex(colors.surface2) ?? under);
  };
  const add = over(colors.statusSuccess, LINE_ALPHA, base);
  const del = over(colors.statusDanger, LINE_ALPHA, base);
  const foreground = parseHex(colors.foreground) ?? [230, 230, 230];
  const adjust = (background: Rgb) =>
    Object.fromEntries(Object.entries(syntax).map(([style, color]) => [style, ensureContrast(color, background, foreground)]));
  return {
    ctx: adjust(base),
    add: adjust(add),
    del: adjust(del),
    wordAdd: adjust(over(colors.statusSuccess, WORD_ALPHA, add)),
    wordDel: adjust(over(colors.statusDanger, WORD_ALPHA, del)),
  };
}

/** Moves the colour toward the text colour in small steps until it reads well on the background. */
function ensureContrast(color: string, background: Rgb, foreground: Rgb): string {
  const rgb = parseHex(color);
  if (!rgb) return color;
  for (let step = 0; step <= 10; step++) {
    const candidate = mix(rgb, foreground, step / 10);
    if (contrast(candidate, background) >= MIN_CONTRAST || step === 10) return toHex(candidate);
  }
  return color;
}

function contrast(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

function luminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  return [0, 1, 2].map((index) => Math.round(from[index] + (to[index] - from[index]) * amount)) as Rgb;
}

function parseHex(color: string): Rgb | null {
  const match = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  return match ? (match.slice(1).map((hex) => parseInt(hex, 16)) as Rgb) : null;
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}
