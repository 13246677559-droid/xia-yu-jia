import type { CSSProperties } from "react";

export interface Palette {
  id: string;
  name: string;
  short: string;
  primary: string;
  accent: string;
  accentText: string;
  onAccent: string;
  tint: string;
  soft: string;
}

export const PALETTES = [
  {
    id: "whu",
    name: "武大珞珈绿",
    short: "珞珈绿",
    primary: "#115740",
    accent: "#F8A3BC",
    accentText: "#8A2F4A",
    onAccent: "#1F2328",
    tint: "#EEF4F0",
    soft: "#E9F1ED",
  },
  {
    id: "whu-lake",
    name: "武大东湖蓝",
    short: "东湖蓝",
    primary: "#002554",
    accent: "#41B6E6",
    accentText: "#0B5F78",
    onAccent: "#1F2328",
    tint: "#EDF5FA",
    soft: "#E4EFF7",
  },
  {
    id: "whu-tile",
    name: "武大黉瓦绿",
    short: "黉瓦绿",
    primary: "#00797C",
    accent: "#41B6E6",
    accentText: "#0B5F78",
    onAccent: "#1F2328",
    tint: "#E8F4F4",
    soft: "#E6F4F4",
  },
  {
    id: "whu-vine",
    name: "武大春藤紫",
    short: "春藤紫",
    primary: "#33058D",
    accent: "#F8A3BC",
    accentText: "#8A2F4A",
    onAccent: "#1F2328",
    tint: "#F2EFFA",
    soft: "#EAE4F6",
  },
  {
    id: "whu-gold",
    name: "武大秋桂金",
    short: "秋桂金",
    primary: "#6B4A00",
    accent: "#FFA300",
    accentText: "#8A5A00",
    onAccent: "#1F2328",
    tint: "#FBF4E6",
    soft: "#F7EAD2",
  },
  {
    id: "whu-mist",
    name: "武大晨雾灰",
    short: "晨雾灰",
    primary: "#4E5559",
    accent: "#41B6E6",
    accentText: "#0B5F78",
    onAccent: "#1F2328",
    tint: "#F2F4F5",
    soft: "#E9EDF0",
  },
  {
    id: "xmu",
    name: "厦大嘉庚蓝",
    short: "嘉庚蓝",
    primary: "#003C88",
    accent: "#B03A2E",
    accentText: "#8A1C12",
    onAccent: "#FFFFFF",
    tint: "#EDF2F9",
    soft: "#E4ECF7",
  },
] as const satisfies readonly Palette[];

export type ThemeId = (typeof PALETTES)[number]["id"];

export const THEME_IDS = PALETTES.map((palette) => palette.id) as ThemeId[];

export const PALETTE_BY_ID = Object.fromEntries(
  PALETTES.map((palette) => [palette.id, palette]),
) as Record<ThemeId, Palette>;

export const themeLabel = Object.fromEntries(
  PALETTES.map((palette) => [palette.id, palette.name]),
) as Record<ThemeId, string>;

export const shortTheme = Object.fromEntries(
  PALETTES.map((palette) => [palette.id, palette.short]),
) as Record<ThemeId, string>;

export function paletteOf(id: ThemeId): Palette {
  const palette = PALETTE_BY_ID[id];
  if (!palette) throw new Error(`未知配色：${id}`);
  return palette;
}

export function themeVars(id: ThemeId): CSSProperties {
  const palette = paletteOf(id);
  return {
    "--primary": palette.primary,
    "--accent": palette.accent,
    "--accent-text": palette.accentText,
    "--on-accent": palette.onAccent,
    "--tint": palette.tint,
    "--soft": palette.soft,
  } as CSSProperties;
}
