import yaml from "js-yaml";
import type {
  CellAlign,
  CoverFieldSize,
  SlideLayout,
  TablePlacement,
  TextBlockKind,
  ThemeId,
} from "../../types";
import { THEME_IDS } from "../palettes";
import { paneCount } from "../layout";
import { hasVisibleRich } from "../text";
import {
  MarkdownImportError,
  type MdBulletsBlock,
  type MdBlock,
  type MdCover,
  type MdCoverField,
  type MdDeck,
  type MdFigureBlock,
  type MdProjectMeta,
  type MdSection,
  type MdSlide,
  type MdTableBlock,
  type MdTextBlock,
} from "./types";

const TEXT_KINDS: TextBlockKind[] = [
  "definition",
  "theorem",
  "consensus",
  "group",
];

const BLOCK_KINDS = [
  "definition",
  "theorem",
  "consensus",
  "group",
  "bullets",
  "figure",
  "table",
  "code",
  "references",
  "footnote",
];

function fail(line: number, message: string): never {
  throw new MarkdownImportError([{ line, message }]);
}

function asRecord(value: unknown, line: number, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(line, `${path} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, line: number, path: string): unknown[] {
  if (!Array.isArray(value)) fail(line, `${path} 必须是数组`);
  return value;
}

function asString(value: unknown, line: number, path: string): string {
  if (typeof value !== "string") fail(line, `${path} 必须是字符串`);
  return value;
}

function asBoolean(value: unknown, line: number, path: string): boolean {
  if (typeof value !== "boolean") fail(line, `${path} 必须是布尔值`);
  return value;
}

function checkKeys(
  record: Record<string, unknown>,
  allowed: string[],
  line: number,
  path: string,
) {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) fail(line, `${path} 含未知字段 ${key}`);
  }
}

function nonEmpty(value: string, line: number, message: string): string {
  if (!value.trim()) fail(line, message);
  return value;
}

function parseScale(value: string | undefined, line: number): number {
  if (value === undefined) return 1;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    fail(line, "scale 必须是大于 0 的数字");
  }
  return number;
}

function parseBooleanAttr(value: string | undefined, line: number, name: string): boolean {
  if (value === undefined) return false;
  if (value !== "true" && value !== "false") {
    fail(line, `${name} 必须是 true 或 false`);
  }
  return value === "true";
}

function parsePane(
  attrs: Record<string, string>,
  layout: SlideLayout,
  line: number,
): number {
  const raw = attrs.pane;
  if (layout === "full") {
    if (raw === undefined) return 0;
    if (raw !== "0") fail(line, "整页页面只能使用 pane=0");
    return 0;
  }
  if (raw === undefined) fail(line, "分版页面的每个内容块必须写 pane");
  const pane = Number(raw);
  if (!Number.isInteger(pane) || pane < 0 || pane >= paneCount(layout)) {
    fail(line, `pane 必须是 0 到 ${paneCount(layout) - 1} 的整数`);
  }
  return pane;
}

function parseAttrs(source: string, line: number): Record<string, string> {
  const attrs: Record<string, string> = {};
  let index = 0;
  while (index < source.length) {
    while (index < source.length && /\s/.test(source[index])) index += 1;
    if (index >= source.length) break;
    const keyMatch = /^[A-Za-z][A-Za-z0-9_]*/.exec(source.slice(index));
    if (!keyMatch) fail(line, `属性格式错误：${source.slice(index)}`);
    const key = keyMatch[0];
    index += key.length;
    while (index < source.length && /\s/.test(source[index])) index += 1;
    if (source[index] !== "=") fail(line, `属性 ${key} 缺少等号`);
    index += 1;
    while (index < source.length && /\s/.test(source[index])) index += 1;
    if (index >= source.length) fail(line, `属性 ${key} 缺少值`);
    let value = "";
    if (source[index] === "\"") {
      index += 1;
      let closed = false;
      while (index < source.length) {
        const char = source[index];
        if (char === "\\" && source[index + 1] === "\"") {
          value += "\"";
          index += 2;
          continue;
        }
        if (char === "\"") {
          index += 1;
          closed = true;
          break;
        }
        value += char;
        index += 1;
      }
      if (!closed) fail(line, `属性 ${key} 的引号没有闭合`);
    } else {
      const start = index;
      while (index < source.length && !/\s/.test(source[index])) index += 1;
      value = source.slice(start, index);
    }
    if (attrs[key] !== undefined) fail(line, `属性 ${key} 重复`);
    attrs[key] = value;
  }
  return attrs;
}

function scanLinks(lines: string[]) {
  lines.forEach((line, index) => {
    if (
      /(?:https?:\/\/|ftp:\/\/|(?:^|[^A-Za-z0-9_])data:)/i.test(line) ||
      /\]\(/.test(line)
    ) {
      fail(index + 1, "不允许链接、裸地址或 data URL；请改成普通文字说明");
    }
    if (/^\s*```/.test(line)) {
      fail(index + 1, "不允许代码围栏");
    }
    if (/<\/?[A-Za-z][^>]*>/.test(line)) {
      fail(index + 1, "不允许 HTML 标签");
    }
  });
}

