import pptxgen from "pptxgenjs";
import type { Block, BulletItem, Project, SlideLayout } from "../types";
import { blockKindLabel } from "../types";
import {
  CONTENT_RECT,
  orderedBlocks,
  paneBlocks,
  paneCount,
  paneLabel,
  paneRect,
} from "./layout";
import { PALETTE_BY_ID } from "./palettes";
import { parseRich, splitRichLines, type RichMark, type RichNode } from "./richtext";
import { blockHasVisibleContent, hasVisibleRich, plainText, stripCaptionNumber } from "./text";
import { isCodeComment } from "./code";
import { endingDate, endingPresenter, endingTitle } from "./ending";

const FONT = "PingFang SC";
const TEXT = "1F2328";
const MUTED = "5F6368";
const DIVIDER = "C1C6C8";
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const PX_PER_IN = 96;
const BULLET_INSET = 33 / PX_PER_IN;

export interface PptxPaneBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function pptxPaneBoxes(
  layout: SlideLayout,
  contentHeight = CONTENT_RECT.height,
): PptxPaneBox[] {
  return Array.from({ length: paneCount(layout) }, (_, index) => {
    const rect = paneRect(layout, index, contentHeight);
    return {
      x: (CONTENT_RECT.left + rect.left) / PX_PER_IN,
      y: (CONTENT_RECT.top + rect.top) / PX_PER_IN,
      w: rect.width / PX_PER_IN,
      h: rect.height / PX_PER_IN,
    };
  });
}

let measureCanvas: HTMLCanvasElement | null = null;
if (typeof document !== "undefined") {
  measureCanvas = document.createElement("canvas");
}

function measureWidth(text: string, fontSizePt: number): number {
  const value = plainText(text);
  const context = measureCanvas?.getContext("2d");
  if (!context) return value.length * ((fontSizePt * 96) / 72) * 0.55;
  context.font = `${(fontSizePt * 96) / 72}px "${FONT}"`;
  return Math.max(
    0,
    ...value.split("\n").map((line) => context.measureText(line).width),
  );
}

function measureLines(text: string, widthInches: number, fontSizePt: number): number {
  const value = plainText(text);
  const context = measureCanvas?.getContext("2d");
  if (!context || widthInches <= 0) {
    return Math.max(1, Math.ceil(value.length / 40));
  }
  const px = (fontSizePt * 96) / 72;
  context.font = `${px}px "${FONT}"`;
  const maxWidth = widthInches * 96 * 0.96;
  let lines = 0;
  for (const paragraph of value.split("\n")) {
    if (!paragraph) {
      lines += 1;
      continue;
    }
    let width = 0;
    let count = 0;
    for (const char of Array.from(paragraph)) {
      const charWidth = context.measureText(char).width;
      if (count > 0 && width + charWidth > maxWidth) {
        lines += 1;
        width = charWidth;
        count = 1;
      } else {
        width += charWidth;
        count += 1;
      }
    }
    lines += 1;
  }
  return Math.max(1, lines);
}

