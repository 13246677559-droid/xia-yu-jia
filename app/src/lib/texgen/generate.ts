import type {
  Block,
  BulletItem,
  CodeBlock,
  CoverField,
  FigureBlock,
  Project,
  ReferencesBlock,
  Section,
  Slide,
  TableBlock,
  TextBlock,
  LineAlign,
} from "../../types";
import { hasVisibleRich, plainText, stripCaptionNumber } from "../text";
import { parseRich, splitRichLines } from "../richtext";
import { orderedBlocks, paneBlocks } from "../layout";
import { endingDate, endingPresenter, endingTitle } from "../ending";
import {
  escapeTex,
  plainToTex,
  preserveCjkSpaces,
  richNodesToTex,
  richToTex,
} from "./rich";
import { isCodeComment } from "../code";

export interface AssetRef {
  texPath: string;
  src: string;
}

export interface SlideLine {
  id: string;
  line: number;
}

export interface GeneratedDeck {
  tex: string;
  assets: AssetRef[];
  slideLines: SlideLine[];
  totalPages: number;
}

const DOT_LIMIT = 12;

function fail(message: string): never {
  throw new Error(message);
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string") fail(`${path} 必须是字符串`);
  return value;
}

function requiredNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${path} 必须是有效数字`);
  }
  return value;
}

function numberText(value: number): string {
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function offsetCm(pixels: number): string {
  return `${numberText(pixels * 0.0125)}cm`;
}

function assetExtension(src: string, path: string): string {
  if (!src) fail(`${path} 缺少图片文件`);
  if (src.startsWith("data:")) {
    const match = /^data:image\/([a-zA-Z0-9+.-]+)[;,]/i.exec(src);
    if (!match) fail(`${path} 的图片数据格式无法识别`);
    const subtype = match[1].toLowerCase();
    if (subtype === "jpeg" || subtype === "jpg" || subtype === "png" || subtype === "pdf") {
      return subtype === "jpeg" ? "jpg" : subtype;
    }
    fail(`${path} 的图片格式 ${subtype} 无法写入 LaTeX`);
  }
  const clean = src.split("?")[0].split("#")[0];
  const extension = clean.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "jpeg") return "jpg";
  if (extension === "png" || extension === "jpg" || extension === "pdf") return extension;
  fail(`${path} 的图片格式 ${extension || "未知"} 无法写入 LaTeX`);
}

function blockPath(section: Section, slide: Slide, block: Block): string {
  return `章节“${section.title}”页面“${slide.title}”内容块 ${block.id}`;
}

function isTextBox(block: Block): boolean {
  return (
    block.kind === "definition" ||
    block.kind === "theorem" ||
    block.kind === "consensus" ||
    block.kind === "group"
  );
}

function placementLetter(placement: TableBlock["placement"]): "l" | "c" | "r" {
  if (placement === "left") return "l";
  if (placement === "right") return "r";
  return "c";
}

function activeDot(indexInSection: number, slideCount: number): number {
  if (slideCount <= DOT_LIMIT) return indexInSection + 1;
  return Math.round((indexInSection * (DOT_LIMIT - 1)) / Math.max(1, slideCount - 1)) + 1;
}

function presenterText(field: CoverField | undefined): string {
  if (!field) return "";
  const label = plainText(field.label).trim().replace(/[：:]$/, "");
  const value = plainText(field.value).trim();
  return label && field.showLabel ? `${label}：${value}` : value;
}

function coverFieldTex(field: CoverField): string {
  const size = field.size;
  if (size !== "lg" && size !== "md" && size !== "sm") {
    fail(`封面字段“${field.label}”的字号 ${String(size)} 无效`);
  }
  const value = preserveCjkSpaces(
    richToTex(requiredString(field.value, `封面字段“${field.label}”的值`), {
      displayMath: "inline",
      lineBreak: "break",
    }),
  );
  const label = requiredString(field.label, "封面字段的标签").trim().replace(/[：:]$/, "");
  const prefix = field.showLabel && label ? `${plainToTex(label)}：` : "";
  return `\\xyjcoverfield[${size}]{${prefix}${value}}`;
}

function textBlockTex(block: TextBlock, path: string): string | null {
  const source = requiredString(block.body, `${path} 的正文`);
  if (!hasVisibleRich(source)) return null;
  const lineBreak = String.raw`\\`;
  const displayOpen = String.raw`\[`;
  const displayClose = String.raw`\]`;
  const body = richToTex(source)
    .replaceAll(lineBreak + displayOpen, displayOpen)
    .replaceAll(displayClose + lineBreak, displayClose);
  const content = block.align === "center" ? `\\centering ${body}` : body;
  const label = block.label?.trim()
    ? `[${plainToTex(block.label.trim()).replace(/]/g, "{]}")}]`
    : "";
  return `\\begin{${block.kind}box}${label}\n    ${content}\n  \\end{${block.kind}box}`;
}

function alignedLines(
  text: string,
  aligns: LineAlign[] | undefined,
  centerMacro: string,
): string {
  const lines = splitRichLines(parseRich(text));
  return lines
    .map((nodes, index) => {
      const content = richNodesToTex(nodes) || "\\mbox{}";
      return aligns?.[index] === "center"
        ? `\\${centerMacro}{${content}}`
        : content;
    })
    .join(" \\\\\n      ");
}

function bulletItemTex(item: BulletItem, path: string): string {
  const text = alignedLines(
    requiredString(item.text, `${path} 的要点文字`),
    item.aligns,
    "xyjcenterline",
  );
  if (!Array.isArray(item.notes)) fail(`${path} 的辅助说明必须是数组`);
  const notes = item.notes
    .map((note, index) => ({ note, aligns: item.noteAligns?.[index] }))
    .filter(({ note }) => hasVisibleRich(note))
    .map(
      ({ note, aligns }) =>
        `\n    \\xyjnote{${alignedLines(note, aligns, "xyjnotecenterline")}}`,
    )
    .join("");
  return `\\item ${text}${notes}`;
}

function bulletsBlockTex(
  block: Extract<Block, { kind: "bullets" }>,
  path: string,
): string | null {
  if (!Array.isArray(block.items)) fail(`${path} 缺少要点列表`);
  const items = block.items.filter((item) => hasVisibleRich(item.text));
  if (items.length === 0) return null;
  const title =
    block.title && hasVisibleRich(block.title)
      ? `\\xyjbulletgroup{${richToTex(block.title, { displayMath: "inline" })}}\n  `
      : "";
  return `${title}\\begin{itemize}\n    ${items
    .map((item) => bulletItemTex(item, path))
    .join("\n    ")}\n  \\end{itemize}`;
}

function figureBlockTex(
  block: FigureBlock,
  path: string,
  assets: AssetRef[],
): string {
  const scale = requiredNumber(block.scale, `${path} 的缩放比例`);
  if (scale <= 0) fail(`${path} 的缩放比例必须大于 0`);
  const offsetX = requiredNumber(block.offsetX, `${path} 的水平偏移`);
  const offsetY = requiredNumber(block.offsetY, `${path} 的垂直偏移`);
  const src = requiredString(block.src, `${path} 的图片`);
  const extension = assetExtension(src, path);
  const texPath = `assets/fig-${block.id}.${extension}`;
  assets.push({ texPath, src });
  const caption = richToTex(
    stripCaptionNumber("图", requiredString(block.caption, `${path} 的图注`)),
    { displayMath: "inline" },
  );
  return `\\xyjfigure{${numberText(scale)}}{${offsetCm(offsetX)}}{${offsetCm(offsetY)}}{${texPath}}{${caption}}`;
}

function tableCellTex(text: string, path: string): string {
  const source = requiredString(text, path);
  const value = richToTex(source, { displayMath: "inline" });
  const cell = source.includes("\n") ? `\\makecell{${value}}` : value;
  return `\\textcolor{xyjText}{${cell}}`;
}

function tableBlockTex(block: TableBlock, path: string): string | null {
  if (!Array.isArray(block.header) || block.header.length === 0) {
    fail(`${path} 缺少表头`);
  }
  if (!Array.isArray(block.rows) || block.rows.length === 0) {
    return null;
  }
  if (!block.rows.some((row) => row.some((cell) => hasVisibleRich(cell)))) {
    return null;
  }
  block.rows.forEach((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== block.header.length) {
      fail(`${path} 第 ${rowIndex + 1} 行的列数与表头不一致`);
    }
  });
  const scale = requiredNumber(block.scale, `${path} 的缩放比例`);
  if (scale <= 0) fail(`${path} 的缩放比例必须大于 0`);
  const offsetX = requiredNumber(block.offsetX, `${path} 的水平偏移`);
  const offsetY = requiredNumber(block.offsetY, `${path} 的垂直偏移`);
  const caption = richToTex(
    stripCaptionNumber("表", requiredString(block.caption, `${path} 的表注`)),
    { displayMath: "inline" },
  );
  const aligns = block.aligns ?? block.header.map(() => "center" as const);
  if (aligns.length !== block.header.length) {
    fail(`${path} 的列对齐数量与表头不一致`);
  }
  const columns = aligns
    .map((align) => (align === "left" ? "l" : align === "right" ? "r" : "c"))
    .join("");
  const header = block.header
    .map((cell) => `\\xyjth{${tableCellTex(cell, `${path} 的表头`)}}`)
    .join(" & ");
  const rows = block.rows
    .map((row) =>
      row
        .map((cell, columnIndex) =>
          block.firstColumnHeader && columnIndex === 0
            ? `\\xyjrowhead{${tableCellTex(cell, `${path} 的行标题`)}}`
            : tableCellTex(cell, `${path} 的表格单元格`),
        )
        .join(" & "),
    )
    .map((row) => `    ${row} \\\\`)
    .join("\n");
  const tabular = `\\begin{tabular}{${columns}}
    \\toprule
    ${header} \\\\
    \\midrule[0.25pt]