function keyLine(
  yamlLines: string[],
  key: string,
  fallback: number,
): number {
  const pattern = new RegExp(`^\\s*${key}\\s*:`);
  const index = yamlLines.findIndex((line) => pattern.test(line));
  return index >= 0 ? index + 2 : fallback;
}

function parseFrontmatter(
  raw: unknown,
  yamlLines: string[],
): { project: MdProjectMeta; cover: MdCover; ending?: { title: string } } {
  const record = asRecord(raw, 1, "YAML 头");
  checkKeys(record, ["format", "project", "cover", "ending"], 1, "YAML 头");
  const format = asString(
    record.format,
    1,
    "format",
  );
  if (format !== "xyj-deck/v1") {
    fail(keyLine(yamlLines, "format", 2), "format 必须是 xyj-deck/v1");
  }

  const projectLine = keyLine(yamlLines, "project", 2);
  const projectRecord = asRecord(record.project, projectLine, "project");
  checkKeys(
    projectRecord,
    ["name", "theme", "showDots"],
    projectLine,
    "project",
  );
  const name = nonEmpty(
    asString(projectRecord.name, projectLine, "project.name"),
    projectLine,
    "project.name 不能为空",
  );
  const themeText = asString(projectRecord.theme, projectLine, "project.theme");
  if (!THEME_IDS.includes(themeText as ThemeId)) {
    fail(
      keyLine(yamlLines, "theme", projectLine),
      `project.theme 必须是 ${THEME_IDS.join("、")}`,
    );
  }
  const showDots = asBoolean(
    projectRecord.showDots,
    projectLine,
    "project.showDots",
  );

  const coverLine = keyLine(yamlLines, "cover", projectLine);
  const coverRecord = asRecord(record.cover, coverLine, "cover");
  checkKeys(coverRecord, ["title", "fields"], coverLine, "cover");
  const title = nonEmpty(
    asString(coverRecord.title, coverLine, "cover.title"),
    coverLine,
    "cover.title 不能为空",
  );
  const fieldsLine = keyLine(yamlLines, "fields", coverLine);
  const fieldsValue = asArray(coverRecord.fields, fieldsLine, "cover.fields");
  if (fieldsValue.length === 0) fail(fieldsLine, "cover.fields 不能为空");
  let presenterCount = 0;
  const fields: MdCoverField[] = fieldsValue.map((item, index) => {
    const fieldRecord = asRecord(item, fieldsLine, `cover.fields[${index}]`);
    checkKeys(
      fieldRecord,
      ["label", "value", "size", "showLabel", "role"],
      fieldsLine,
      `cover.fields[${index}]`,
    );
    const label = asString(
      fieldRecord.label,
      fieldsLine,
      `cover.fields[${index}].label`,
    );
    const value = asString(
      fieldRecord.value,
      fieldsLine,
      `cover.fields[${index}].value`,
    );
    const size = asString(
      fieldRecord.size,
      fieldsLine,
      `cover.fields[${index}].size`,
    );
    if (size !== "lg" && size !== "md" && size !== "sm") {
      fail(fieldsLine, `cover.fields[${index}].size 必须是 lg、md 或 sm`);
    }
    const showLabel = asBoolean(
      fieldRecord.showLabel,
      fieldsLine,
      `cover.fields[${index}].showLabel`,
    );
    const role = fieldRecord.role;
    if (role !== undefined && role !== "presenter") {
      fail(fieldsLine, `cover.fields[${index}].role 只能是 presenter`);
    }
    if (role === "presenter") presenterCount += 1;
    return {
      label,
      value,
      size: size as CoverFieldSize,
      showLabel,
      ...(role === "presenter" ? { role: "presenter" as const } : {}),
    };
  });
  if (presenterCount !== 1) {
    fail(fieldsLine, "cover.fields 必须恰好有一个 role: presenter");
  }

  let ending: { title: string } | undefined;
  if (record.ending !== undefined) {
    const endingLine = keyLine(yamlLines, "ending", coverLine);
    const endingRecord = asRecord(record.ending, endingLine, "ending");
    checkKeys(endingRecord, ["title"], endingLine, "ending");
    ending = {
      title: nonEmpty(
        asString(endingRecord.title, endingLine, "ending.title"),
        endingLine,
        "ending.title 不能为空",
      ),
    };
  }

  return {
    project: { name, theme: themeText as ThemeId, showDots },
    cover: { title, fields },
    ...(ending ? { ending } : {}),
  };
}

