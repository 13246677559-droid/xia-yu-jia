import type {
  Block,
  BulletItem,
  BulletsBlock,
  CodeBlock,
  Cover,
  CoverField,
  Ending,
  FigureBlock,
  Project,
  ReferencesBlock,
  Section,
  Slide,
  CellAlign,
  LineAlign,
  SlideLayout,
  TableBlock,
  TablePlacement,
  TextBlock,
  TextBlockKind,
  ThemeId,
} from "../../types";
import { THEME_IDS } from "../palettes";
import { paneCount } from "../layout";

export class ProjectSchemaError extends Error {
  path: string;

  constructor(path: string, message: string) {
    super(`${path}：${message}`);
    this.name = "ProjectSchemaError";
    this.path = path;
  }
}

function fail(path: string, message: string): never {
  throw new ProjectSchemaError(path, message);
}

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "必须是对象");
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "必须是数组");
  return value;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== "string") fail(path, "必须是字符串");
  return value;
}

function asBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path, "必须是布尔值");
  return value;
}

function asNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(path, "必须是有效数字");
  }
  return value;
}

function asRecord<T extends string>(value: unknown, path: string, keys: T[]): T {
  const text = asString(value, path);
  if (!keys.includes(text as T)) {
    fail(path, `必须是 ${keys.join(" 或 ")}`);
  }
  return text as T;
}

function stringArray(value: unknown, path: string): string[] {
  return asArray(value, path).map((item, index) => asString(item, `${path}[${index}]`));
}

function parseLayout(value: unknown, path: string): SlideLayout {
  if (value === undefined) return "full";
  return asRecord(value, path, ["full", "rows", "cols", "grid"]);
}

function parsePane(value: unknown, path: string, layout: SlideLayout): number {
  if (value === undefined) {
    if (layout === "full") return 0;
    fail(path, "分版页面的内容块必须写 pane");
  }
  const pane = asNumber(value, path);
  if (!Number.isInteger(pane) || pane < 0 || pane >= paneCount(layout)) {
    fail(path, `必须是 0 到 ${paneCount(layout) - 1} 的整数`);
  }
  return pane;
}

function parsePlacement(value: unknown, path: string): TablePlacement {
  if (value === undefined) return "center";
  return asRecord(value, path, ["left", "center", "right"]);
}

function parseCoverField(value: unknown, path: string): CoverField {
  const record = asObject(value, path);
  const role = record.role;
  if (role !== undefined && role !== "presenter") {
    fail(`${path}.role`, "只能是 presenter");
  }
  return {
    id: asString(record.id, `${path}.id`),
    label: asString(record.label, `${path}.label`),
    value: asString(record.value, `${path}.value`),
    size: asRecord(record.size, `${path}.size`, ["lg", "md", "sm"]),
    showLabel: asBoolean(record.showLabel, `${path}.showLabel`),
    ...(role === "presenter" ? { role: "presenter" as const } : {}),
  };
}

function parseCover(value: unknown): Cover {
  const record = asObject(value, "cover");
  return {
    title: asString(record.title, "cover.title"),
    fields: asArray(record.fields, "cover.fields").map((field, index) =>
      parseCoverField(field, `cover.fields[${index}]`),
    ),
  };
}

function parseTextBlock(
  record: Record<string, unknown>,
  kind: TextBlockKind,
  path: string,
  pane: number,
): TextBlock {
  const label = record.label;
  if (label !== undefined && typeof label !== "string") {
    fail(`${path}.label`, "必须是字符串");
  }
  const align = record.align;
  if (align !== undefined && align !== "left" && align !== "center") {
    fail(`${path}.align`, "必须是 left 或 center");
  }
  return {
    id: asString(record.id, `${path}.id`),
    kind,
    pane,
    body: asString(record.body, `${path}.body`),
    ...(typeof label === "string" ? { label } : {}),
    ...(align === "left" || align === "center" ? { align } : {}),
  };
}

function parseLineAligns(
  value: unknown,
  count: number,
  path: string,
): LineAlign[] {
  if (value === undefined) return Array.from({ length: count }, () => "left");
  if (!Array.isArray(value)) fail(path, "必须是数组");
  if (value.length !== count) fail(path, `长度必须是 ${count}`);
  return value.map((item, index) => {
    if (item !== "left" && item !== "center") {
      fail(`${path}[${index}]`, "必须是 left 或 center");
    }
    return item;
  });
}