function hex(value: string): string {
  return value.replace(/^#/, "");
}

type Run = { text: string; options?: Record<string, unknown> };
type LoadedImage = { data: string; w: number; h: number };

type RunStyle = Record<string, unknown>;

function nodesToRuns(
  nodes: RichNode[],
  base: string,
  accent: string,
  highlight: string,
): Run[] {
  const runs: Run[] = [];

  const addText = (value: string, style: RunStyle) => {
    const lines = value.split("\n");
    lines.forEach((line, lineIndex) => {
      if (line) {
        runs.push({ text: line, options: { ...style } });
      }
      if (lineIndex < lines.length - 1) {
        if (runs.length === 0) {
          runs.push({ text: "", options: { ...style } });
        }
        runs[runs.length - 1].options = {
          ...runs[runs.length - 1].options,
          breakLine: true,
        };
      }
    });
  };

  const walk = (nodes: RichNode[], style: RunStyle) => {
    nodes.forEach((node) => {
      if (node.type === "text") {
        addText(node.text, style);
        return;
      }
      if (node.type === "math") {
        addText(node.display ? `$$${node.tex}$$` : `$${node.tex}$`, style);
        return;
      }
      const mark = node.mark as RichMark;
      if (mark === "emphasis") {
        walk(node.children, { ...style, bold: true, color: accent });
      } else if (mark === "italic") {
        walk(node.children, { ...style, italic: true });
      } else if (mark === "underline") {
        walk(node.children, { ...style, underline: { style: "sng" } });
      } else if (mark === "strike") {
        walk(node.children, { ...style, strike: "sngStrike" });
      } else if (mark === "highlight") {
        walk(node.children, { ...style, highlight });
      } else {
        walk(node.children, style);
      }
    });
  };

  walk(nodes, { color: base });
  return runs;
}

function richRuns(
  text: string,
  base: string,
  accent: string,
  highlight = "FFF3C4",
): Run[] {
  return nodesToRuns(parseRich(text), base, accent, highlight);
}

function lineRuns(
  text: string,
  aligns: Array<"left" | "center"> | undefined,
  base: string,
  accent: string,
  highlight: string,
  fontSize: number,
  prefix = "",
): Run[] {
  const lines = splitRichLines(parseRich(text));
  const runs: Run[] = [];
  lines.forEach((nodes, lineIndex) => {
    const textRuns = nodesToRuns(nodes, base, accent, highlight);
    if (textRuns.length === 0) textRuns.push({ text: "" });
    const align = aligns?.[lineIndex] === "center" ? "center" : "left";
    textRuns.forEach((run, runIndex) => {
      runs.push({
        text: (lineIndex === 0 && runIndex === 0 ? prefix : "") + run.text,
        options: {
          ...run.options,
          fontSize,
          align,
          breakLine: runIndex === textRuns.length - 1 && lineIndex < lines.length - 1,
        },
      });
    });
  });
  return runs;
}

function bulletRuns(
  groupTitle: string,
  items: BulletItem[],
  base: string,
  accent: string,
  muted: string,
  highlight: string,
  groupColor: string,
): Run[] {
  const runs: Run[] = [];
  if (hasVisibleRich(groupTitle)) {
    const groupRuns = lineRuns(
      groupTitle,
      undefined,
      groupColor,
      accent,
      highlight,
      16,
      "",
    );
    groupRuns.forEach((run) => {
      run.options = { ...run.options, color: groupColor, bold: true };
    });
    runs.push(...groupRuns);
    if (runs.length > 0) {
      runs[runs.length - 1].options = {
        ...runs[runs.length - 1].options,
        breakLine: true,
      };
    }
  }
  items.forEach((item) => {
    runs.push(...lineRuns(item.text, item.aligns, base, accent, highlight, 14, "•  "));
    if (runs.length > 0) {
      runs[runs.length - 1].options = {
        ...runs[runs.length - 1].options,
        breakLine: true,
      };
    }
    const notes = item.notes
      .map((note, index) => ({ note, aligns: item.noteAligns?.[index] }))
      .filter(({ note }) => note.trim().length > 0);
    notes.forEach(({ note, aligns }) => {
      runs.push(...lineRuns(note, aligns, muted, accent, highlight, 14, "      "));
      if (runs.length > 0) {
        runs[runs.length - 1].options = {
          ...runs[runs.length - 1].options,
          breakLine: true,
        };
      }
    });
  });
  return runs;
}

function endingBandData(primary: string): string | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, 1280, 720);
  context.fillStyle = `#${primary}`;
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(1280, 0);
  context.lineTo(1280, 386);
  context.quadraticCurveTo(640, 428, 0, 386);
  context.closePath();
  context.fill();
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.moveTo(0, 386);
  context.quadraticCurveTo(640, 428, 1280, 386);
  context.lineTo(1280, 430);
  context.lineTo(0, 430);
  context.closePath();
  context.fill();
  context.strokeStyle = "#D8A47F";
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(0, 386);
  context.quadraticCurveTo(640, 428, 1280, 386);
  context.stroke();
  return canvas.toDataURL("image/png");
}

async function loadImage(
  src: string,
  assetUrls?: Map<string, string>,
): Promise<LoadedImage | null> {
  if (!src) return null;
  try {
    let data = assetUrls?.get(src) ?? src;
    if (!data.startsWith("data:")) {
      const response = await fetch(data);
      if (!response.ok) return null;
      const blob = await response.blob();
      data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }
    const image = new Image();
    image.src = data;
    await image.decode();
    return {
      data,
      w: image.naturalWidth || 1,
      h: image.naturalHeight || 1,
    };
  } catch {
    return null;
  }
}

type PptxPalette = {
  primary: string;
  accent: string;
  accentText: string;
  onAccent: string;
  tint: string;
  soft: string;
};

function addHeadline(
  pptx: pptxgen,
  slide: pptxgen.Slide,
  project: Project,
  palette: PptxPalette,
  logo: LoadedImage | null,
) {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: 0.5,
    fill: { color: palette.primary },
    line: { color: palette.primary },
  });
  const names = project.sections.map((section) => section.title).join("    ");
  slide.addText(names, {
    x: 0.35,
    y: 0.08,
    w: 11.9,
    h: 0.34,
    fontSize: project.sections.length > 6 ? 6 : 8,
    color: "FFFFFF",
    fontFace: FONT,
    valign: "middle",
    wrap: false,
  });
  if (logo) {
    slide.addImage({
      data: logo.data,
      x: 12.7,
      y: 0.08,
      w: 0.32,
      h: 0.32,
    });
  }
}