function stripCenterMarker(text: string): { text: string; center: boolean } {
  const match = /^(.*?)\s*\{\.center\}\s*$/.exec(text);
  if (!match) return { text, center: false };
  return { text: match[1].trimEnd(), center: true };
}

function visibleBulletText(text: string, line: number) {
  if (!hasVisibleRich(text)) fail(line, "要点或辅助说明不能为空");
}

function parseBulletBody(lines: Array<{ text: string; line: number }>): MdBulletsBlock["items"] {
  const items: MdBulletsBlock["items"] = [];
  for (const { text: raw, line } of lines) {
    const text = raw.trimEnd();
    if (!text.trim()) continue;
    if (/^\t/.test(text)) fail(line, "要点块只能使用两个空格缩进，不能使用制表符");
    if (/^    -/.test(text)) fail(line, "要点块只允许两级：要点和两空格缩进的辅助说明");
    if (/^  - /.test(text)) {
      if (items.length === 0) fail(line, "辅助说明前必须先有要点");
      const parsed = stripCenterMarker(raw.slice(4));
      visibleBulletText(parsed.text, line);
      items[items.length - 1].notes.push({
        text: parsed.text,
        center: parsed.center,
      });
      continue;
    }
    if (/^- /.test(text)) {
      const parsed = stripCenterMarker(raw.slice(2));
      visibleBulletText(parsed.text, line);
      items.push({ text: parsed.text, center: parsed.center, notes: [] });
      continue;
    }
    fail(line, "要点块只允许 “- 要点” 和 “  - 辅助说明” 两种行");
  }
  if (items.length === 0) fail(lines[0]?.line ?? 1, "要点块至少需要一条要点");
  return items;
}

