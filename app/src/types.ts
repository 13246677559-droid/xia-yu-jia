import type { ThemeId } from "./lib/palettes";

export type { ThemeId };

export type CoverFieldSize = "lg" | "md" | "sm";

export interface CoverField {
  id: string;
  label: string;
  value: string;
  size: CoverFieldSize;
  showLabel: boolean;
  role?: "presenter";
}

export interface Cover {
  title: string;
  fields: CoverField[];
}

export type TextBlockKind = "definition" | "theorem" | "consensus" | "group";
export type BlockKind =
  | TextBlockKind
  | "bullets"
  | "figure"
  | "table"
  | "code"
  | "references";
export type SlideLayout = "full" | "rows" | "cols" | "grid";

export interface TextBlock {
  id: string;
  kind: TextBlockKind;
  pane: number;
  centered?: boolean;
  offsetX?: number;
  offsetY?: number;
  body: string;
  label?: string;
  align?: "left" | "center";
}

export type LineAlign = "left" | "center";

export interface BulletItem {
  id: string;
  text: string;
  notes: string[];
  aligns?: LineAlign[];
  noteAligns?: LineAlign[][];
}

export interface BulletsBlock {
  id: string;
  kind: "bullets";
  pane: number;
  centered?: boolean;
  offsetX?: number;
  offsetY?: number;
  title?: string;
  items: BulletItem[];
}

export interface CodeBlock {
  id: string;
  kind: "code";
  pane: number;
  centered?: boolean;
  offsetX?: number;
  offsetY?: number;
  title?: string;
  code: string;
}

export interface ReferencesBlock {
  id: string;
  kind: "references";
  pane: number;
  centered?: boolean;
  offsetX?: number;
  offsetY?: number;
  title?: string;
  items: string[];
}

export interface FigureBlock {
  id: string;
  kind: "figure";
  pane: number;
  centered?: boolean;
  src: string;
  caption: string;
  scale: number;
  offsetX: number;
  offsetY: number;
}

export type CellAlign = "left" | "center" | "right";
export type TablePlacement = "left" | "center" | "right";

export interface TableBlock {
  id: string;
  kind: "table";
  pane: number;
  centered?: boolean;
  caption: string;
  header: string[];
  rows: string[][];
  aligns?: CellAlign[];
  placement: TablePlacement;
  firstColumnHeader: boolean;
  scale: number;
  offsetX: number;
  offsetY: number;
}

export type Block =
  | TextBlock
  | BulletsBlock
  | FigureBlock
  | TableBlock
  | CodeBlock
  | ReferencesBlock;

export interface Slide {
  id: string;
  title: string;
  layout: SlideLayout;
  blocks: Block[];
  footnotes?: string[];
}

export interface Section {
  id: string;
  title: string;
  slides: Slide[];
}

export interface Ending {
  title: string;
}

export interface Project {
  version: 1;
  id: string;
  name: string;
  theme: ThemeId;
  updated: string;
  showDots: boolean;
  cover: Cover;
  ending?: Ending;
  sections: Section[];
}

export const blockKindLabel: Record<BlockKind, string> = {
  definition: "定义",
  theorem: "定理",
  consensus: "共识",
  group: "编组",
  bullets: "要点",
  figure: "图片",
  table: "表格",
  code: "代码",
  references: "文献",
};

export const coverSizeLabel: Record<CoverFieldSize, string> = {
  lg: "大",
  md: "中",
  sm: "小",
};
