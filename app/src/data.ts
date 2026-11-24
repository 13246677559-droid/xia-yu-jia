import type {
  Block,
  BlockKind,
  BulletItem,
  BulletsBlock,
  CodeBlock,
  Cover,
  CoverField,
  CoverFieldSize,
  FigureBlock,
  Project,
  ReferencesBlock,
  Section,
  Slide,
  SlideLayout,
  TableBlock,
  TextBlock,
  TextBlockKind,
  ThemeId,
} from "./types";

let counter = 200;
export function uid(prefix = "id"): string {
  counter += 1;
  return `${prefix}-${counter}-${Math.random().toString(36).slice(2, 7)}`;
}

export function makeTextBlock(
  kind: TextBlockKind,
  body = "",
  pane = 0,
): TextBlock {
  return { id: uid("block"), kind, pane, body };
}

export function makeBulletItem(text = "", notes: string[] = []): BulletItem {
  return {
    id: uid("bullet"),
    text,
    notes,
    aligns: Array.from({ length: text.split("\n").length }, () => "left"),
    noteAligns: notes.map((note) =>
      Array.from({ length: note.split("\n").length }, () => "left"),
    ),
  };
}

export function makeBulletsBlock(
  items: Array<
    string | { text: string; note?: string; notes?: string[] }
  > = [{ text: "" }],
  pane = 0,
  title = "",
): BulletsBlock {
  return {
    id: uid("block"),
    kind: "bullets",
    pane,
    ...(title ? { title } : {}),
    items: items.map((item) =>
      typeof item === "string"
        ? makeBulletItem(item)
        : makeBulletItem(
            item.text,
            item.notes ?? (item.note ? [item.note] : []),
          ),
    ),
  };
}

export function makeCodeBlock(title = "", code = "", pane = 0): CodeBlock {
  return {
    id: uid("block"),
    kind: "code",
    pane,
    ...(title ? { title } : {}),
    code,
  };
}

export function makeReferencesBlock(
  items: string[] = [],
  pane = 0,
  title = "参考文献",
): ReferencesBlock {
  return {
    id: uid("block"),
    kind: "references",
    pane,
    ...(title ? { title } : {}),
    items,
  };
}

export function makeFigureBlock(
  src = "",
  caption = "",
  pane = 0,
): FigureBlock {
  return {
    id: uid("block"),
    kind: "figure",
    pane,
    src,
    caption,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  };
}

export function makeTableBlock(
  input: Partial<Omit<TableBlock, "id" | "kind">> = {},
): TableBlock {
  const header = input.header ?? ["列 1", "列 2"];
  return {
    id: uid("block"),
    kind: "table",
    pane: input.pane ?? 0,
    caption: input.caption ?? "",
    header,
    rows: input.rows ?? [
      ["", ""],
      ["", ""],
    ],
    aligns: input.aligns ?? header.map(() => "center"),
    placement: input.placement ?? "center",
    firstColumnHeader: input.firstColumnHeader ?? false,
    scale: input.scale ?? 1,
    offsetX: input.offsetX ?? 0,
    offsetY: input.offsetY ?? 0,
  };
}

export function makeBlock(kind: BlockKind, pane = 0): Block {
  if (kind === "bullets") return makeBulletsBlock(undefined, pane);
  if (kind === "figure") return makeFigureBlock("", "", pane);
  if (kind === "table") return makeTableBlock({ pane });
  if (kind === "code") return makeCodeBlock("", "", pane);
  if (kind === "references") return makeReferencesBlock([], pane);
  return makeTextBlock(kind, "", pane);
}

export function makeSlide(
  title: string,
  blocks: Block[] = [],
  layout: SlideLayout = "full",
): Slide {
  return { id: uid("slide"), title, layout, blocks };
}

export function makeSection(title: string, slides: Slide[]): Section {
  return { id: uid("section"), title, slides };
}

export function makeCoverField(
  label: string,
  value: string,
  options: { size?: CoverFieldSize; showLabel?: boolean; role?: "presenter" } = {},
): CoverField {
  return {
    id: uid("cover"),
    label,
    value,
    size: options.size ?? "md",
    showLabel: options.showLabel ?? false,
    role: options.role,
  };
}

export function makeCover(title: string, fields: CoverField[]): Cover {
  return { title, fields };
}

function defaultCover(title: string): Cover {
  return makeCover(title, [
    makeCoverField("主讲人", "", { size: "lg", showLabel: true, role: "presenter" }),
    makeCoverField("单位", "武汉大学 新闻与传播学院", { size: "md", showLabel: false }),
    makeCoverField("日期", "2026 年 11 月 22 日", { size: "md", showLabel: false }),
  ]);
}


export function createProject(name: string, theme: ThemeId): Project {
  const title = name.trim() || "未命名项目";
  return {
    version: 1,
    id: uid("proj"),
    name: title,
    theme,
    updated: new Date().toISOString(),
    showDots: true,
    cover: defaultCover(title),
    ending: { title: "恳请各位批判指正" },
    sections: [
      makeSection("第一部分", [
        makeSlide("第一页", [makeBulletsBlock(["在这里写第一条要点。"])]),
      ]),
    ],
  };
}


export function cloneProject(project: Project): Project {
  const clone = structuredClone(project);
  clone.id = uid("proj");
  clone.name = `${project.name} 副本`;
  clone.updated = "刚刚";
  clone.cover.fields.forEach((field) => {
    field.id = uid("cover");
  });
  for (const section of clone.sections) {
    section.id = uid("section");
    for (const slide of section.slides) {
      slide.id = uid("slide");
      for (const block of slide.blocks) {
        block.id = uid("block");
        if (block.kind === "bullets") {
          block.items.forEach((item) => {
            item.id = uid("bullet");
          });
        }
      }
    }
  }
  return clone;
}