function splitPipeRow(raw: string, line: number): string[] {
  const text = raw.trim();
  if (!text.startsWith("|") || !text.endsWith("|")) {
    fail(line, "表格行必须以 | 开始并以 | 结束");
  }
  const inner = text.slice(1, -1);
  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];
    if (char === "\\" && inner[index + 1] === "|") {
      current += "|";
      index += 1;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function separatorAlign(cell: string, line: number): CellAlign {
  if (!/^:?-{3,}:?$/.test(cell)) {
    fail(line, "表格分隔行必须由 ---、:---、:---: 或 ---: 组成");
  }
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (left) return "left";
  if (right) return "right";
  return "center";
}

function parseTableBody(
  lines: Array<{ text: string; line: number }>,
  caption: string,
  pane: number,
  placement: TablePlacement,
  firstColumnHeader: boolean,
  scale: number,
  blockLine: number,
): MdTableBlock {
  const rows = lines.filter(({ text }) => text.trim());
  if (rows.length < 3) {
    fail(blockLine, "表格至少需要表头、分隔行和一行数据");
  }
  const header = splitPipeRow(rows[0].text, rows[0].line);
  const separator = splitPipeRow(rows[1].text, rows[1].line);
  if (header.length === 0) fail(rows[0].line, "表格表头不能为空");
  if (separator.length !== header.length) {
    fail(rows[1].line, `表格分隔行有 ${separator.length} 列，表头有 ${header.length} 列`);
  }
  if (header.length > 12) fail(rows[0].line, "表格列数不能超过 12");
  if (!header.some((cell) => hasVisibleRich(cell))) {
    fail(rows[0].line, "表格表头至少有一个非空单元格");
  }
  const aligns = separator.map((cell) => separatorAlign(cell, rows[1].line));
  const body = rows.slice(2).map(({ text, line }) => {
    const cells = splitPipeRow(text, line);
    if (cells.length !== header.length) {
      fail(line, `表格行有 ${cells.length} 列，表头有 ${header.length} 列`);
    }
    return cells;
  });
  if (body.length === 0) fail(blockLine, "表格至少需要一行数据");
  if (!body.some((row) => row.some((cell) => hasVisibleRich(cell)))) {
    fail(blockLine, "表格至少需要一个非空数据单元格");
  }
  return {
    kind: "table",
    pane,
    caption,
    header,
    rows: body,
    aligns,
    placement,
    firstColumnHeader,
    scale,
    line: blockLine,
  };
}

function validateImageSource(src: string, line: number) {
  const value = src.trim();
  if (!value) fail(line, "src 不能为空");
  if (/^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/|~)/.test(value) || value.includes("\\")) {
    fail(line, "src 必须是与 Markdown 同目录或子目录下的相对路径");
  }
  const parts = value.split("/");
  if (parts.some((part) => part === ".." || part === "")) {
    fail(line, "src 不能包含 ..，也不能出现空路径段");
  }
  const extension = value.split(".").pop()?.toLowerCase() ?? "";
  if (!["png", "jpg", "jpeg"].includes(extension)) {
    fail(line, "图片只允许 png、jpg 或 jpeg");
  }
}

interface PendingBlock {
  kind: string;
  attrs: Record<string, string>;
  pane: number;
  line: number;
  body: Array<{ text: string; line: number }>;
}