function addFooter(
  pptx: pptxgen,
  slide: pptxgen.Slide,
  project: Project,
  presenter: string,
  page?: string,
) {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.4,
    y: 6.98,
    w: 12.53,
    h: 0.01,
    fill: { color: DIVIDER },
    line: { color: DIVIDER },
  });
  slide.addText(presenter, {
    x: 0.4,
    y: 7.02,
    w: 4.5,
    h: 0.28,
    fontSize: 8,
    color: MUTED,
    fontFace: FONT,
  });
  slide.addText(plainText(project.cover.title), {
    x: 4.9,
    y: 7.02,
    w: 3.5,
    h: 0.28,
    fontSize: 8,
    color: TEXT,
    fontFace: FONT,
    align: "center",
  });
  if (page) {
    slide.addText(page, {
      x: 11.5,
      y: 7.02,
      w: 1.43,
      h: 0.28,
      fontSize: 8,
      color: MUTED,
      fontFace: FONT,
      align: "right",
    });
  }
}

export async function exportPptx(
  project: Project,
  assetUrls?: Map<string, string>,
): Promise<string> {
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "厦与珈";
  pptx.title = project.name;

  const theme = PALETTE_BY_ID[project.theme];
  const palette: PptxPalette = {
    primary: hex(theme.primary),
    accent: hex(theme.accent),
    accentText: hex(theme.accentText),
    onAccent: hex(theme.onAccent),
    tint: hex(theme.tint),
    soft: hex(theme.soft),
  };
  const logo = await loadImage("/whu-logo-white.png");
  const presenterField = project.cover.fields.find((field) => field.role === "presenter");
  const presenter = presenterField
    ? `${presenterField.label}：${plainText(presenterField.value)}`
    : "";
  const allSlides = project.sections.flatMap((section) => section.slides);
  const total = allSlides.length;

  const ordinals = new Map<string, number>();
  const counters: Record<string, number> = {
    definition: 0,
    theorem: 0,
    consensus: 0,
    figure: 0,
    table: 0,
  };
  for (const section of project.sections) {
    for (const slide of section.slides) {
      for (const block of orderedBlocks(slide)) {
        if (!blockHasVisibleContent(block)) continue;
        if (block.kind === "bullets" || block.kind === "group") continue;
        counters[block.kind] += 1;
        ordinals.set(block.id, counters[block.kind]);
      }
    }
  }

  // Cover
  const cover = pptx.addSlide();
  cover.background = { color: "FFFFFF" };
  addHeadline(pptx, cover, project, palette, logo);
  cover.addShape(pptx.ShapeType.rect, {
    x: 0.8,
    y: 1.45,
    w: 11.73,
    h: 2.2,
    fill: { color: palette.primary },
    line: { color: palette.primary },
  });
  cover.addText(richRuns(project.cover.title, "FFFFFF", palette.accent, palette.soft) as any, {
    x: 0.8,
    y: 1.78,
    w: 11.73,
    h: 1.25,
    fontSize: 38,
    color: "FFFFFF",
    fontFace: FONT,
    align: "center",
    valign: "middle",
  });
  cover.addShape(pptx.ShapeType.rect, {
    x: 6.37,
    y: 3.02,
    w: 0.6,
    h: 0.05,
    fill: { color: palette.accent },
    line: { color: palette.accent },
  });
  let fieldY = 4.05;
  project.cover.fields.forEach((field) => {
    const size = field.size === "lg" ? 18 : field.size === "md" ? 14 : 10;
    const value = `${field.showLabel ? `${field.label}：` : ""}${plainText(field.value)}`;
    cover.addText(value, {
      x: 0.8,
      y: fieldY,
      w: 11.73,
      h: 0.42,
      fontSize: size,
      color: field.size === "lg" ? TEXT : MUTED,
      fontFace: FONT,
      align: "center",
    });
    fieldY += field.size === "lg" ? 0.5 : field.size === "md" ? 0.38 : 0.3;
  });

  // Outline
  const toc = pptx.addSlide();
  toc.background = { color: "FFFFFF" };
  addHeadline(pptx, toc, project, palette, logo);
  toc.addText("大纲", {
    x: 0.6,
    y: 0.79,
    w: 5,
    h: 0.6,
    fontSize: 26,
    color: TEXT,
    fontFace: FONT,
  });
  const sections = project.sections;
  if (sections.length <= 5) {
    const lines = sections.map((section, index) => `${index + 1}    ${section.title}`).join("\n");
    toc.addText(lines, {
      x: 1.2,
      y: 1.75,
      w: 8.5,
      h: 4.8,
      fontSize: 20,
      color: TEXT,
      fontFace: FONT,
      lineSpacingMultiple: 1.8,
      valign: "top",
    });
  } else {
    const half = Math.ceil(sections.length / 2);
    const left = sections
      .slice(0, half)
      .map((section, index) => `${index + 1}    ${section.title}`)
      .join("\n");
    const right = sections
      .slice(half)
      .map((section, index) => `${half + index + 1}    ${section.title}`)
      .join("\n");
    toc.addText(left, {
      x: 1.0,
      y: 1.75,
      w: 5.6,
      h: 4.8,
      fontSize: 16,
      color: TEXT,
      fontFace: FONT,
      lineSpacingMultiple: 1.7,
      valign: "top",
    });
    toc.addText(right, {
      x: 6.9,
      y: 1.75,
      w: 5.6,
      h: 4.8,
      fontSize: 16,
      color: TEXT,
      fontFace: FONT,
      lineSpacingMultiple: 1.7,
      valign: "top",
    });
  }
  addFooter(pptx, toc, project, presenter);

  // Content
  for (let index = 0; index < allSlides.length; index += 1) {
    const slideData = allSlides[index];
    const slide = pptx.addSlide();
    slide.background = { color: "FFFFFF" };
    addHeadline(pptx, slide, project, palette, logo);

    slide.addText(richRuns(slideData.title, TEXT, palette.accentText, palette.soft) as any, {
      x: 0.55,
      y: 0.72,
      w: 12.2,
      h: 0.62,
      fontSize: 24,
      color: TEXT,
      fontFace: FONT,
      valign: "middle",
    });

    const footnotes = (slideData.footnotes ?? []).filter((note) =>
      hasVisibleRich(note),
    );
    const footnoteBandPx = footnotes.length > 0 ? 56 : 0;
    const contentHeightPx = CONTENT_RECT.height - footnoteBandPx;
    const paneBoxes = pptxPaneBoxes(slideData.layout, contentHeightPx);
    const grouped =
      slideData.layout === "full"
        ? [orderedBlocks(slideData)]
        : paneBlocks(slideData);
    const failPane = (paneIndex: number, message: string): never => {
      const area =
        slideData.layout === "full"
          ? "整页"
          : paneLabel(slideData.layout, paneIndex);
      throw new Error(
        `第 ${index + 1} 页“${plainText(slideData.title)}”的${area}版面：${message}`,
      );
    };

    for (const [paneIndex, box] of paneBoxes.entries()) {
      let y = box.y;
      const blocks = grouped[paneIndex] ?? [];
      const paneCentered =
        blocks.length === 1 && blocks[0].centered === true;
      const textX = box.x;
      const textW = box.w;
      const innerX = box.x + 0.2;
      const innerW = box.w - 0.4;
      const bulletX = box.x + BULLET_INSET;
      const bulletW = box.w - BULLET_INSET;

      for (const block of blocks) {
        if (!blockHasVisibleContent(block) && block.kind !== "figure") continue;
        if (
          block.kind === "definition" ||
          block.kind === "theorem" ||
          block.kind === "consensus" ||
          block.kind === "group"
        ) {
          const label = block.label?.trim() || blockKindLabel[block.kind];
          const ordinal = ordinals.get(block.id) ?? 1;
          const lines = measureLines(block.body, innerW - 0.1, 12);
          const height = 0.7 + lines * 0.24;
          const drawY = paneCentered
            ? box.y + Math.max(0, (box.h - height) / 2)
            : y;
          const blockX = textX + (block.offsetX ?? 0) / PX_PER_IN;
          const blockY = drawY + (block.offsetY ?? 0) / PX_PER_IN;
          const blockInnerX = innerX + (block.offsetX ?? 0) / PX_PER_IN;
          if (blockX < box.x - 0.01 || blockX + textW > box.x + box.w + 0.01) {
            failPane(paneIndex, "文字块超出版面宽度");
          }
          if (blockY + height > box.y + box.h + 0.01) {
            failPane(paneIndex, "文字块超出版面高度");
          }
          const accentHeader = block.kind === "consensus" || block.kind === "group";
          const headerColor = accentHeader ? palette.accent : palette.primary;
          const headerText = accentHeader ? palette.onAccent : "FFFFFF";
          slide.addShape(pptx.ShapeType.rect, {
            x: blockX,
            y: blockY,
            w: textW,
            h: height,
            fill: { color: palette.tint },
            line: { color: palette.tint },
          });
          slide.addShape(pptx.ShapeType.rect, {
            x: blockX,
            y: blockY,
            w: textW,
            h: 0.45,
            fill: { color: headerColor },
            line: { color: headerColor },
          });
          slide.addText(block.kind === "group" ? label : `${label} ${ordinal}`, {
            x: blockInnerX,
            y: blockY + 0.05,
            w: Math.max(1, innerW - 0.2),
            h: 0.35,
            fontSize: 13,
            bold: true,
            color: headerText,
            fontFace: FONT,
            valign: "middle",
          });
          slide.addText(richRuns(block.body, TEXT, palette.accentText, palette.soft) as any, {
            x: blockInnerX,
            y: blockY + 0.55,
            w: innerW,
            h: Math.max(0.15, height - 0.65),
            fontSize: 12,
            color: TEXT,
            fontFace: FONT,
            valign: "top",
            align: block.align === "center" ? "center" : "left",
            lineSpacingMultiple: 1.15,
          });
          y = drawY + height + 0.16;
          continue;
        }

        if (block.kind === "code") {
          if (!block.code.trim()) continue;
          const title = block.title?.trim() ?? "";
          const runs: Run[] = [];
          if (title) {
            const titleRuns = lineRuns(
              title,
              undefined,
              palette.primary,
              palette.accentText,
              palette.soft,
              16,
              "",
            );
            titleRuns.forEach((run) => {
              run.options = {
                ...run.options,
                color: palette.primary,
                bold: true,
              };
            });
            runs.push(...titleRuns);
            runs[runs.length - 1].options = {
              ...runs[runs.length - 1].options,
              breakLine: true,
            };
          }
          const lines = block.code.split("\n");
          lines.forEach((line) => {
            runs.push({
              text: line || " ",
              options: {
                fontFace: "Menlo",
                fontSize: 9,
                color: isCodeComment(line) ? MUTED : TEXT,
                breakLine: true,
              },
            });
          });
          const lineCount =
            (title ? measureLines(title, bulletW, 16) : 0) + lines.length;
          const height = Math.max(0.4, 0.16 + lineCount * 0.18);
          const drawY = paneCentered
            ? box.y + Math.max(0, (box.h - height) / 2)
            : y;
          const blockX = bulletX + (block.offsetX ?? 0) / PX_PER_IN;
          const blockY = drawY + (block.offsetY ?? 0) / PX_PER_IN;
          if (blockX < box.x - 0.01 || blockX + bulletW > box.x + box.w + 0.01) {
            failPane(paneIndex, "代码超出版面宽度");
          }
          if (blockY + height > box.y + box.h + 0.01) {
            failPane(paneIndex, "代码超出版面高度");
          }
          slide.addShape(pptx.ShapeType.rect, {
            x: blockX,
            y: blockY,
            w: bulletW,
            h: height,
            fill: { color: palette.soft.replace("#", "") },
            line: { color: DIVIDER, width: 0.5 },
          });
          slide.addText(runs as any, {
            x: blockX + 0.1,
            y: blockY + 0.06,
            w: bulletW - 0.2,
            h: height - 0.12,
            fontFace: "Menlo",
            fontSize: 9,
            color: TEXT,
            valign: "top",
            margin: 0,
          });
          y = drawY + height + 0.12;
          continue;
        }

        if (block.kind === "references") {
          const items = block.items.filter((item) => hasVisibleRich(item));
          if (items.length === 0) continue;
          const title = block.title?.trim() ?? "";
          const runs: Run[] = [];
          if (title) {
            const titleRuns = lineRuns(
              title,
              undefined,
              palette.primary,
              palette.accentText,
              palette.soft,
              16,
              "",
            );
            titleRuns.forEach((run) => {
              run.options = {
                ...run.options,
                color: palette.primary,
                bold: true,
              };
            });
            runs.push(...titleRuns);
            runs[runs.length - 1].options = {
              ...runs[runs.length - 1].options,
              breakLine: true,
            };
          }
          items.forEach((item) => {
            runs.push(
              ...lineRuns(
                item,
                undefined,
                TEXT,
                palette.accentText,
                palette.soft,
                9,
              ),
            );
            runs[runs.length - 1].options = {
              ...runs[runs.length - 1].options,
              breakLine: true,
            };
          });
          const lineCount =
            (title ? measureLines(title, bulletW, 16) : 0) +
            items.reduce(
              (count, item) => count + measureLines(item, bulletW - 0.2, 9),
              0,
            );
          const height = Math.max(0.35, 0.14 + lineCount * 0.16);
          const drawY = paneCentered
            ? box.y + Math.max(0, (box.h - height) / 2)
            : y;
          const blockX = bulletX + (block.offsetX ?? 0) / PX_PER_IN;
          const blockY = drawY + (block.offsetY ?? 0) / PX_PER_IN;
          if (blockX < box.x - 0.01 || blockX + bulletW > box.x + box.w + 0.01) {
            failPane(paneIndex, "文献超出版面宽度");
          }
          if (blockY + height > box.y + box.h + 0.01) {
            failPane(paneIndex, "文献超出版面高度");
          }
          slide.addText(runs as any, {
            x: blockX,
            y: blockY,
            w: bulletW,
            h: height,
            fontFace: FONT,
            fontSize: 9,
            color: TEXT,
            valign: "top",
            lineSpacingMultiple: 1.15,
          });
          y = drawY + height + 0.12;
          continue;
        }

        if (block.kind === "bullets") {
          const visibleItems = block.items.filter((item) => hasVisibleRich(item.text));
          const runs = bulletRuns(
            block.title ?? "",
            visibleItems,
            TEXT,
            palette.accentText,
            MUTED,
            palette.soft,
            palette.primary,
          );
          let lineCount = 0;
          if (hasVisibleRich(block.title ?? "")) {
            lineCount += measureLines(block.title ?? "", bulletW, 16);
          }
          visibleItems.forEach((item) => {
            lineCount += measureLines(item.text, bulletW - 0.1, 14);
            item.notes
              .filter((note) => hasVisibleRich(note))
              .forEach((note) => {
                lineCount += measureLines(note, bulletW - 0.4, 14);
              });
          });
          const height = Math.max(0.35, 0.18 + lineCount * 0.28);
          const drawY = paneCentered
            ? box.y + Math.max(0, (box.h - height) / 2)
            : y;
          const blockX = bulletX + (block.offsetX ?? 0) / PX_PER_IN;
          const blockY = drawY + (block.offsetY ?? 0) / PX_PER_IN;
          if (blockX < box.x - 0.01 || blockX + bulletW > box.x + box.w + 0.01) {
            failPane(paneIndex, "要点超出版面宽度");
          }
          if (blockY + height > box.y + box.h + 0.01) {
            failPane(paneIndex, "要点超出版面高度");
          }
          slide.addText(runs as any, {
            x: blockX,
            y: blockY,
            w: bulletW,
            h: height,
            fontSize: 14,
            color: TEXT,
            fontFace: FONT,
            valign: "top",
            lineSpacingMultiple: 1.15,
          });
          y = drawY + height + 0.12;
          continue;
        }

        if (block.kind === "figure") {
          const image = await loadImage(block.src, assetUrls);
          if (!image) {
            failPane(paneIndex, "图片无法加载或没有图片");
          }
          if (image) {
            const maxW = Math.min((box.w - 0.2) * block.scale, box.w - 0.2);
            const maxH = Math.min((220 / PX_PER_IN) * block.scale, box.h - 0.1);
            const ratio = Math.min(maxW / image.w, maxH / image.h);
            const width = image.w * ratio;
            const height = image.h * ratio;
            const captionLines = block.caption.trim()
              ? measureLines(block.caption, box.w - 0.3, 9)
              : 0;
            const captionHeight = captionLines > 0 ? 0.05 + captionLines * 0.18 : 0;
            const totalHeight =
              height + (captionHeight > 0 ? captionHeight + 0.05 : 0);
            const drawY = paneCentered
              ? box.y + Math.max(0, (box.h - totalHeight) / 2)
              : y;
            const x = box.x + (box.w - width) / 2 + block.offsetX / PX_PER_IN;
            const imageY = drawY + block.offsetY / PX_PER_IN;
            if (x < box.x - 0.01 || x + width > box.x + box.w + 0.01) {
              failPane(paneIndex, "图片超出版面宽度");
            }
            if (
              imageY < box.y - 0.01 ||
              imageY + height + (captionHeight > 0 ? captionHeight + 0.05 : 0) >
                box.y + box.h + 0.01
            ) {
              failPane(paneIndex, "图片超出版面高度");
            }
            slide.addImage({ data: image.data, x, y: imageY, w: width, h: height });
            if (block.caption.trim()) {
              const ordinal = ordinals.get(block.id) ?? 1;
              const captionX = box.x + 0.1 + block.offsetX / PX_PER_IN;
              if (
                captionX < box.x - 0.01 ||
                captionX + box.w - 0.2 > box.x + box.w + 0.01
              ) {
                failPane(paneIndex, "图注超出版面宽度");
              }
              slide.addText(
                [
                  { text: `图 ${ordinal}  `, options: { fontSize: 9, color: MUTED } },
                  ...richRuns(
                    stripCaptionNumber("图", block.caption),
                    MUTED,
                    palette.accentText,
                    palette.soft,
                  ),
                ] as any,
                {
                  x: box.x + 0.1,
                  y: imageY + height + 0.05,
                  w: box.w - 0.2,
                  h: captionHeight,
                  fontSize: 9,
                  color: MUTED,
                  fontFace: FONT,
                  align: "center",
                },
              );
            }
            y = drawY + totalHeight + 0.1;
          }
          continue;
        }

        if (block.kind === "table") {
          const tableAreaX = box.x + BULLET_INSET;
          const tableAreaW = box.w - BULLET_INSET;
          const aligns = block.aligns ?? block.header.map(() => "center" as const);
          const rows: any[] = [];
          if (block.header.length > 0) {
            rows.push(
              block.header.map((cell, columnIndex) => ({
                text: richRuns(cell, TEXT, palette.accentText, palette.soft),
                options: {
                  color: TEXT,
                  fill: { color: palette.tint },
                  align: aligns[columnIndex] ?? "center",
                },
              })),
            );
          }
          block.rows.forEach((row) => {
            rows.push(
              row.map((cell, columnIndex) => ({
                text: richRuns(cell, TEXT, palette.accentText, palette.soft),
                options: { color: TEXT, align: aligns[columnIndex] ?? "center" },
              })),
            );
          });
          const columns = block.header.length || block.rows[0]?.length || 1;
          const padX = 0.12 * block.scale;
          const baseCols = Array.from({ length: columns }, (_, columnIndex) => {
            let maxWidth = 0;
            for (const row of [block.header, ...block.rows]) {
              maxWidth = Math.max(
                maxWidth,
                measureWidth(row[columnIndex] ?? "", 14),
              );
            }
            return Math.max(0.65, maxWidth / PX_PER_IN + padX * 2);
          });
          const naturalWidth = baseCols.reduce((sum, value) => sum + value, 0);
          if (naturalWidth > tableAreaW + 0.01) {
            failPane(paneIndex, "表格宽度超出所在版面");
          }
          const colWidths = baseCols;
          const tableW = naturalWidth;
          const placeX =
            block.placement === "left"
              ? 0
              : block.placement === "right"
                ? tableAreaW - tableW
                : (tableAreaW - tableW) / 2;
          const x = tableAreaX + placeX + block.offsetX / PX_PER_IN;
          const captionLines = block.caption.trim()
            ? measureLines(block.caption, tableW, 9)
            : 0;
          const captionHeight = captionLines > 0 ? 0.05 + captionLines * 0.18 : 0;
          const captionGap = captionLines > 0 ? 0.04 : 0;
          const rowHs = rows.map((row) => {
            const maxLines = Math.max(
              1,
              ...row.map((cell: { text: Run[] }, columnIndex: number) =>
                measureLines(
                  cell.text.map((run) => run.text).join(""),
                  Math.max(0.2, colWidths[columnIndex] - padX * 2),
                  14,
                ),
              ),
            );
            return Math.max(0.32, 0.08 + maxLines * 0.26);
          });
          const tableHeight = rowHs.reduce((sum, value) => sum + value, 0);
          const totalHeight = captionHeight + captionGap + tableHeight;
          const drawY = paneCentered
            ? box.y + Math.max(0, (box.h - totalHeight) / 2)
            : y;
          const captionY = drawY + (block.offsetY ?? 0) / PX_PER_IN;
          const tableY = captionY + captionHeight + captionGap;
          if (x < box.x - 0.01 || x + tableW > box.x + box.w + 0.01) {
            failPane(paneIndex, "表格超出版面宽度");
          }
          if (block.caption.trim()) {
            const ordinal = ordinals.get(block.id) ?? 1;
            slide.addText(
              [
                { text: `表 ${ordinal}  `, options: { fontSize: 9, color: palette.primary, bold: true } },
                ...richRuns(
                  stripCaptionNumber("表", block.caption),
                  palette.primary,
                  palette.accentText,
                  palette.soft,
                ).map((run) => ({
                  ...run,
                  options: { ...run.options, bold: true },
                })),
              ] as any,
              {
                x,
                y: captionY,
                w: tableW,
                h: captionHeight,
                fontSize: 9,
                color: palette.primary,
                fontFace: FONT,
                align: "center",
              },
            );
          }
          if (rows.length > 0) {
            if (
              tableY + tableHeight > box.y + box.h + 0.01
            ) {
              failPane(paneIndex, "表格超出版面高度");
            }
            slide.addTable(rows, {
              x,
              y: tableY,
              w: tableW,
              colW: colWidths,
              border: { type: "solid", pt: 0.5, color: DIVIDER },
              fontSize: 14,
              fontFace: FONT,
              align: "center",
              valign: "middle",
              rowH: rowHs,
            });
            y = drawY + totalHeight + 0.2;
          } else {
            y = drawY;
          }
        }
      }
    }

    if (footnotes.length > 0) {
      const noteX = CONTENT_RECT.left / PX_PER_IN;
      const noteW = CONTENT_RECT.width / PX_PER_IN;
      const noteY = (CONTENT_RECT.top + contentHeightPx + 8) / PX_PER_IN;
      const noteH = 48 / PX_PER_IN;
      slide.addShape(pptx.ShapeType.rect, {
        x: noteX,
        y: noteY,
        w: noteW,
        h: 0.006,
        fill: { color: DIVIDER },
        line: { color: DIVIDER, width: 0 },
      });
      const runs: Run[] = [];
      footnotes.forEach((note, noteIndex) => {
        runs.push({
          text: `注 ${noteIndex + 1}  `,
          options: {
            fontFace: FONT,
            fontSize: 9,
            bold: true,
            color: "8A9099",
          },
        });
        runs.push(
          ...lineRuns(
            note,
            undefined,
            "8A9099",
            palette.accentText,
            palette.soft,
            9,
          ),
        );
        runs[runs.length - 1].options = {
          ...runs[runs.length - 1].options,
          breakLine: true,
        };
      });
      slide.addText(runs as any, {
        x: noteX,
        y: noteY + 0.04,
        w: noteW,
        h: noteH,
        fontFace: FONT,
        fontSize: 9,
        color: "8A9099",
        valign: "top",
        lineSpacingMultiple: 1.1,
      });
    }

    addFooter(pptx, slide, project, presenter, `${index + 1} / ${total}`);
  }


  // Ending
  const band = endingBandData(palette.primary);
  const ending = pptx.addSlide();
  ending.background = { color: "FFFFFF" };
  if (band) {
    ending.addImage({ data: band, x: 0, y: 0, w: SLIDE_W, h: SLIDE_H });
  } else {
    ending.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: SLIDE_W,
      h: 4.48,
      fill: { color: palette.primary },
      line: { color: palette.primary },
    });
  }
  if (logo) {
    ending.addImage({ data: logo.data, x: 6.217, y: 0.883, w: 0.9, h: 0.9 });
  }
  ending.addText(
    richRuns(endingTitle(project), "FFFFFF", "FFFFFF", palette.soft) as any,
    {
      x: 0.8,
      y: 2.25,
      w: 11.7,
      h: 1.2,
      fontSize: 36,
      bold: true,
      color: "FFFFFF",
      fontFace: FONT,
      align: "center",
      valign: "middle",
    },
  );
  const endPresenter = endingPresenter(project);
  const endDate = endingDate(project);
  ending.addText("汇报人：", {
    x: 4.0,
    y: 5.45,
    w: 1.3,
    h: 0.35,
    fontSize: 14,
    color: TEXT,
    fontFace: FONT,
    align: "right",
  });
  ending.addText(endPresenter, {
    x: 5.4,
    y: 5.45,
    w: 3.6,
    h: 0.35,
    fontSize: 14,
    color: TEXT,
    fontFace: FONT,
    align: "center",
  });
  ending.addShape(pptx.ShapeType.rect, {
    x: 5.4,
    y: 5.83,
    w: 3.6,
    h: 0.012,
    fill: { color: TEXT },
    line: { color: TEXT, width: 0 },
  });
  ending.addText("汇报时间：", {
    x: 3.55,
    y: 6.2,
    w: 1.75,
    h: 0.35,
    fontSize: 14,
    color: TEXT,
    fontFace: FONT,
    align: "right",
  });
  ending.addText(endDate, {
    x: 5.4,
    y: 6.2,
    w: 3.6,
    h: 0.35,
    fontSize: 14,
    color: TEXT,
    fontFace: FONT,
    align: "center",
  });
  ending.addShape(pptx.ShapeType.rect, {
    x: 5.4,
    y: 6.58,
    w: 3.6,
    h: 0.012,
    fill: { color: TEXT },
    line: { color: TEXT, width: 0 },
  });

  return (await pptx.write({ outputType: "base64" })) as string;
}
