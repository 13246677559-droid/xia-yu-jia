import { themeFiles, logoBase64 } from "virtual:xyj-theme";
import type { Project } from "../types";
import {
  assetDataUrl,
  compileFiles,
  readAsset,
  type CompileFile,
} from "./backend";
import { generateDeck, type GeneratedDeck, type SlideLine } from "./texgen/generate";

export interface DeckFiles {
  files: CompileFile[];
  deck: GeneratedDeck;
}

export async function collectDeckFiles(
  project: Project,
  projectPath: string,
): Promise<DeckFiles> {
  const deck = generateDeck(project);
  const files: CompileFile[] = [
    { path: "main.tex", text: deck.tex },
    ...Object.entries(themeFiles).map(([name, text]) => ({ path: name, text })),
    { path: "assets/whu-logo-white.png", base64: logoBase64 },
  ];
  for (const asset of deck.assets) {
    const data = await readAsset(projectPath, asset.src);
    files.push({ path: asset.texPath, base64: data.base64 });
  }
  return { files, deck };
}

export interface LogIssue {
  severity: "error" | "warning";
  line: number | null;
  message: string;
}

function friendlyCompileMessage(message: string): string {
  if (message.includes("XYJ_PANE_OVERFLOW")) return "版面内容超出版面高度";
  if (message.includes("XYJ_PANE_NO_ROOM")) return "页面标题过高或版面空间不足";
  if (message.includes("XYJ_TABLE_TOO_WIDE")) return "表格宽度超出所在版面";
  if (message.includes("XYJ_TABLE_OUT_OF_BOUNDS")) return "表格超出所在版面";
  return message;
}

export function parseCompileLog(log: string): LogIssue[] {
  const issues: LogIssue[] = [];
  const seen = new Set<string>();
  for (const rawLine of log.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.includes("nullfont")) continue;
    if (line.startsWith("warning: could not represent character")) continue;
    if (line.includes("You have requested package") || line.includes("you may need to load")) continue;
    const match = /^(error|warning):\s+main\.tex:(\d+):\s*(.+)$/.exec(line);
    if (match) {
      const message = match[3].trim();
      if (!message) continue;
      const key = `${match[1]}:${match[2]}:${message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push({
        severity: match[1] === "error" ? "error" : "warning",
        line: Number(match[2]),
        message: friendlyCompileMessage(message),
      });
      continue;
    }
    if (/^error:\s+/.test(line) && !line.includes("halted on potentially-recoverable")) {
      const message = friendlyCompileMessage(
        line.replace(/^error:\s+/, "").trim(),
      );
      if (message && !seen.has(message)) {
        seen.add(message);
        issues.push({ severity: "error", line: null, message });
      }
    }
  }
  return issues;
}

export class CompileError extends Error {
  issues: LogIssue[];
  line: number | null;
  deck?: GeneratedDeck;

  constructor(issues: LogIssue[], deck?: GeneratedDeck) {
    const first = issues.find((issue) => issue.severity === "error") ?? issues[0];
    super(first?.message ?? "LaTeX 编译失败");
    this.name = "CompileError";
    this.issues = issues;
    this.line = first?.line ?? null;
    this.deck = deck;
  }
}

export function slideForLine(
  slideLines: SlideLine[],
  line: number | null,
): SlideLine | null {
  if (line === null) return null;
  let match: SlideLine | null = null;
  for (const slide of slideLines) {
    if (slide.line <= line) match = slide;
    else break;
  }
  return match;
}

export function describeCompileError(
  error: unknown,
  project: Project,
  deck: GeneratedDeck | null,
): string {
  if (!(error instanceof CompileError)) {
    return error instanceof Error ? error.message : "编译失败";
  }
  const line = error.line;
  if (deck && line !== null) {
    const slide = slideForLine(deck.slideLines, line);
    if (slide) {
      for (const section of project.sections) {
        const found = section.slides.find((item) => item.id === slide.id);
        if (found) {
          return `“${found.title}”第 ${line} 行：${error.message}`;
        }
      }
    }
  }
  return line === null ? error.message : `第 ${line} 行：${error.message}`;
}

export async function compileProject(project: Project, projectPath: string) {
  const started = performance.now();
  const { files, deck } = await collectDeckFiles(project, projectPath);
  const result = await compileFiles(files);
  const issues = parseCompileLog(result.log);
  if (!result.success || !result.pdf) {
    throw new CompileError(issues, deck);
  }
  return {
    pdf: result.pdf,
    deck,
    issues,
    duration: performance.now() - started,
  };
}

export async function resolveAssetUrl(
  projectPath: string,
  src: string,
): Promise<string> {
  const data = await readAsset(projectPath, src);
  return assetDataUrl(data);
}