function finishBlockInner(pending: PendingBlock, slide: MdSlide): MdBlock {
  const { kind, attrs, pane, line, body } = pending;
  const allowedByKind: Record<string, string[]> = {
    definition: ["pane", "label", "align", "centered"],
    theorem: ["pane", "label", "align", "centered"],
    consensus: ["pane", "label", "align", "centered"],
    group: ["pane", "label", "align", "centered"],
    bullets: ["pane", "title", "centered"],
    figure: ["pane", "src", "caption", "scale", "centered"],
    table: ["pane", "caption", "placement", "firstColumnHeader", "scale", "centered"],
    code: ["pane", "title", "centered"],
    references: ["pane", "title", "centered"],
    footnote: [],
  };
  for (const key of Object.keys(attrs)) {
    if (!allowedByKind[kind].includes(key)) {
      fail(line, `${kind} 内容块含未知属性 ${key}`);
    }
  }

  if (TEXT_KINDS.includes(kind as TextBlockKind)) {
    const bodyLines = body.map(({ text }) => text);
    while (bodyLines.length && !bodyLines[0].trim()) bodyLines.shift();
    while (bodyLines.length && !bodyLines[bodyLines.length - 1].trim()) bodyLines.pop();
    const text = bodyLines.join("\n");
    if (!hasVisibleRich(text)) fail(line, "文本块正文不能为空");
    const align = attrs.align;
    if (align !== undefined && align !== "left" && align !== "center") {
      fail(line, "align 必须是 left 或 center");
    }
    const label = attrs.label?.trim();
    const block: MdTextBlock = {
      kind: kind as TextBlockKind,
      pane,
      body: text,
      line,
      ...(label ? { label } : {}),
      ...(align ? { align } : {}),
    };
    return block;
  }

  if (kind === "bullets") {
    const title = attrs.title?.trim();
    return {
      kind: "bullets",
      pane,
      ...(title ? { title } : {}),
      items: parseBulletBody(body),
      line,
    };
  }

  if (kind === "code") {
    const code = body.map(({ text }) => text).join("\n");
    if (!code.trim()) fail(line, "code 内容块不能为空");
    const title = attrs.title?.trim();
    return {
      kind: "code",
      pane,
      ...(title ? { title } : {}),
      code,
      line,
    };
  }

  if (kind === "references") {
    const items: string[] = [];
    for (const { text, line: bodyLine } of body) {
      const trimmed = text.trim();
      if (!trimmed) continue;
      if (!trimmed.startsWith("- ")) {
        fail(bodyLine, "文献行必须以 “- ” 开头");
      }
      const item = trimmed.slice(2).trim();
      if (!item) fail(bodyLine, "文献不能为空");
      items.push(item);
    }
    if (items.length === 0) fail(line, "references 内容块至少要有一条文献");
    const title = attrs.title?.trim();
    return {
      kind: "references",
      pane,
      ...(title ? { title } : {}),
      items,
      line,
    };
  }

  if (kind === "footnote") {
    const items: string[] = [];
    for (const { text, line: bodyLine } of body) {
      const trimmed = text.trim();
      if (!trimmed) continue;
      if (!trimmed.startsWith("- ")) {
        fail(bodyLine, "脚注行必须以 “- ” 开头");
      }
      const item = trimmed.slice(2).trim();
      if (!item) fail(bodyLine, "脚注不能为空");
      items.push(item);
    }
    if (items.length === 0) fail(line, "footnote 内容块至少要有一条脚注");
    return {
      kind: "footnote",
      items,
      line,
    };
  }

  if (kind === "figure") {
    for (const { text, line: bodyLine } of body) {
      if (text.trim()) fail(bodyLine, "figure 内容块不需要正文");
    }
    const src = nonEmpty(attrs.src ?? "", line, "figure 必须写 src");
    validateImageSource(src, line);
    const caption = nonEmpty(
      attrs.caption ?? "",
      line,
      "figure 必须写 caption",
    );
    const block: MdFigureBlock = {
      kind: "figure",
      pane,
      src,
      caption,
      scale: parseScale(attrs.scale, line),
      line,
    };
    return block;
  }

  const caption = nonEmpty(attrs.caption ?? "", line, "table 必须写 caption");
  const placement = attrs.placement ?? "center";
  if (placement !== "left" && placement !== "center" && placement !== "right") {
    fail(line, "placement 必须是 left、center 或 right");
  }
  const firstColumnHeader = parseBooleanAttr(
    attrs.firstColumnHeader,
    line,
    "firstColumnHeader",
  );
  return parseTableBody(
    body,
    caption,
    pane,
    placement,
    firstColumnHeader,
    parseScale(attrs.scale, line),
    line,
  );
}

function finishBlock(pending: PendingBlock, slide: MdSlide): MdBlock {
  const block = finishBlockInner(pending, slide);
  if (block.kind !== "footnote" && pending.attrs.centered !== undefined) {
    block.centered = parseBooleanAttr(
      pending.attrs.centered,
      pending.line,
      "centered",
    );
  }
  return block;
}

function parseSlideHeading(text: string, line: number): { title: string; layout: SlideLayout } {
  const match = /^##\s+(.+?)\s+\{layout=(full|rows|cols|grid)\}\s*$/.exec(text);
  if (!match) {
    fail(line, "页面标题必须写成 “## 标题 {layout=full|rows|cols|grid}”");
  }
  const title = nonEmpty(match[1], line, "页面标题不能为空");
  return { title, layout: match[2] as SlideLayout };
}