function parseBulletItem(value: unknown, path: string): BulletItem {
  const record = asObject(value, path);
  const text = asString(record.text, `${path}.text`);
  const notes = stringArray(record.notes, `${path}.notes`);
  const aligns = parseLineAligns(record.aligns, text.split("\n").length, `${path}.aligns`);
  let noteAligns: LineAlign[][];
  if (record.noteAligns === undefined) {
    noteAligns = notes.map((note) =>
      Array.from({ length: note.split("\n").length }, () => "left" as LineAlign),
    );
  } else {
    if (!Array.isArray(record.noteAligns)) fail(`${path}.noteAligns`, "必须是数组");
    if (record.noteAligns.length !== notes.length) {
      fail(`${path}.noteAligns`, `长度必须是 ${notes.length}`);
    }
    noteAligns = record.noteAligns.map((item, index) =>
      parseLineAligns(
        item,
        notes[index].split("\n").length,
        `${path}.noteAligns[${index}]`,
      ),
    );
  }
  return {
    id: asString(record.id, `${path}.id`),
    text,
    notes,
    aligns,
    noteAligns,
  };
}

function parseBulletsBlock(
  record: Record<string, unknown>,
  path: string,
  pane: number,
): BulletsBlock {
  const title = record.title;
  if (title !== undefined && typeof title !== "string") {
    fail(`${path}.title`, "必须是字符串");
  }
  return {
    id: asString(record.id, `${path}.id`),
    kind: "bullets",
    pane,
    ...(typeof title === "string" ? { title } : {}),
    items: asArray(record.items, `${path}.items`).map((item, index) =>
      parseBulletItem(item, `${path}.items[${index}]`),
    ),
  };
}

function parseFigureBlock(
  record: Record<string, unknown>,
  path: string,
  pane: number,
): FigureBlock {
  return {
    id: asString(record.id, `${path}.id`),
    kind: "figure",
    pane,
    src: asString(record.src, `${path}.src`),
    caption: asString(record.caption, `${path}.caption`),
    scale: asNumber(record.scale, `${path}.scale`),
    offsetX: asNumber(record.offsetX, `${path}.offsetX`),
    offsetY: asNumber(record.offsetY, `${path}.offsetY`),
  };
}

function parseTableBlock(
  record: Record<string, unknown>,
  path: string,
  pane: number,
): TableBlock {
  const header = stringArray(record.header, `${path}.header`);
  const rows = asArray(record.rows, `${path}.rows`).map((row, rowIndex) =>
    stringArray(row, `${path}.rows[${rowIndex}]`),
  );
  rows.forEach((row, rowIndex) => {
    if (row.length !== header.length) {
      fail(`${path}.rows[${rowIndex}]`, `列数应为 ${header.length}`);
    }
  });
  let aligns: CellAlign[];
  if (record.aligns === undefined) {
    aligns = header.map(() => "center");
  } else {
    if (!Array.isArray(record.aligns)) fail(`${path}.aligns`, "必须是数组");
    if (record.aligns.length !== header.length) {
      fail(`${path}.aligns`, `长度必须是 ${header.length}`);
    }
    aligns = record.aligns.map((item, index) => {
      if (item !== "left" && item !== "center" && item !== "right") {
        fail(`${path}.aligns[${index}]`, "必须是 left、center 或 right");
      }
      return item;
    });
  }
  return {
    id: asString(record.id, `${path}.id`),
    kind: "table",
    pane,
    caption: asString(record.caption, `${path}.caption`),
    header,
    rows,
    aligns,
    placement: parsePlacement(record.placement, `${path}.placement`),
    firstColumnHeader: asBoolean(record.firstColumnHeader, `${path}.firstColumnHeader`),
    scale: asNumber(record.scale, `${path}.scale`),
    offsetX: asNumber(record.offsetX, `${path}.offsetX`),
    offsetY: asNumber(record.offsetY, `${path}.offsetY`),
  };
}