${rows}
    \\bottomrule
  \\end{tabular}`;
  return `\\xyjtable{${placementLetter(block.placement)}}{${numberText(scale)}}{${offsetCm(offsetX)}}{${offsetCm(offsetY)}}{${caption}}{${tabular}}`;
}

function blockSequenceTex(
  blocks: Block[],
  section: Section,
  slide: Slide,
  assets: AssetRef[],
  firstTextSpacing: boolean,
): string {
  const parts: string[] = [];
  let rendered = 0;
  blocks.forEach((block) => {
    const path = blockPath(section, slide, block);
    const body = blockTex(block, path, assets);
    if (!body) return;
    if (rendered === 0 && firstTextSpacing && isTextBox(block)) {
      parts.push("\\vspace*{3mm}");
    }
    if (rendered > 0) {
      parts.push("\\par\\vspace{2.25mm}");
    }
    parts.push(body);
    rendered += 1;
  });
  return parts.join("\n");
}

function tocTex(sections: Section[]): string[] {
  if (sections.length === 0) return [];
  const columns = sections.length > 5 ? 2 : 1;
  const rowCount = Math.ceil(sections.length / columns);
  const rows: string[] = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const cells: string[] = [];
    for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
      const index = rowIndex * columns + columnIndex;
      const section = sections[index];
      cells.push(
        section
          ? `\\xyjtocitem{${index + 1}}{${plainToTex(section.title)}}`
          : "",
      );
    }
    const suffix = rowIndex < rowCount - 1 ? " \\\\[3.5mm]" : "";
    rows.push(`${cells.join(" & ")}${suffix}`);
  }
  const width = columns === 2 ? "0.43\\linewidth" : "0.90\\linewidth";
  const spec =
    columns === 2
      ? `@{}p{${width}}@{\\hspace{0.052\\linewidth}}p{${width}}@{}`
      : `@{}p{${width}}@{}`;
  return [`\\begin{tabular}[t]{${spec}}`, ...rows.map((row) => `  ${row}`), "\\end{tabular}"];
}

function codeBlockTex(block: CodeBlock, path: string): string {
  const code = requiredString(block.code, `${path} 的代码`);
  if (!code.trim()) fail(`${path} 的代码不能为空`);
  const title = block.title?.trim() ?? "";
  const lines = code
    .split("\n")
    .map((line) => {
      const escaped = escapeTex(line) || "\\mbox{}";
      return isCodeComment(line)
        ? `\\xyjcodecomment{${escaped}}`
        : `\\xyjcodeline{${escaped}}`;
    })
    .join("\n");
  const titleTex = title
    ? richToTex(title, { displayMath: "inline" })
    : "";
  return `\\xyjcode{${titleTex}}{${lines}}`;
}

function referencesBlockTex(
  block: ReferencesBlock,
  path: string,
): string | null {
  if (!Array.isArray(block.items)) fail(`${path} 缺少文献列表`);
  const items = block.items.filter((item) => hasVisibleRich(item));
  if (items.length === 0) return null;
  const title = block.title?.trim() ?? "";
  const titleTex = title
    ? richToTex(title, { displayMath: "inline" })
    : "";
  const body = items
    .map(
      (item) =>
        `\\xyjreference{${richToTex(item, { displayMath: "inline" })}}`,
    )
    .join("\n  ");
  return `\\xyjreferences{${titleTex}}{${body}}`;
}

function blockTex(block: Block, path: string, assets: AssetRef[]): string | null {
  let body: string | null = null;
  switch (block.kind) {
    case "definition":
    case "theorem":
    case "consensus":
    case "group":
      body = textBlockTex(block, path);
      break;
    case "bullets":
      body = bulletsBlockTex(block, path);
      break;
    case "figure":
      body = figureBlockTex(block, path, assets);
      break;
    case "table":
      body = tableBlockTex(block, path);
      break;
    case "code":
      body = codeBlockTex(block, path);
      break;
    case "references":
      body = referencesBlockTex(block, path);
      break;
    default:
      fail(`${path} 的类型无法识别`);
  }
  if (!body) return null;
  if (block.kind === "figure" || block.kind === "table") return body;
  const offsetX = block.offsetX ?? 0;
  const offsetY = block.offsetY ?? 0;
  if (offsetX === 0 && offsetY === 0) return body;
  return `\\vspace*{${offsetCm(offsetY)}}\\noindent\\hspace*{${offsetCm(offsetX)}}\\begin{minipage}{\\linewidth}${body}\\end{minipage}\\par`;
}

export function generateDeck(project: Project): GeneratedDeck {
  const assets: AssetRef[] = [];
  const slideLines: SlideLine[] = [];
  const lines: string[] = [];
  const physicalLine = (): number =>
    lines.reduce((count, text) => count + text.split("\n").length, 0) + 1;
  const totalPages = project.sections.reduce(
    (sum, section) => sum + section.slides.length,
    0,
  );
  const presenter =
    project.cover.fields.find((field) => field.role === "presenter") ?? undefined;

  lines.push("\\documentclass[aspectratio=169,10pt]{ctexbeamer}");
  lines.push(`\\usetheme[${project.theme}]{XYJ}`);
  lines.push("");
  lines.push(`\\xyjnavcount{${project.sections.length}}`);
  project.sections.forEach((section, sectionIndex) => {
    const dotCount = Math.min(section.slides.length, DOT_LIMIT);
    lines.push(
      `\\xyjnavsection{${sectionIndex + 1}}{${plainToTex(section.title)}}{${dotCount}}`,
    );
  });
  lines.push(`\\xyjnavdots{${project.showDots ? "true" : "false"}}`);
  lines.push(`\\xyjpresenter{${plainToTex(presenterText(presenter))}}`);
  lines.push(`\\xyjcourse{${plainToTex(plainText(project.cover.title))}}`);
  lines.push(`\\xyjtotalpages{${totalPages}}`);
  lines.push("");
  lines.push("\\begin{document}");
  lines.push("");

  lines.push("\\setcounter{xyjsection}{0}");
  lines.push("\\setcounter{xyjdot}{0}");
  lines.push("\\xyjnofooter");
  lines.push("\\begin{frame}[t]");
  lines.push("  \\vspace{0.6cm}");
  lines.push(
    `  \\xyjcoverband{${preserveCjkSpaces(
      richToTex(requiredString(project.cover.title, "封面标题"), {
        displayMath: "inline",
      }),
    )}}`,
  );
  lines.push("  \\vspace{0.37cm}");
  project.cover.fields.forEach((field) => {
    lines.push(`  ${coverFieldTex(field)}`);
  });
  lines.push("\\end{frame}");
  lines.push("");

  lines.push("\\xyjfooter");
  lines.push("\\xyjnopage");
  project.sections.forEach((section) => {
    lines.push(`\\section{${plainToTex(section.title)}}`);
  });
  lines.push("\\begin{frame}[t]{大纲}");
  lines.push("  \\vspace*{6.5mm}");
  lines.push("  \\hspace*{6.5mm}");
  tocTex(project.sections).forEach((line) => lines.push(`  ${line}`));
  lines.push("\\end{frame}");
  lines.push("");

  lines.push("\\xyjpage");
  let pageNumber = 0;
  project.sections.forEach((section, sectionIndex) => {
    section.slides.forEach((slide, slideIndex) => {
      pageNumber += 1;
      const frameLine = physicalLine();
      slideLines.push({ id: slide.id, line: frameLine });
      lines.push(`\\setcounter{xyjsection}{${sectionIndex + 1}}`);
      lines.push(
        `\\setcounter{xyjdot}{${activeDot(slideIndex, section.slides.length)}}`,
      );
      lines.push(`\\setcounter{xyjpage}{${pageNumber}}`);
      const title = richToTex(requiredString(slide.title, `页面 ${slide.id} 的标题`), {
        displayMath: "inline",
      });
      const footnotes = (slide.footnotes ?? []).filter((note) =>
        hasVisibleRich(note),
      );
      lines.push(`\\begin{frame}[t]{${title}}`);
      lines.push("  \\setlength{\\topsep}{0pt}\\setlength{\\partopsep}{0pt}\\setlength{\\parskip}{0pt}");
      lines.push(
        `  \\setlength{\\xyjfootnoteheight}{${footnotes.length > 0 ? "0.7cm" : "0pt"}}`,
      );
      if (slide.layout === "full") {
        const fullBlocks = orderedBlocks(slide);
        const centeredFull =
          fullBlocks.length === 1 && fullBlocks[0].centered === true;
        if (centeredFull) {
          lines.push("  \\vspace*{\\fill}");
        }
        const body = blockSequenceTex(
          fullBlocks,
          section,
          slide,
          assets,
          !centeredFull,
        );
        body.split("\n").forEach((line) => lines.push(`  ${line}`));
        if (centeredFull) {
          lines.push("  \\vspace*{\\fill}");
        }
      } else {
        lines.push("  \\xyjpanesetup");
        const panes = paneBlocks(slide);
        const paneCentered = (index: number): boolean => {
          const group = panes[index] ?? [];
          return group.length === 1 && group[0].centered === true;
        };
        const paneBox = (index: number): string =>
          paneCentered(index) ? "\\xyjpaneboxc" : "\\xyjpanebox";
        const paneArg = (content: string): string => {
          if (!content.trim()) return "{}";
          return `{%\n${content
            .split("\n")
            .map((line) => `    ${line}`)
            .join("\n")}\n  }`;
        };
        const paneTex = (index: number, firstSpacing = false): string =>
          blockSequenceTex(
            panes[index] ?? [],
            section,
            slide,
            assets,
            firstSpacing,
          );
        if (slide.layout === "rows") {
          lines.push(
            `  \\noindent${paneBox(0)}{\\xyjpanefullwidth}{\\xyjpaneheight}${paneArg(paneTex(0))}\\par`,
          );
          lines.push("  \\vspace{0.3cm}%");
          lines.push(
            `  \\noindent${paneBox(1)}{\\xyjpanefullwidth}{\\xyjpaneheight}${paneArg(paneTex(1))}\\par`,
          );
        } else if (slide.layout === "cols") {
          lines.push(
            `  \\noindent${paneBox(0)}{\\xyjpanewidth}{\\xyjpanelayoutheight}${paneArg(
              paneTex(0),
            )}\\hspace{0.3cm}${paneBox(1)}{\\xyjpanewidth}{\\xyjpanelayoutheight}${paneArg(
              paneTex(1),
            )}\\par`,
          );
        } else {
          lines.push(
            `  \\noindent${paneBox(0)}{\\xyjpanewidth}{\\xyjpaneheight}${paneArg(
              paneTex(0),
            )}\\hspace{0.3cm}${paneBox(1)}{\\xyjpanewidth}{\\xyjpaneheight}${paneArg(
              paneTex(1),
            )}\\par`,
          );
          lines.push("  \\vspace{0.3cm}%");
          lines.push(
            `  \\noindent${paneBox(2)}{\\xyjpanewidth}{\\xyjpaneheight}${paneArg(
              paneTex(2),
            )}\\hspace{0.3cm}${paneBox(3)}{\\xyjpanewidth}{\\xyjpaneheight}${paneArg(
              paneTex(3),
            )}\\par`,
          );
        }
      }
      if (footnotes.length > 0) {
        const content = footnotes
          .map(
            (note, index) =>
              `\\xyjfootnote{${index + 1}}{${richToTex(note, {
                displayMath: "inline",
              })}}`,
          )
          .join("\n    ");
        lines.push(`  \\xyjfootnotes{%\n    ${content}\n  }`);
      }
      lines.push("\\end{frame}");
      lines.push("");
    });
  });

  lines.push(
    `\\xyjendpage{${richToTex(endingTitle(project), { displayMath: "inline" })}}{${plainToTex(endingPresenter(project))}}{${plainToTex(endingDate(project))}}`,
  );
  lines.push("\\begin{frame}[plain]");
  lines.push("\\end{frame}");
  lines.push("");
  lines.push("\\end{document}");
  lines.push("");

  return {
    tex: lines.join("\n"),
    assets,
    slideLines,
    totalPages,
  };
}