export function parseDeckMarkdown(source: string): MdDeck {
  const normalized = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0]?.trim() !== "---") {
    fail(1, "文件必须从 YAML 头开始");
  }
  let close = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "---") {
      close = index;
      break;
    }
  }
  if (close < 0) fail(1, "YAML 头没有结束标记 ---");
  const yamlLines = lines.slice(1, close);
  let raw: unknown;
  try {
    raw = yaml.load(yamlLines.join("\n"));
  } catch (error) {
    const mark = (error as { mark?: { line?: number } }).mark;
    const errorLine = 2 + (mark?.line ?? 0);
    const message = error instanceof Error ? error.message.split("\n")[0] : "YAML 解析失败";
    fail(errorLine, message);
  }
  scanLinks(lines);
  const frontmatter = parseFrontmatter(raw, yamlLines);
  const bodyLines = lines.slice(close + 1).map((text, index) => ({
    text,
    line: close + 2 + index,
  }));

  const sections: MdSection[] = [];
  let section: MdSection | null = null;
  let slide: MdSlide | null = null;
  let pending: PendingBlock | null = null;

  const closeSlide = () => {
    if (!slide) return;
    if (slide.blocks.length === 0) fail(slide.line, "页面至少需要一个内容块");
    slide = null;
  };
  const closeSection = () => {
    if (!section) return;
    if (section.slides.length === 0) fail(section.line, "章节至少需要一个页面");
    section = null;
  };

  for (const entry of bodyLines) {
    const text = entry.text;
    const trimmed = text.trim();

    if (pending) {
      if (/^:::\s*$/.test(trimmed)) {
        if (!slide) fail(entry.line, "内容块必须属于一个页面");
        const block = finishBlock(pending, slide);
        slide.blocks.push(block);
        pending = null;
        continue;
      }
      if (/^:::\s+/.test(trimmed)) {
        fail(entry.line, "内容块不能嵌套");
      }
      if (pending.kind !== "code" && /^#{1,6}\s/.test(trimmed)) {
        fail(entry.line, "内容块正文里不能出现 Markdown 标题");
      }
      pending.body.push({ text, line: entry.line });
      continue;
    }

    if (!trimmed) continue;
    if (/^:::\s*$/.test(trimmed)) fail(entry.line, "出现了没有对应开头的内容块结束标记");
    if (/^:::\s+/.test(trimmed)) {
      if (!slide) fail(entry.line, "内容块必须写在页面标题下面");
      const match = /^:::\s+([a-z]+)(?:\s+(.*))?$/.exec(trimmed);
      if (!match) fail(entry.line, "内容块开头格式错误");
      const kind = match[1];
      if (!BLOCK_KINDS.includes(kind)) {
        fail(entry.line, `未知内容块类型 ${kind}`);
      }
      const attrs = parseAttrs(match[2] ?? "", entry.line);
      const pane =
        kind === "footnote" ? 0 : parsePane(attrs, slide.layout, entry.line);
      pending = { kind, attrs, pane, line: entry.line, body: [] };
      continue;
    }
    if (/^#{1,6}\s/.test(trimmed)) {
      const level = trimmed.match(/^#+/)?.[0].length ?? 0;
      if (level === 1) {
        closeSlide();
        closeSection();
        const title = trimmed.slice(1).trim();
        if (!title) fail(entry.line, "章节标题不能为空");
        section = { title, slides: [], line: entry.line };
        sections.push(section);
        continue;
      }
      if (level === 2) {
        if (!section) fail(entry.line, "页面必须写在章节标题下面");
        closeSlide();
        const heading = parseSlideHeading(trimmed, entry.line);
        slide = {
          title: heading.title,
          layout: heading.layout,
          blocks: [],
          line: entry.line,
        };
        section.slides.push(slide);
        continue;
      }
      fail(entry.line, "只允许一级章节标题和二级页面标题");
    }
    fail(entry.line, "内容必须写在 ::: 内容块里");
  }

  if (pending) fail(pending.line, "内容块没有结束标记 :::");
  closeSlide();
  closeSection();
  if (sections.length === 0) fail(1, "至少需要一个章节和一个页面");
  return {
    project: frontmatter.project,
    cover: frontmatter.cover,
    ...(frontmatter.ending ? { ending: frontmatter.ending } : {}),
    sections,
  };
}