function parseCodeBlock(
  record: Record<string, unknown>,
  path: string,
  pane: number,
): CodeBlock {
  const title = record.title;
  if (title !== undefined && typeof title !== "string") {
    fail(`${path}.title`, "必须是字符串");
  }
  return {
    id: asString(record.id, `${path}.id`),
    kind: "code",
    pane,
    ...(typeof title === "string" ? { title } : {}),
    code: asString(record.code, `${path}.code`),
  };
}

function parseReferencesBlock(
  record: Record<string, unknown>,
  path: string,
  pane: number,
): ReferencesBlock {
  const title = record.title;
  if (title !== undefined && typeof title !== "string") {
    fail(`${path}.title`, "必须是字符串");
  }
  return {
    id: asString(record.id, `${path}.id`),
    kind: "references",
    pane,
    ...(typeof title === "string" ? { title } : {}),
    items: stringArray(record.items, `${path}.items`),
  };
}

function parseBlock(value: unknown, path: string, layout: SlideLayout): Block {
  const record = asObject(value, path);
  const pane = parsePane(record.pane, `${path}.pane`, layout);
  const kind = asRecord(record.kind, `${path}.kind`, [
    "definition",
    "theorem",
    "consensus",
    "group",
    "bullets",
    "figure",
    "table",
    "code",
    "references",
  ]);
  const centered = record.centered;
  if (centered !== undefined && typeof centered !== "boolean") {
    fail(`${path}.centered`, "必须是布尔值");
  }
  const block =
    kind === "bullets"
      ? parseBulletsBlock(record, path, pane)
      : kind === "figure"
        ? parseFigureBlock(record, path, pane)
        : kind === "table"
          ? parseTableBlock(record, path, pane)
          : kind === "code"
            ? parseCodeBlock(record, path, pane)
            : kind === "references"
              ? parseReferencesBlock(record, path, pane)
              : parseTextBlock(record, kind, path, pane);
  if (typeof centered === "boolean") block.centered = centered;
  if (record.offsetX !== undefined) {
    block.offsetX = asNumber(record.offsetX, `${path}.offsetX`);
  }
  if (record.offsetY !== undefined) {
    block.offsetY = asNumber(record.offsetY, `${path}.offsetY`);
  }
  return block;
}

function parseSlide(value: unknown, path: string): Slide {
  const record = asObject(value, path);
  const layout = parseLayout(record.layout, `${path}.layout`);
  const footnotes =
    record.footnotes === undefined
      ? undefined
      : stringArray(record.footnotes, `${path}.footnotes`);
  return {
    id: asString(record.id, `${path}.id`),
    title: asString(record.title, `${path}.title`),
    layout,
    ...(footnotes ? { footnotes } : {}),
    blocks: asArray(record.blocks, `${path}.blocks`).map((block, index) =>
      parseBlock(block, `${path}.blocks[${index}]`, layout),
    ),
  };
}

function parseEnding(value: unknown): Ending {
  const record = asObject(value, "ending");
  return {
    title: asString(record.title, "ending.title"),
  };
}

function parseSection(value: unknown, path: string): Section {
  const record = asObject(value, path);
  return {
    id: asString(record.id, `${path}.id`),
    title: asString(record.title, `${path}.title`),
    slides: asArray(record.slides, `${path}.slides`).map((slide, index) =>
      parseSlide(slide, `${path}.slides[${index}]`),
    ),
  };
}

export function parseProject(value: unknown): Project {
  const record = asObject(value, "project");
  if (asNumber(record.version, "project.version") !== 1) {
    fail("project.version", "必须是 1");
  }
  const ending =
    record.ending === undefined ? undefined : parseEnding(record.ending);
  return {
    version: 1,
    id: asString(record.id, "project.id"),
    name: asString(record.name, "project.name"),
    theme: asRecord(record.theme, "project.theme", THEME_IDS) as ThemeId,
    updated: asString(record.updated, "project.updated"),
    showDots: asBoolean(record.showDots, "project.showDots"),
    cover: parseCover(record.cover),
    ...(ending ? { ending } : {}),
    sections: asArray(record.sections, "project.sections").map((section, index) =>
      parseSection(section, `project.sections[${index}]`),
    ),
  };
}

export function parseProjectJson(text: string): Project {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new ProjectSchemaError(
      "project.json",
      error instanceof Error ? `JSON 解析失败：${error.message}` : "JSON 解析失败",
    );
  }
  return parseProject(value);
}
