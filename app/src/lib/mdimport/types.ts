import type {
  CellAlign,
  CoverFieldSize,
  SlideLayout,
  TablePlacement,
  TextBlockKind,
  ThemeId,
} from "../../types";

export interface MarkdownIssue {
  line: number | null;
  message: string;
}

export class MarkdownImportError extends Error {
  issues: MarkdownIssue[];

  constructor(issues: MarkdownIssue[]) {
    const first = issues[0];
    super(
      first?.line
        ? `第 ${first.line} 行：${first.message}`
        : first?.message ?? "Markdown 格式错误",
    );
    this.name = "MarkdownImportError";
    this.issues = issues;
  }
}

export interface MdProjectMeta {
  name: string;
  theme: ThemeId;
  showDots: boolean;
}

export interface MdCoverField {
  label: string;
  value: string;
  size: CoverFieldSize;
  showLabel: boolean;
  role?: "presenter";
}

export interface MdCover {
  title: string;
  fields: MdCoverField[];
}

export interface MdBulletItem {
  text: string;
  center: boolean;
  notes: Array<{ text: string; center: boolean }>;
}

export interface MdTextBlock {
  kind: TextBlockKind;
  pane: number;
  centered?: boolean;
  label?: string;
  align?: "left" | "center";
  body: string;
  line: number;
}

export interface MdBulletsBlock {
  kind: "bullets";
  pane: number;
  centered?: boolean;
  title?: string;
  items: MdBulletItem[];
  line: number;
}

export interface MdFigureBlock {
  kind: "figure";
  pane: number;
  centered?: boolean;
  src: string;
  caption: string;
  scale: number;
  line: number;
}

export interface MdCodeBlock {
  kind: "code";
  pane: number;
  centered?: boolean;
  title?: string;
  code: string;
  line: number;
}

export interface MdReferencesBlock {
  kind: "references";
  pane: number;
  centered?: boolean;
  title?: string;
  items: string[];
  line: number;
}

export interface MdFootnoteBlock {
  kind: "footnote";
  items: string[];
  line: number;
}

export interface MdTableBlock {
  kind: "table";
  pane: number;
  centered?: boolean;
  caption: string;
  header: string[];
  rows: string[][];
  aligns: CellAlign[];
  placement: TablePlacement;
  firstColumnHeader: boolean;
  scale: number;
  line: number;
}

export type MdBlock =
  | MdTextBlock
  | MdBulletsBlock
  | MdFigureBlock
  | MdTableBlock
  | MdCodeBlock
  | MdReferencesBlock
  | MdFootnoteBlock;

export interface MdSlide {
  title: string;
  layout: SlideLayout;
  blocks: MdBlock[];
  line: number;
}

export interface MdSection {
  title: string;
  slides: MdSlide[];
  line: number;
}

export interface MdDeck {
  project: MdProjectMeta;
  cover: MdCover;
  ending?: { title: string };
  sections: MdSection[];
}
