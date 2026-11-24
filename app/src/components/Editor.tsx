import {
  Fragment,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import type {
  Block,
  BlockKind,
  BulletItem,
  BulletsBlock,
  CellAlign,
  Cover,
  CoverField,
  CoverFieldSize,
  LineAlign,
  Project,
  ReferencesBlock,
  Section,
  Slide,
  SlideLayout,
  TableBlock,
  TextBlock,
  ThemeId,
} from "../types";
import { blockKindLabel, coverSizeLabel } from "../types";
import { paletteOf, shortTheme, themeVars } from "../lib/palettes";
import {
  orderedBlocks,
  paneBlocks,
  paneLabel,
  relayoutSlide,
  SLIDE_LAYOUTS,
} from "../lib/layout";
import { makeBlock, makeBulletItem, makeBulletsBlock, makeSection, makeSlide, uid } from "../data";
import { blockHasVisibleContent, plainText } from "../lib/text";
import { parseRich, splitRichLines, type RichMark } from "../lib/richtext";
import { exportPptx } from "../lib/pptx";
import { makeEdgePresentationPdf } from "../lib/pdfCompat";
import { buildAiPackage, buildLatexZip } from "../lib/export";
import { CompileError, compileProject, describeCompileError } from "../lib/compile";
import { auditWebLayout } from "../lib/layoutAudit";
import type { GeneratedDeck } from "../lib/texgen/generate";
import { isDesktop, pickYamlFile, saveExport } from "../lib/backend";
import { endingDate, endingPresenter, endingTitle } from "../lib/ending";
import { parseProject } from "../lib/project/schema";
import yaml from "js-yaml";
import { Icon } from "./Icons";
import { SlidePreview } from "./SlidePreview";
import { PdfPreview } from "./PdfPreview";
import { PaletteGallery } from "./PaletteGallery";

interface EditorProps {
  project: Project;
  projectPath: string;
  assetUrls: Map<string, string>;
  projects: Array<{ path: string; name: string; theme: ThemeId }>;
  onSwitchProject: (path: string) => void;
  onChange: (next: Project) => void;
  onBack: () => void;
  onToast: (message: string) => void;
  onImportAsset: (file: File) => Promise<string>;
}

const EditorThemeContext = createContext<ThemeId>("whu");

type RichVariant = "body" | "compact" | "title" | "groupTitle" | "cell";

const variantClass: Record<RichVariant, string> = {
  body: "rich-editor",
  compact: "rich-editor compact",
  title: "rich-editor title",
  groupTitle: "rich-editor compact group-title",
  cell: "rich-editor cell",
};

const BLOCK_KINDS: BlockKind[] = [
  "definition",
  "theorem",
  "consensus",
  "group",
  "bullets",
  "figure",
  "table",
  "code",
  "references",
];

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function htmlFromNode(node: ReturnType<typeof parseRich>[number]): string {
  if (node.type === "text") {
    return escapeHtml(node.text).replace(/\n/g, "<br>");
  }
  if (node.type === "math") {
    return escapeHtml(node.display ? `$$${node.tex}$$` : `$${node.tex}$`);
  }
  const inner = node.children.map(htmlFromNode).join("");
  if (node.mark === "emphasis") return `<strong class="kw">${inner}</strong>`;
  if (node.mark === "italic") return `<em>${inner}</em>`;
  if (node.mark === "underline") return `<u>${inner}</u>`;
  if (node.mark === "strike") return `<s>${inner}</s>`;
  if (node.mark === "overline") return `<span class="overline">${inner}</span>`;
  return `<mark>${inner}</mark>`;
}

function toHtml(value: string) {
  return parseRich(value).map(htmlFromNode).join("");
}

function serialize(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const element = node as HTMLElement;
  if (element.tagName === "BR") return "\n";
  const inner = Array.from(element.childNodes).map(serialize).join("");
  if (element.tagName === "STRONG" || element.tagName === "B") return `**${inner}**`;
  if (element.tagName === "EM" || element.tagName === "I") return `//${inner}//`;
  if (element.tagName === "U") return `__${inner}__`;
  if (
    element.tagName === "S" ||
    element.tagName === "STRIKE" ||
    element.tagName === "DEL"
  ) {
    return `~~${inner}~~`;
  }
  if (element.tagName === "MARK") return `==${inner}==`;
  if (element.tagName === "SPAN" && element.classList.contains("overline")) {
    return `^^${inner}^^`;
  }
  if (element.tagName === "DIV" || element.tagName === "P") return `\n${inner}`;
  return inner;
}

function normalizeLineAligns(value: string, aligns?: LineAlign[]): LineAlign[] {
  const count = value.split("\n").length;
  return Array.from({ length: count }, (_, index) => aligns?.[index] ?? "left");
}

function toLineHtml(value: string, aligns?: LineAlign[]): string {
  const normalized = normalizeLineAligns(value, aligns);
  const lines = splitRichLines(parseRich(value));
  return lines
    .map((nodes, index) => {
      const align = normalized[index] ?? "left";
      const inner = nodes.map(htmlFromNode).join("") || "<br>";
      return `<div class="rich-line" data-align="${align}" style="text-align:${align}">${inner}</div>`;
    })
    .join("");
}

function lineAlignOf(element: HTMLElement): LineAlign {
  if (element.dataset.align === "center" || element.style.textAlign === "center") {
    return "center";
  }
  return "left";
}

function serializeLineEditor(element: HTMLElement): {
  text: string;
  aligns: LineAlign[];
} {
  const lines: Array<{ text: string; align: LineAlign }> = [];
  let inline: Node[] = [];

  const flushInline = () => {
    if (inline.length === 0) return;
    const text = inline.map(serialize).join("");
    if (text.length > 0) lines.push({ text, align: "left" });
    inline = [];
  };

  Array.from(element.childNodes).forEach((node) => {
    if (
      node.nodeType === Node.ELEMENT_NODE &&
      ["DIV", "P"].includes((node as HTMLElement).tagName)
    ) {
      flushInline();
      const block = node as HTMLElement;
      const text = Array.from(block.childNodes)
        .map(serialize)
        .join("")
        .replace(/\n/g, "");
      lines.push({ text, align: lineAlignOf(block) });
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR") {
      flushInline();
      return;
    }
    inline.push(node);
  });
  flushInline();

  while (lines.length > 1 && lines[0].text === "") lines.shift();
  while (lines.length > 1 && lines[lines.length - 1].text === "") lines.pop();
  if (lines.length === 0) lines.push({ text: "", align: "left" });
  return {
    text: lines.map((line) => line.text).join("\n"),
    aligns: lines.map((line) => line.align),
  };
}

const markSelectors: Record<RichMark, string> = {
  emphasis: "strong, b, .kw",
  italic: "em, i",
  underline: "u",
  strike: "s, strike, del",
  overline: "span.overline",
  highlight: "mark",
};

function createMarkElement(mark: RichMark): HTMLElement {
  if (mark === "emphasis") {
    const element = document.createElement("strong");
    element.className = "kw";
    return element;
  }
  if (mark === "italic") return document.createElement("em");
  if (mark === "underline") return document.createElement("u");
  if (mark === "strike") return document.createElement("s");
  if (mark === "overline") {
    const element = document.createElement("span");
    element.className = "overline";
    return element;
  }
  return document.createElement("mark");
}

function sanitizeEditor(element: HTMLElement, keepLines = false) {
  element.querySelectorAll("*").forEach((node) => {
    const tag = node.tagName;
    if (tag === "B") {
      const strong = document.createElement("strong");
      strong.className = "kw";
      while (node.firstChild) strong.appendChild(node.firstChild);
      node.replaceWith(strong);
      return;
    }
    if (tag === "I") {
      const em = document.createElement("em");
      while (node.firstChild) em.appendChild(node.firstChild);
      node.replaceWith(em);
      return;
    }
    if (tag === "STRIKE" || tag === "DEL") {
      const strike = document.createElement("s");
      while (node.firstChild) strike.appendChild(node.firstChild);
      node.replaceWith(strike);
      return;
    }
    if (tag === "SPAN" && !node.classList.contains("overline")) {
      const parent = node.parentNode;
      if (!parent) return;
      while (node.firstChild) parent.insertBefore(node.firstChild, node);
      parent.removeChild(node);
      return;
    }
    if (tag === "FONT") {
      const parent = node.parentNode;
      if (!parent) return;
      while (node.firstChild) parent.insertBefore(node.firstChild, node);
      parent.removeChild(node);
      return;
    }
    if (!["STRONG", "EM", "U", "S", "MARK", "SPAN", "BR", "DIV", "P"].includes(tag)) {
      const parent = node.parentNode;
      if (!parent) return;
      while (node.firstChild) parent.insertBefore(node.firstChild, node);
      parent.removeChild(node);
      return;
    }
    Array.from(node.attributes).forEach((attribute) => {
      const keepLine =
        keepLines &&
        (tag === "DIV" || tag === "P") &&
        (attribute.name === "data-align" ||
          attribute.name === "style" ||
          attribute.name === "class");
      const keep =
        (attribute.name === "class" && (tag === "STRONG" || tag === "SPAN")) ||
        keepLine;
      if (!keep) node.removeAttribute(attribute.name);
    });
    if (tag === "STRONG") node.className = "kw";
    if (tag === "SPAN") node.className = "overline";
  });
}

function normalizeText(text: string) {
  return text
    .replace(/ /g, " ")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "")
    .replace(/\n{3,}/g, "\n\n");
}

function RichField({
  value,
  onChange,
  variant = "body",
  placeholder,
  align,
  onAlignChange,
  lineAligns,
  onLineAlignsChange,
  onFocus,
  textAlign,
}: {
  value: string;
  onChange: (value: string) => void;
  variant?: RichVariant;
  placeholder?: string;
  align?: "left" | "center";
  onAlignChange?: (align: "left" | "center") => void;
  lineAligns?: LineAlign[];
  onLineAlignsChange?: (aligns: LineAlign[]) => void;
  onFocus?: () => void;
  textAlign?: "left" | "center" | "right";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const theme = useContext(EditorThemeContext);
  const lineMode = Boolean(onLineAlignsChange);
  const [toolbar, setToolbar] = useState<{
    top: number;
    left: number;
    above: boolean;
  } | null>(null);

  const markEmpty = (element: HTMLDivElement) => {
    element.dataset.empty =
      (element.textContent ?? "").trim() === "" ? "true" : "false";
  };

  useEffect(() => {
    const element = ref.current;
    if (element && element.innerHTML === "") {
      element.innerHTML = lineMode ? toLineHtml(value, lineAligns) : toHtml(value);
      markEmpty(element);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element || document.activeElement === element) return;
    if (lineMode) {
      const current = serializeLineEditor(element);
      const expected = normalizeLineAligns(value, lineAligns);
      if (
        current.text !== value ||
        current.aligns.join("|") !== expected.join("|")
      ) {
        element.innerHTML = toLineHtml(value, lineAligns);
        markEmpty(element);
      }
    } else if (serialize(element) !== value) {
      element.innerHTML = toHtml(value);
      markEmpty(element);
    }
  }, [value, lineAligns, lineMode]);

  const sync = () => {
    const element = ref.current;
    const selection = window.getSelection();
    if (
      !element ||
      !selection ||
      selection.isCollapsed ||
      !selection.toString().trim() ||
      !element.contains(selection.anchorNode)
    ) {
      setToolbar(null);
      return;
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    const field = element.getBoundingClientRect();
    const toolbarHeight = 42;
    let above = true;
    let top: number;
    if (rect.top - toolbarHeight >= field.top) {
      top = rect.top - 8;
    } else if (field.top >= toolbarHeight) {
      top = field.top - 8;
    } else {
      above = false;
      top = rect.bottom + 8;
    }
    const toolbarWidth = 360;
    setToolbar({
      top,
      left: Math.min(
        window.innerWidth - 16 - toolbarWidth / 2,
        Math.max(16 + toolbarWidth / 2, rect.left + rect.width / 2),
      ),
      above,
    });
  };

  const emit = () => {
    const element = ref.current;
    if (!element) return;
    if (lineMode) {
      sanitizeEditor(element, true);
      markEmpty(element);
      const { text, aligns } = serializeLineEditor(element);
      const expected = normalizeLineAligns(value, lineAligns);
      if (text !== value || aligns.join("|") !== expected.join("|")) {
        onChange(text);
        onLineAlignsChange?.(aligns);
      }
      return;
    }
    sanitizeEditor(element);
    markEmpty(element);
    const text = normalizeText(serialize(element));
    if (text !== value) onChange(text);
  };

  const applyMark = (mark: RichMark) => {
    const element = ref.current;
    if (!element) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (range.collapsed || !element.contains(range.commonAncestorContainer)) return;

    const anchor =
      range.commonAncestorContainer.nodeType === Node.TEXT_NODE
        ? range.commonAncestorContainer.parentNode
        : range.commonAncestorContainer;
    const existing =
      (anchor as HTMLElement | null)?.closest?.(markSelectors[mark]) ?? null;

    if (existing && element.contains(existing)) {
      const parent = existing.parentNode;
      if (parent) {
        const firstChild = existing.firstChild;
        const lastChild = existing.lastChild;
        while (existing.firstChild) parent.insertBefore(existing.firstChild, existing);
        parent.removeChild(existing);
        if (firstChild && lastChild) {
          try {
            const nextRange = document.createRange();
            nextRange.setStartBefore(firstChild);
            nextRange.setEndAfter(lastChild);
            selection.removeAllRanges();
            selection.addRange(nextRange);
          } catch {
            selection.removeAllRanges();
          }
        }
      }
      emit();
      sync();
      return;
    }

    const startNode = range.startContainer;
    const startOffset = range.startOffset;
    const endNode = range.endContainer;
    const endOffset = range.endOffset;
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode() as Text | null;
    while (node) {
      if (range.intersectsNode(node)) textNodes.push(node);
      node = walker.nextNode() as Text | null;
    }

    const created: HTMLElement[] = [];
    for (let index = textNodes.length - 1; index >= 0; index -= 1) {
      const textNode = textNodes[index];
      if (textNode.parentElement?.closest(markSelectors[mark])) continue;
      const start =
        textNode === startNode && startNode.nodeType === Node.TEXT_NODE ? startOffset : 0;
      const end =
        textNode === endNode && endNode.nodeType === Node.TEXT_NODE
          ? endOffset
          : textNode.length;
      if (start >= end) continue;
      const wrapper = createMarkElement(mark);
      if (start === 0 && end === textNode.length) {
        textNode.parentNode?.replaceChild(wrapper, textNode);
        wrapper.appendChild(textNode);
      } else {
        if (end < textNode.length) textNode.splitText(end);
        const selected = start > 0 ? textNode.splitText(start) : textNode;
        selected.parentNode?.replaceChild(wrapper, selected);
        wrapper.appendChild(selected);
      }
      created.push(wrapper);
    }

    if (created.length === 1) {
      const nextRange = document.createRange();
      nextRange.selectNodeContents(created[0]);
      selection.removeAllRanges();
      selection.addRange(nextRange);
    } else if (created.length > 1) {
      const ordered = [...created].reverse();
      try {
        const nextRange = document.createRange();
        nextRange.setStartBefore(ordered[0]);
        nextRange.setEndAfter(ordered[ordered.length - 1]);
        selection.removeAllRanges();
        selection.addRange(nextRange);
      } catch {
        selection.removeAllRanges();
      }
    }
    emit();
    sync();
  };

  const applyLineAlign = (next: LineAlign) => {
    const element = ref.current;
    if (!element) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!element.contains(range.commonAncestorContainer)) return;
    const blocks = Array.from(element.children).filter((child) =>
      ["DIV", "P"].includes(child.tagName),
    ) as HTMLElement[];
    const targets = blocks.filter((block) => range.intersectsNode(block));
    if (targets.length === 0) {
      const anchor =
        range.commonAncestorContainer.nodeType === Node.TEXT_NODE
          ? range.commonAncestorContainer.parentElement
          : (range.commonAncestorContainer as HTMLElement);
      let line = anchor;
      while (line && line.parentElement !== element) line = line.parentElement;
      if (line && (line.tagName === "DIV" || line.tagName === "P")) {
        targets.push(line);
      }
    }
    targets.forEach((block) => {
      block.dataset.align = next;
      block.style.textAlign = next;
    });
    emit();
    sync();
  };

  return (
    <div className="rich-field">
      <div
        ref={ref}
        className={variantClass[variant]}
        style={
          textAlign
            ? { textAlign }
            : align
              ? { textAlign: align }
              : undefined
        }
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder}
        onFocus={onFocus}
        onInput={() => {
          if (!composingRef.current) emit();
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          emit();
          sync();
        }}
        onKeyUp={sync}
        onMouseUp={sync}
        onSelect={sync}
        onBlur={() => {
          setToolbar(null);
          const element = ref.current;
          if (!element) return;
          composingRef.current = false;
          emit();
          markEmpty(element);
        }}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
            event.preventDefault();
            applyMark("emphasis");
          }
        }}
      />
      {toolbar &&
        createPortal(
          <div
            className="selection-toolbar"
            role="toolbar"
            style={{
              ...themeVars(theme),
              top: toolbar.top,
              left: toolbar.left,
              transform: `translate(-50%, ${toolbar.above ? "-100%" : "0"})`,
            }}
            onMouseDown={(event) => event.preventDefault()}
          >
            <button
              className="format-emphasis"
              onClick={() => applyMark("emphasis")}
              title="重点 ⌘B"
            >
              <span className="bold-b">B</span>
              <span>重点</span>
            </button>
            <button
              className="format-btn format-i"
              onClick={() => applyMark("italic")}
              title="斜体"
            >
              I
            </button>
            <button
              className="format-btn format-u"
              onClick={() => applyMark("underline")}
              title="下划线"
            >
              U
            </button>
            <button
              className="format-btn format-s"
              onClick={() => applyMark("strike")}
              title="删除线"
            >
              S
            </button>
            <button
              className="format-btn format-o"
              onClick={() => applyMark("overline")}
              title="上划线"
            >
              O
            </button>
            <button
              className="format-btn format-h"
              onClick={() => applyMark("highlight")}
              title="高亮"
            >
              H
            </button>
            {onLineAlignsChange && (
              <>
                <button
                  className="format-center"
                  onClick={() => applyLineAlign("left")}
                  title="选中行左对齐"
                >
                  左
                </button>
                <button
                  className="format-center"
                  onClick={() => applyLineAlign("center")}
                  title="选中行居中"
                >
                  中
                </button>
              </>
            )}
            {onAlignChange && (
              <button
                className={`format-center ${align === "center" ? "active" : ""}`}
                onClick={() => onAlignChange(align === "center" ? "left" : "center")}
                title="整块居中"
              >
                居中
              </button>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

function LayoutControls({
  scale,
  offsetX,
  offsetY,
  scaleLabel = "大小",
  onChange,
}: {
  scale: number;
  offsetX: number;
  offsetY: number;
  scaleLabel?: string;
  onChange: (patch: { scale?: number; offsetX?: number; offsetY?: number }) => void;
}) {
  return (
    <div className="layout-controls">
      <label>
        {scaleLabel}
        <input
          type="range"
          min="0.4"
          max="1.6"
          step="0.05"
          value={scale}
          onChange={(event) => onChange({ scale: Number(event.target.value) })}
        />
        <span>{Math.round(scale * 100)}%</span>
      </label>
      <label>
        横向
        <input
          type="range"
          min="-300"
          max="300"
          step="1"
          value={offsetX}
          onChange={(event) => onChange({ offsetX: Number(event.target.value) })}
        />
      </label>
      <label>
        纵向
        <input
          type="range"
          min="-200"
          max="200"
          step="1"
          value={offsetY}
          onChange={(event) => onChange({ offsetY: Number(event.target.value) })}
        />
      </label>
      <button
        className="mini-btn"
        onClick={() => onChange({ scale: 1, offsetX: 0, offsetY: 0 })}
      >
        重置
      </button>
    </div>
  );
}

function PositionControls({
  offsetX,
  offsetY,
  onChange,
}: {
  offsetX: number;
  offsetY: number;
  onChange: (patch: { offsetX?: number; offsetY?: number }) => void;
}) {
  return (
    <div className="layout-controls position-controls">
      <label>
        横向位置
        <input
          type="range"
          min="-300"
          max="300"
          step="1"
          value={offsetX}
          onChange={(event) => onChange({ offsetX: Number(event.target.value) })}
        />
        <span>{offsetX}</span>
      </label>
      <label>
        纵向位置
        <input
          type="range"
          min="-200"
          max="200"
          step="1"
          value={offsetY}
          onChange={(event) => onChange({ offsetY: Number(event.target.value) })}
        />
        <span>{offsetY}</span>
      </label>
      <button
        className="mini-btn"
        onClick={() => onChange({ offsetX: 0, offsetY: 0 })}
      >
        重置位置
      </button>
      <span className="position-hint">也可以在右侧预览里直接拖动</span>
    </div>
  );
}

function textOrdinal(project: Project, blockId: string, kind: Block["kind"]): number {
  if (kind === "group") return 0;
  let count = 0;
  for (const section of project.sections) {
    for (const slide of section.slides) {
      for (const block of orderedBlocks(slide)) {
        const visible = blockHasVisibleContent(block);
        if (visible && block.kind === kind) count += 1;
        if (block.id === blockId) return visible ? count : 0;
      }
    }
  }
  return count;
}

function lineAlignsOf(text: string, aligns?: LineAlign[]): LineAlign[] {
  return Array.from({ length: Math.max(1, text.split("\n").length) }, (_, index) =>
    aligns?.[index] ?? "left",
  );
}

function parseClipboard(text: string) {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const delimiter = lines.some((line) => line.includes("\t")) ? "\t" : ",";
  const cells = lines.map((line) =>
    line.split(delimiter).map((cell) => cell.trim().replace(/^"(.*)"$/, "$1")),
  );
  return { header: cells[0] ?? [], rows: cells.slice(1) };
}

export function Editor({
  project,
  projectPath,
  assetUrls,
  projects,
  onSwitchProject,
  onChange,
  onBack,
  onToast,
  onImportAsset,
}: EditorProps) {
  const allSlides = useMemo(
    () => project.sections.flatMap((section) => section.slides),
    [project.sections],
  );
  const [selectedId, setSelectedId] = useState<string>(
    () => project.sections[0]?.slides[0]?.id ?? "toc",
  );
  const [selectedSectionId, setSelectedSectionId] = useState<string>(
    () => project.sections[0]?.id ?? "",
  );
  const [exportOpen, setExportOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [chapterModal, setChapterModal] = useState<{
    mode: "add" | "rename";
    sectionId?: string;
    value: string;
  } | null>(null);
  const [pasteModal, setPasteModal] = useState<{ blockId: string; value: string } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    message: string;
    action: () => void;
  } | null>(null);
  const [pendingFigureId, setPendingFigureId] = useState<string | null>(null);
  const [tableFocus, setTableFocus] = useState<{ tableId: string; column: number }>({
    tableId: "",
    column: 0,
  });
  useEffect(() => {
    setTableFocus({ tableId: "", column: 0 });
  }, [selectedId]);
  const [slideDrag, setSlideDrag] = useState<{
    id: string;
    title: string;
    x: number;
    y: number;
    active: boolean;
  } | null>(null);
  const [slideDrop, setSlideDrop] = useState<{
    sectionId: string;
    index: number;
    kind: "slide" | "section";
  } | null>(null);
  const [blockDrag, setBlockDrag] = useState<{
    id: string;
    title: string;
    x: number;
    y: number;
    active: boolean;
  } | null>(null);
  const [blockDrop, setBlockDrop] = useState<{
    pane: number;
    index: number;
  } | null>(null);
  const [pdf, setPdf] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [compileMs, setCompileMs] = useState<number | null>(null);
  const [compileWarnings, setCompileWarnings] = useState(0);
  const [dirty, setDirty] = useState(true);
  const [layoutPreview, setLayoutPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{
    id: string;
    title: string;
    sectionId: string;
    index: number;
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const dropRef = useRef<{
    sectionId: string;
    index: number;
    kind: "slide" | "section";
  } | null>(null);
  const blockDragRef = useRef<{
    id: string;
    title: string;
    pane: number;
    index: number;
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const blockDropRef = useRef<{ pane: number; index: number } | null>(null);
  const suppressSlideClick = useRef(false);
  const sectionClickTimer = useRef<number | null>(null);
  const compileJob = useRef(0);
  const compilingRef = useRef(false);
  const latestDeck = useRef<GeneratedDeck | null>(null);
  const projectRef = useRef(project);
  const pdfRef = useRef<string | null>(null);
  projectRef.current = project;

  const applyProject = (next: Project) => {
    projectRef.current = next;
    onChange(next);
  };

  const total = allSlides.length;
  const pageMap = useMemo(() => {
    const map = new Map<string, number>();
    allSlides.forEach((slide, index) => map.set(slide.id, index + 1));
    return map;
  }, [allSlides]);

  const compileNow = async (): Promise<string | null> => {
    if (!isDesktop || compilingRef.current) return null;
    compilingRef.current = true;
    const job = compileJob.current + 1;
    compileJob.current = job;
    const snapshot = projectRef.current;
    setCompiling(true);
    setCompileError(null);
    try {
      const result = await compileProject(snapshot, projectPath);
      if (compileJob.current !== job) return null;
      latestDeck.current = result.deck;
      pdfRef.current = result.pdf;
      setPdf(result.pdf);
      setCompileMs(result.duration);
      setCompileWarnings(
        result.issues.filter((issue) => issue.severity === "warning").length,
      );
      setDirty(projectRef.current !== snapshot);
      return result.pdf;
    } catch (error) {
      if (compileJob.current !== job) return null;
      const deck = error instanceof CompileError ? error.deck : undefined;
      setCompileError(
        describeCompileError(error, snapshot, deck ?? latestDeck.current),
      );
      return null;
    } finally {
      if (compileJob.current === job) {
        compilingRef.current = false;
        setCompiling(false);
      }
    }
  };

  useEffect(() => {
    setPdf(null);
    pdfRef.current = null;
    setCompileError(null);
    setCompileMs(null);
    setDirty(true);
    latestDeck.current = null;
    if (isDesktop) void compileNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.altKey) return;
      if (event.key !== "Control" && event.key !== "Alt") return;
      if (event.repeat) return;
      event.preventDefault();
      void compileNow();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath]);

  const autoCompileReady = useRef(false);
  useEffect(() => {
    setDirty(true);
    if (!isDesktop) return;
    if (!autoCompileReady.current) {
      autoCompileReady.current = true;
      return;
    }
    let cancelled = false;
    let timer = window.setTimeout(() => {
      const attempt = () => {
        if (cancelled) return;
        if (compilingRef.current) {
          timer = window.setTimeout(attempt, 400);
          return;
        }
        void compileNow();
      };
      attempt();
    }, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  const selectedSlide = allSlides.find((item) => item.id === selectedId) ?? null;
  const pageKind =
    selectedId === "cover"
      ? "cover"
      : selectedId === "toc"
        ? "toc"
        : selectedId === "ending"
          ? "ending"
          : "content";
  const currentPage = pageMap.get(selectedId) ?? 0;
  const activeSection = project.sections.find((section) =>
    section.slides.some((item) => item.id === selectedId),
  );

  const cancelSectionTimer = () => {
    if (sectionClickTimer.current) {
      window.clearTimeout(sectionClickTimer.current);
      sectionClickTimer.current = null;
    }
  };

  const selectSlide = (id: string, sectionId?: string) => {
    cancelSectionTimer();
    setSelectedId(id);
    const section = sectionId
      ? project.sections.find((item) => item.id === sectionId)
      : project.sections.find((item) => item.slides.some((slide) => slide.id === id));
    if (section) setSelectedSectionId(section.id);
  };

  const updateCover = (patch: Partial<Cover>) => {
    onChange({ ...project, cover: { ...project.cover, ...patch } });
  };

  const updateCoverField = (id: string, patch: Partial<CoverField>) => {
    updateCover({
      fields: project.cover.fields.map((field) =>
        field.id === id ? { ...field, ...patch } : field,
      ),
    });
  };

  const addCoverField = () => {
    updateCover({
      fields: [
        ...project.cover.fields,
        { id: uid("cover"), label: "新字段", value: "", size: "md", showLabel: false },
      ],
    });
  };

  const removeCoverField = (id: string) => {
    updateCover({ fields: project.cover.fields.filter((field) => field.id !== id) });
  };

  const moveCoverField = (index: number, direction: number) => {
    const fields = [...project.cover.fields];
    const target = index + direction;
    if (target < 0 || target >= fields.length) return;
    [fields[index], fields[target]] = [fields[target], fields[index]];
    updateCover({ fields });
  };

  const updateSlide = (id: string, patch: Partial<Slide>) => {
    const current = projectRef.current;
    applyProject({
      ...current,
      sections: current.sections.map((section) => ({
        ...section,
        slides: section.slides.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      })),
    });
  };

  const updateSlideWith = (
    id: string,
    update: (slide: Slide) => Partial<Slide>,
  ) => {
    const current = projectRef.current;
    applyProject({
      ...current,
      sections: current.sections.map((section) => ({
        ...section,
        slides: section.slides.map((slide) =>
          slide.id === id ? { ...slide, ...update(slide) } : slide,
        ),
      })),
    });
  };

  type BlockPatch =
    | Record<string, unknown>
    | ((block: Block) => Record<string, unknown>);

  const updateBlockAnywhere = (blockId: string, patch: BlockPatch) => {
    const current = projectRef.current;
    applyProject({
      ...current,
      sections: current.sections.map((section) => ({
        ...section,
        slides: section.slides.map((slide) => ({
          ...slide,
          blocks: slide.blocks.map((block) => {
            if (block.id !== blockId) return block;
            const resolved = typeof patch === "function" ? patch(block) : patch;
            return { ...block, ...resolved } as Block;
          }),
        })),
      })),
    });
  };

  const updateSectionTitle = (sectionId: string, title: string) => {
    onChange({
      ...project,
      sections: project.sections.map((section) =>
        section.id === sectionId ? { ...section, title } : section,
      ),
    });
  };

  const addSection = (title: string) => {
    const section = makeSection(title, [
      makeSlide("第一页", [makeBulletsBlock(["在这里写第一条要点。"])]),
    ]);
    onChange({ ...project, sections: [...project.sections, section] });
    setSelectedSectionId(section.id);
    setSelectedId(section.slides[0].id);
    setChapterModal(null);
  };

  const addSlide = (sectionId?: string) => {
    const targetId =
      sectionId ??
      selectedSectionId ??
      activeSection?.id ??
      project.sections[project.sections.length - 1]?.id;
    if (!targetId) {
      addSection("第一部分");
      return;
    }
    const slide = makeSlide("新页面", [makeBulletsBlock(["在这里写第一条要点。"])]);
    onChange({
      ...project,
      sections: project.sections.map((section) =>
        section.id === targetId ? { ...section, slides: [...section.slides, slide] } : section,
      ),
    });
    setSelectedSectionId(targetId);
    setSelectedId(slide.id);
    setAddMenuOpen(false);
  };

  const deleteSlide = (id: string) => {
    setConfirmDialog({
      message: "删除这一页？",
      action: () => {
        const index = allSlides.findIndex((item) => item.id === id);
        onChange({
          ...project,
          sections: project.sections.map((section) => ({
            ...section,
            slides: section.slides.filter((item) => item.id !== id),
          })),
        });
        const next = allSlides[index + 1] ?? allSlides[index - 1];
        if (next) {
          selectSlide(next.id);
        } else {
          goTo("toc");
        }
      },
    });
  };

  const deleteSection = (sectionId: string) => {
    const section = project.sections.find((item) => item.id === sectionId);
    if (!section) return;
    const count = section.slides.length;
    const message =
      count > 0
        ? `删除章节“${section.title}”及其 ${count} 页？`
        : `删除章节“${section.title}”？`;
    setConfirmDialog({
      message,
      action: () => {
        const index = project.sections.findIndex((item) => item.id === sectionId);
        const remaining = project.sections.filter((item) => item.id !== sectionId);
        onChange({ ...project, sections: remaining });
        if (selectedSectionId === sectionId) {
          setSelectedSectionId(remaining[Math.min(index, remaining.length - 1)]?.id ?? "");
        }
        if (selectedId === "cover" || selectedId === "toc") {
          setSelectedSectionId("");
        }
        if (section.slides.some((slide) => slide.id === selectedId)) {
          const next = remaining[index]?.slides[0] ?? remaining[index - 1]?.slides[0];
          if (next) {
            selectSlide(next.id);
          } else {
            goTo("toc");
          }
        }
      },
    });
  };

  const moveSlide = (slideId: string, targetSectionId: string, targetIndex: number) => {
    const sourceSection = project.sections.find((section) =>
      section.slides.some((slide) => slide.id === slideId),
    );
    if (!sourceSection) return;
    const sourceIndex = sourceSection.slides.findIndex((slide) => slide.id === slideId);
    const slide = sourceSection.slides[sourceIndex];
    if (!slide) return;
    let insertAt = targetIndex;
    if (sourceSection.id === targetSectionId && sourceIndex < targetIndex) insertAt -= 1;
    const sections = project.sections.map((section) => {
      let slides = section.slides;
      if (section.id === sourceSection.id) {
        slides = slides.filter((item) => item.id !== slideId);
      }
      if (section.id === targetSectionId) {
        const at = Math.max(0, Math.min(insertAt, slides.length));
        slides = [...slides.slice(0, at), slide, ...slides.slice(at)];
      }
      return { ...section, slides };
    });
    onChange({ ...project, sections });
    setSelectedId(slideId);
    setSelectedSectionId(targetSectionId);
  };

  useEffect(() => {
    if (!slideDrag?.id) return;
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (!drag.active && distance < 6) return;
      event.preventDefault();
      drag.active = true;
      suppressSlideClick.current = true;
      setSlideDrag({
        id: drag.id,
        title: drag.title,
        x: event.clientX,
        y: event.clientY,
        active: true,
      });
      const target = document.elementFromPoint(event.clientX, event.clientY);
      const drop = target?.closest<HTMLElement>("[data-slide-drop]");
      if (drop?.dataset.sectionId) {
        const kind = drop.dataset.slideDrop === "section" ? "section" : "slide";
        const next = {
          sectionId: drop.dataset.sectionId,
          index:
            kind === "section"
              ? Number(drop.dataset.slideCount ?? "0")
              : Number(drop.dataset.index ?? "0"),
          kind,
        } as const;
        dropRef.current = next;
        setSlideDrop(next);
      } else {
        dropRef.current = null;
        setSlideDrop(null);
      }
      const rail = document.querySelector(".rail-sections");
      if (rail) {
        const rect = rail.getBoundingClientRect();
        if (event.clientY < rect.top + 28) rail.scrollTop -= 8;
        if (event.clientY > rect.bottom - 28) rail.scrollTop += 8;
      }
    };
    const finish = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (drag.active) {
        suppressSlideClick.current = true;
        const drop = dropRef.current;
        if (drop) {
          let index = drop.index;
          if (
            drop.kind === "slide" &&
            drop.sectionId === drag.sectionId &&
            drag.index <= index
          ) {
            index += 1;
          }
          moveSlide(drag.id, drop.sectionId, index);
        }
      }
      dragRef.current = null;
      dropRef.current = null;
      setSlideDrag(null);
      setSlideDrop(null);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideDrag?.id]);

  const changeSlideLayout = (layout: SlideLayout) => {
    if (!selectedSlide) return;
    let merged = false;
    updateSlideWith(selectedSlide.id, (slide) => {
      const result = relayoutSlide(slide, layout);
      if (result.slide === slide) return {};
      merged = result.merged;
      return { layout: result.slide.layout, blocks: result.slide.blocks };
    });
    if (merged) onToast("版面已调整，内容已合并");
  };

  const addBlock = (kind: BlockKind, pane = 0) => {
    if (!selectedSlide) return;
    const block = makeBlock(kind, pane);
    if (block.kind === "bullets") {
      block.title = "";
    }
    updateSlideWith(selectedSlide.id, (slide) => ({
      blocks: [...slide.blocks, block],
    }));
  };

  const moveBlock = (blockId: string, direction: number) => {
    if (!selectedSlide) return;
    updateSlideWith(selectedSlide.id, (slide) => {
      const groups = paneBlocks(slide).map((group) => [...group]);
      const paneIndex = groups.findIndex((group) =>
        group.some((block) => block.id === blockId),
      );
      if (paneIndex < 0) return {};
      const index = groups[paneIndex].findIndex((block) => block.id === blockId);
      const target = index + direction;
      if (target < 0 || target >= groups[paneIndex].length) return {};
      [groups[paneIndex][index], groups[paneIndex][target]] = [
        groups[paneIndex][target],
        groups[paneIndex][index],
      ];
      return { blocks: groups.flat() };
    });
  };

  const moveBlockTo = (blockId: string, targetPane: number, targetIndex: number) => {
    if (!selectedSlide) return;
    updateSlideWith(selectedSlide.id, (slide) => {
      const groups = paneBlocks(slide).map((group) => [...group]);
      if (!groups[targetPane]) return {};
      const sourcePane = groups.findIndex((group) =>
        group.some((block) => block.id === blockId),
      );
      if (sourcePane < 0) return {};
      const sourceIndex = groups[sourcePane].findIndex((block) => block.id === blockId);
      const [block] = groups[sourcePane].splice(sourceIndex, 1);
      let index = targetIndex;
      if (sourcePane === targetPane && sourceIndex < index) index -= 1;
      index = Math.max(0, Math.min(index, groups[targetPane].length));
      groups[targetPane].splice(index, 0, { ...block, pane: targetPane });
      return { blocks: groups.flat() };
    });
  };

  const startBlockDrag = (
    event: ReactPointerEvent<HTMLElement>,
    block: Block,
    pane: number,
    index: number,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const title = blockKindLabel[block.kind];
    blockDragRef.current = {
      id: block.id,
      title,
      pane,
      index,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
    setBlockDrag({
      id: block.id,
      title,
      x: event.clientX,
      y: event.clientY,
      active: false,
    });
  };

  useEffect(() => {
    if (!blockDrag?.id) return;
    const onMove = (event: PointerEvent) => {
      const drag = blockDragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (!drag.active && distance < 6) return;
      event.preventDefault();
      drag.active = true;
      setBlockDrag({
        id: drag.id,
        title: drag.title,
        x: event.clientX,
        y: event.clientY,
        active: true,
      });
      const target = document.elementFromPoint(event.clientX, event.clientY);
      const paneEl = target?.closest<HTMLElement>("[data-block-pane]");
      if (!paneEl || !selectedSlide) {
        blockDropRef.current = null;
        setBlockDrop(null);
        return;
      }
      const pane = Number(paneEl.dataset.blockPane);
      const group = paneBlocks(selectedSlide)[pane] ?? [];
      const card = target?.closest<HTMLElement>("[data-block-id]");
      let index = group.length;
      if (card && paneEl.contains(card)) {
        const cardIndex = Number(card.dataset.blockIndex ?? "0");
        const rect = card.getBoundingClientRect();
        index = event.clientY > rect.top + rect.height / 2 ? cardIndex + 1 : cardIndex;
      }
      const next = { pane, index };
      blockDropRef.current = next;
      setBlockDrop(next);
      const form = document.querySelector<HTMLElement>(".form");
      if (form) {
        const rect = form.getBoundingClientRect();
        if (event.clientY < rect.top + 36) form.scrollTop -= 8;
        if (event.clientY > rect.bottom - 36) form.scrollTop += 8;
      }
    };
    const finish = (event: PointerEvent) => {
      const drag = blockDragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (drag.active) {
        const drop = blockDropRef.current;
        if (drop) moveBlockTo(drag.id, drop.pane, drop.index);
      }
      blockDragRef.current = null;
      blockDropRef.current = null;
      setBlockDrag(null);
      setBlockDrop(null);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockDrag?.id, selectedSlide?.id]);

  const removeBlock = (blockId: string) => {
    if (!selectedSlide) return;
    setConfirmDialog({
      message: "删除这个内容块？",
      action: () => {
        updateSlideWith(selectedSlide.id, (slide) => ({
          blocks: slide.blocks.filter((block) => block.id !== blockId),
        }));
      },
    });
  };

  const addBulletItem = (block: BulletsBlock) => {
    updateBlockAnywhere(block.id, (current) => {
      const bullets = current as BulletsBlock;
      return { items: [...bullets.items, makeBulletItem("")] };
    });
  };

  const updateBulletItem = (block: BulletsBlock, itemId: string, patch: Partial<BulletItem>) => {
    updateBlockAnywhere(block.id, (current) => {
      const bullets = current as BulletsBlock;
      return {
        items: bullets.items.map((item) =>
          item.id === itemId ? { ...item, ...patch } : item,
        ),
      };
    });
  };

  const removeBulletItem = (block: BulletsBlock, itemId: string) => {
    updateBlockAnywhere(block.id, (current) => {
      const bullets = current as BulletsBlock;
      return { items: bullets.items.filter((item) => item.id !== itemId) };
    });
  };

  const addBulletNote = (block: BulletsBlock, itemId: string) => {
    updateBlockAnywhere(block.id, (current) => {
      const bullets = current as BulletsBlock;
      return {
        items: bullets.items.map((item) =>
          item.id === itemId
            ? {
                ...item,
                notes: [...item.notes, ""],
                noteAligns: [...(item.noteAligns ?? []), ["left"]],
              }
            : item,
        ),
      };
    });
  };

  const updateBulletNote = (
    block: BulletsBlock,
    itemId: string,
    noteIndex: number,
    value: string,
  ) => {
    updateBlockAnywhere(block.id, (current) => {
      const bullets = current as BulletsBlock;
      return {
        items: bullets.items.map((item) =>
          item.id === itemId
            ? {
                ...item,
                notes: item.notes.map((note, index) =>
                  index === noteIndex ? value : note,
                ),
              }
            : item,
        ),
      };
    });
  };

  const removeBulletNote = (block: BulletsBlock, itemId: string, noteIndex: number) => {
    updateBlockAnywhere(block.id, (current) => {
      const bullets = current as BulletsBlock;
      return {
        items: bullets.items.map((item) =>
          item.id === itemId
            ? {
                ...item,
                notes: item.notes.filter((_, index) => index !== noteIndex),
                noteAligns: (item.noteAligns ?? []).filter((_, index) => index !== noteIndex),
              }
            : item,
        ),
      };
    });
  };

  const updateBulletNoteAligns = (
    block: BulletsBlock,
    itemId: string,
    noteIndex: number,
    aligns: LineAlign[],
  ) => {
    updateBlockAnywhere(block.id, (current) => {
      const bullets = current as BulletsBlock;
      return {
        items: bullets.items.map((item) => {
          if (item.id !== itemId) return item;
          const noteAligns = item.notes.map((note, index) =>
            index === noteIndex ? aligns : item.noteAligns?.[index] ?? ["left"],
          );
          return { ...item, noteAligns };
        }),
      };
    });
  };

  const addReferenceItem = (block: ReferencesBlock) => {
    updateBlockAnywhere(block.id, (current) => {
      const refs = current as ReferencesBlock;
      return { items: [...refs.items, ""] };
    });
  };

  const updateReferenceItem = (
    block: ReferencesBlock,
    index: number,
    value: string,
  ) => {
    updateBlockAnywhere(block.id, (current) => {
      const refs = current as ReferencesBlock;
      return {
        items: refs.items.map((item, itemIndex) =>
          itemIndex === index ? value : item,
        ),
      };
    });
  };

  const removeReferenceItem = (block: ReferencesBlock, index: number) => {
    updateBlockAnywhere(block.id, (current) => {
      const refs = current as ReferencesBlock;
      return { items: refs.items.filter((_, itemIndex) => itemIndex !== index) };
    });
  };

  const addFootnote = () => {
    if (!selectedSlide) return;
    updateSlideWith(selectedSlide.id, (slide) => ({
      footnotes: [...(slide.footnotes ?? []), ""],
    }));
  };

  const updateFootnote = (index: number, value: string) => {
    if (!selectedSlide) return;
    updateSlideWith(selectedSlide.id, (slide) => ({
      footnotes: (slide.footnotes ?? []).map((note, noteIndex) =>
        noteIndex === index ? value : note,
      ),
    }));
  };

  const removeFootnote = (index: number) => {
    if (!selectedSlide) return;
    updateSlideWith(selectedSlide.id, (slide) => {
      const next = (slide.footnotes ?? []).filter(
        (_, noteIndex) => noteIndex !== index,
      );
      return { footnotes: next.length > 0 ? next : undefined };
    });
  };

  const addTableRow = (block: TableBlock) => {
    updateBlockAnywhere(block.id, (current) => {
      const table = current as TableBlock;
      return { rows: [...table.rows, table.header.map(() => "")] };
    });
  };

  const removeTableRow = (block: TableBlock, index: number) => {
    updateBlockAnywhere(block.id, (current) => {
      const table = current as TableBlock;
      return { rows: table.rows.filter((_, i) => i !== index) };
    });
  };

  const addTableColumn = (block: TableBlock) => {
    updateBlockAnywhere(block.id, (current) => {
      const table = current as TableBlock;
      const aligns = table.aligns ?? table.header.map(() => "center" as const);
      return {
        header: [...table.header, `列 ${table.header.length + 1}`],
        rows: table.rows.map((row) => [...row, ""]),
        aligns: [...aligns, "center"],
      };
    });
  };

  const removeTableColumn = (block: TableBlock, index: number) => {
    updateBlockAnywhere(block.id, (current) => {
      const table = current as TableBlock;
      if (table.header.length <= 1) return {};
      const aligns = table.aligns ?? table.header.map(() => "center" as const);
      return {
        header: table.header.filter((_, i) => i !== index),
        rows: table.rows.map((row) => row.filter((_, i) => i !== index)),
        aligns: aligns.filter((_, i) => i !== index),
      };
    });
  };

  const updateTableCell = (
    block: TableBlock,
    rowIndex: number,
    colIndex: number,
    value: string,
  ) => {
    updateBlockAnywhere(block.id, (current) => {
      const table = current as TableBlock;
      return {
        rows: table.rows.map((row, ri) =>
          ri === rowIndex ? row.map((cell, ci) => (ci === colIndex ? value : cell)) : row,
        ),
      };
    });
  };

  const updateTableHeader = (block: TableBlock, colIndex: number, value: string) => {
    updateBlockAnywhere(block.id, (current) => {
      const table = current as TableBlock;
      return {
        header: table.header.map((cell, ci) => (ci === colIndex ? value : cell)),
      };
    });
  };

  const loadFigure = async (blockId: string, file: File | undefined) => {
    if (!file) return;
    try {
      const src = await onImportAsset(file);
      updateBlockAnywhere(blockId, { src });
    } catch (error) {
      onToast(error instanceof Error ? error.message : "图片导入失败");
    }
  };

  const pickFigure = (blockId: string) => {
    setPendingFigureId(blockId);
    fileInputRef.current?.click();
  };

  const onFigureFile = (file: File | undefined) => {
    if (!file || !pendingFigureId) return;
    void loadFigure(pendingFigureId, file);
    setPendingFigureId(null);
  };

  const openAddChapter = () => setChapterModal({ mode: "add", value: "" });
  const openRenameChapter = (section: Section) =>
    setChapterModal({ mode: "rename", sectionId: section.id, value: section.title });

  const submitChapter = () => {
    if (!chapterModal || !chapterModal.value.trim()) return;
    if (chapterModal.mode === "add") {
      addSection(chapterModal.value.trim());
    } else if (chapterModal.sectionId) {
      updateSectionTitle(chapterModal.sectionId, chapterModal.value.trim());
      setChapterModal(null);
    }
  };

  const handleSectionClick = (section: Section) => {
    if (sectionClickTimer.current) window.clearTimeout(sectionClickTimer.current);
    sectionClickTimer.current = window.setTimeout(() => {
      sectionClickTimer.current = null;
      setSelectedSectionId(section.id);
      if (section.slides[0]) {
        selectSlide(section.slides[0].id, section.id);
      } else {
        onToast("这个章节还没有幻灯片，点右侧加号添加");
      }
    }, 240);
  };

  const handleSectionDoubleClick = (section: Section) => {
    if (sectionClickTimer.current) {
      window.clearTimeout(sectionClickTimer.current);
      sectionClickTimer.current = null;
    }
    openRenameChapter(section);
  };

  const submitPaste = () => {
    if (!pasteModal) return;
    const { header, rows } = parseClipboard(pasteModal.value);
    if (header.length > 0) {
      const normalized = rows.map((row) =>
        Array.from({ length: header.length }, (_, index) => row[index] ?? ""),
      );
      const existing = allSlides
        .flatMap((slide) => slide.blocks)
        .find((block): block is TableBlock => block.id === pasteModal.blockId && block.kind === "table");
      const currentAligns =
        existing?.aligns ?? existing?.header.map(() => "center" as const) ?? [];
      const aligns = header.map((_, index) => currentAligns[index] ?? "center");
      updateBlockAnywhere(pasteModal.blockId, { header, rows: normalized, aligns });
    }
    setPasteModal(null);
  };

  const pdfPage =
    pageKind === "cover"
      ? 1
      : pageKind === "toc"
        ? 2
        : pageKind === "ending"
          ? total + 3
          : (pageMap.get(selectedId) ?? 0) + 2;

  const ensureLayoutAllowed = async (): Promise<boolean> => {
    try {
      onToast("正在检查版面");
      const issues = await auditWebLayout(project, assetUrls);
      if (issues.length > 0) {
        const first = issues[0];
        onToast(
          `${first.sectionTitle} / “${first.slideTitle}”：${first.message}`,
        );
        return false;
      }
      return true;
    } catch (error) {
      onToast(error instanceof Error ? error.message : "版面检查失败");
      return false;
    }
  };

  const exportPdf = async () => {
    if (compiling) {
      onToast("编译中");
      return;
    }
    if (!(await ensureLayoutAllowed())) return;
    let data = pdfRef.current;
    if (isDesktop && (dirty || !data)) {
      data = await compileNow();
    }
    if (!data) {
      onToast(compileError ? "编译未通过" : "还没有可导出的 PDF");
      return;
    }
    try {
      const path = await saveExport(`${project.name}.pdf`, "PDF", "pdf", data);
      if (path) onToast("已导出到 下载/厦与珈导出");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "PDF 导出失败");
    }
  };

  const exportEdgePdf = async () => {
    if (compiling) {
      onToast("编译中");
      return;
    }
    if (!(await ensureLayoutAllowed())) return;
    let data = pdfRef.current;
    if (isDesktop && (dirty || !data)) {
      data = await compileNow();
    }
    if (!data) {
      onToast(compileError ? "编译未通过" : "还没有可导出的 PDF");
      return;
    }
    onToast("正在生成 Edge 放映版");
    try {
      const compatible = await makeEdgePresentationPdf(data, {
        topColor: paletteOf(project.theme).primary,
      });
      const path = await saveExport(
        `${project.name}-Edge放映.pdf`,
        "PDF",
        "pdf",
        compatible,
      );
      if (path) onToast("已导出到 下载/厦与珈导出");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Edge 放映版导出失败");
    }
  };

  const exportPptxFile = async () => {
    onToast("正在生成 PPTX");
    try {
      const base64 = await exportPptx(project, assetUrls);
      const path = await saveExport(
        `${project.name}.pptx`,
        "PowerPoint",
        "pptx",
        base64,
      );
      if (path) onToast("已导出到 下载/厦与珈导出");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "PPTX 导出失败");
    }
  };

  const exportLatexProject = async () => {
    if (!(await ensureLayoutAllowed())) return;
    if (isDesktop) {
      onToast("正在预编译版面");
      try {
        await compileProject(project, projectPath);
      } catch (error) {
        onToast(describeCompileError(error, project, latestDeck.current));
        return;
      }
    }
    onToast("正在打包 LaTeX 工程");
    try {
      const bundle = await buildLatexZip(project, projectPath);
      const path = await saveExport(bundle.fileName, "Zip", "zip", bundle.base64);
      if (path) onToast("已导出到 下载/厦与珈导出");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "LaTeX 工程导出失败");
    }
  };

  const exportAiPackageFile = async () => {
    onToast("正在打包 AI 材料");
    try {
      const bundle = await buildAiPackage(project, projectPath);
      const path = await saveExport(bundle.fileName, "Zip", "zip", bundle.base64);
      if (path) onToast("已导出到 下载/厦与珈导出");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "AI 包导出失败");
    }
  };

  const importYaml = async () => {
    try {
      const text = await pickYamlFile();
      if (!text) return;
      const parsed = yaml.load(text);
      const next = parseProject(parsed);
      if (next.id !== project.id) {
        throw new Error("内容 YAML 不属于当前项目");
      }
      onChange({ ...next, updated: new Date().toISOString() });
      onToast("已导入内容");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "导入内容失败");
    }
  };

  const order = ["cover", "toc", ...allSlides.map((item) => item.id), "ending"];
  const currentIndex = Math.max(0, order.indexOf(selectedId));
  const goTo = (id: string) => {
    cancelSectionTimer();
    setSelectedId(id);
    if (id === "cover" || id === "toc" || id === "ending") {
      setSelectedSectionId("");
    } else {
      const section = project.sections.find((item) =>
        item.slides.some((slide) => slide.id === id),
      );
      if (section) setSelectedSectionId(section.id);
    }
  };
  const goPrev = () => goTo(order[Math.max(0, currentIndex - 1)]);
  const goNext = () => goTo(order[Math.min(order.length - 1, currentIndex + 1)]);

  const renderBlockEditor = (block: Block) => {
    if (block.kind === "bullets") {
      return (
        <>
          <div className="field group-title-field">
            <label className="group-title-toggle">
              <input
                type="checkbox"
                checked={block.title !== undefined}
                onChange={(event) =>
                  updateBlockAnywhere(block.id, {
                    title: event.target.checked ? "" : undefined,
                  })
                }
              />
              显示组标题
            </label>
            {block.title !== undefined && (
              <RichField
                key={`${block.id}-group-title`}
                variant="groupTitle"
                value={block.title}
                placeholder="概括这一组要点的判断"
                onChange={(value) => updateBlockAnywhere(block.id, { title: value })}
              />
            )}
          </div>
          <div className="items">
            {block.items.map((item) => (
              <div className="bullet-item" key={item.id}>
                <div className="item-row">
                  <i className="item-dot" />
                  <RichField
                    key={`${item.id}-text`}
                    variant="compact"
                    value={item.text}
                    placeholder="输入要点内容"
                    lineAligns={lineAlignsOf(item.text, item.aligns)}
                    onLineAlignsChange={(next) =>
                      updateBulletItem(block, item.id, { aligns: next })
                    }
                    onChange={(value) => updateBulletItem(block, item.id, { text: value })}
                  />
                  <button
                    className="icon-btn item-remove"
                    onClick={() => removeBulletItem(block, item.id)}
                    aria-label="删除要点"
                  >
                    <Icon name="close" size={13} />
                  </button>
                </div>
                <div className="bullet-notes">
                  {item.notes.map((note, noteIndex) => (
                    <div className="bullet-note-row" key={noteIndex}>
                      <RichField
                        key={`${item.id}-note-${noteIndex}`}
                        variant="compact"
                        value={note}
                        placeholder="辅助说明"
                        lineAligns={lineAlignsOf(note, item.noteAligns?.[noteIndex])}
                        onLineAlignsChange={(next) =>
                          updateBulletNoteAligns(block, item.id, noteIndex, next)
                        }
                        onChange={(value) =>
                          updateBulletNote(block, item.id, noteIndex, value)
                        }
                      />
                      <button
                        className="icon-btn tiny"
                        onClick={() => removeBulletNote(block, item.id, noteIndex)}
                        aria-label="删除辅助说明"
                      >
                        <Icon name="close" size={12} />
                      </button>
                    </div>
                  ))}
                  <button
                    className="add-note"
                    onClick={() => addBulletNote(block, item.id)}
                  >
                    <Icon name="plus" size={12} />
                    辅助说明
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button className="add-item" onClick={() => addBulletItem(block)}>
            <Icon name="plus" size={13} />
            添加要点
          </button>
          <PositionControls
            offsetX={block.offsetX ?? 0}
            offsetY={block.offsetY ?? 0}
            onChange={(patch) => updateBlockAnywhere(block.id, patch)}
          />
        </>
      );
    }

    if (block.kind === "code") {
      return (
        <>
          <div className="field">
            <label className="field-label">代码块标题（可选）</label>
            <RichField
              variant="compact"
              value={block.title ?? ""}
              placeholder="例如：Python 示例"
              onChange={(value) => updateBlockAnywhere(block.id, { title: value })}
            />
          </div>
          <div className="field">
            <label className="field-label">代码</label>
            <textarea
              className="code-input"
              value={block.code}
              placeholder={"# 注释\nprint(\"hello\")"}
              spellCheck={false}
              onChange={(event) =>
                updateBlockAnywhere(block.id, { code: event.target.value })
              }
            />
          </div>
          <p className="code-hint">
            注释行以 #、//、%、-- 开头，预览和导出时显示为灰色。
          </p>
          <PositionControls
            offsetX={block.offsetX ?? 0}
            offsetY={block.offsetY ?? 0}
            onChange={(patch) => updateBlockAnywhere(block.id, patch)}
          />
        </>
      );
    }

    if (block.kind === "references") {
      return (
        <>
          <div className="field">
            <label className="field-label">文献块标题</label>
            <RichField
              variant="compact"
              value={block.title ?? ""}
              placeholder="参考文献"
              onChange={(value) => updateBlockAnywhere(block.id, { title: value })}
            />
          </div>
          <div className="reference-editor">
            {block.items.map((item, index) => (
              <div className="reference-editor-row" key={index}>
                <span className="reference-editor-index">{index + 1}</span>
                <RichField
                  variant="compact"
                  value={item}
                  placeholder="作者. (年份). 题名. 期刊."
                  onChange={(value) => updateReferenceItem(block, index, value)}
                />
                <button
                  className="icon-btn tiny"
                  onClick={() => removeReferenceItem(block, index)}
                  aria-label="删除文献"
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
            ))}
          </div>
          <button className="add-item" onClick={() => addReferenceItem(block)}>
            <Icon name="plus" size={12} />
            文献
          </button>
          <p className="code-hint">每条文献按 APA 写，预览里自动悬挂缩进。</p>
          <PositionControls
            offsetX={block.offsetX ?? 0}
            offsetY={block.offsetY ?? 0}
            onChange={(patch) => updateBlockAnywhere(block.id, patch)}
          />
        </>
      );
    }

    if (block.kind === "figure") {
      return (
        <div className="figure-editor">
          {block.src ? (
            <div className="figure-preview">
              <img
                src={assetUrls.get(block.src) ?? block.src}
                alt={plainText(block.caption)}
              />
              <div className="figure-actions">
                <button className="btn ghost small" onClick={() => pickFigure(block.id)}>
                  替换
                </button>
                <button
                  className="btn ghost small"
                  onClick={() => updateBlockAnywhere(block.id, { src: "" })}
                >
                  移除
                </button>
              </div>
            </div>
          ) : (
            <button
              className="figure-drop"
              onClick={() => pickFigure(block.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void loadFigure(block.id, event.dataTransfer.files?.[0]);
              }}
            >
              <Icon name="image" size={20} />
              <span>拖入图片或点击选择</span>
            </button>
          )}
          <div className="field">
            <label className="field-label">图注</label>
            <RichField
              variant="compact"
              value={block.caption}
              placeholder="说明"
              onChange={(value) => updateBlockAnywhere(block.id, { caption: value })}
            />
          </div>
          <LayoutControls
            scale={block.scale}
            offsetX={block.offsetX}
            offsetY={block.offsetY}
            onChange={(patch) => updateBlockAnywhere(block.id, patch)}
          />
        </div>
      );
    }

    if (block.kind === "table") {
      const aligns = block.aligns ?? block.header.map(() => "center" as const);
      const column = Math.min(
        tableFocus.tableId === block.id ? tableFocus.column : 0,
        Math.max(0, block.header.length - 1),
      );
      const activeAlign = aligns[column];
      const focusColumn = (colIndex: number) =>
        setTableFocus({ tableId: block.id, column: colIndex });
      const setTextAlign = (align: CellAlign) => {
        updateBlockAnywhere(block.id, {
          aligns: aligns.map((value, index) => (index === column ? align : value)),
        });
      };
      const setPlacement = (placement: CellAlign) => {
        updateBlockAnywhere(block.id, { placement, offsetX: 0 });
      };
      return (
        <div className="table-editor">
          <div className="field table-caption-field">
            <label className="field-label">表注</label>
            <RichField
              variant="compact"
              value={block.caption}
              placeholder="说明"
              onChange={(value) => updateBlockAnywhere(block.id, { caption: value })}
            />
          </div>
          <div className="table-align-row">
            <span className="field-label">文字对齐</span>
            {(["left", "center", "right"] as CellAlign[]).map((align) => (
              <button
                key={align}
                className={`table-align-btn ${activeAlign === align ? "active" : ""}`}
                onClick={() => setTextAlign(align)}
                title={`当前列${align === "left" ? "左" : align === "right" ? "右" : "中"}对齐`}
              >
                {align === "left" ? "左" : align === "right" ? "右" : "中"}
              </button>
            ))}
            <span className="table-column-label">第 {column + 1} 列</span>
          </div>
          <div className="table-align-row">
            <span className="field-label">整表位置</span>
            {(["left", "center", "right"] as CellAlign[]).map((align) => (
              <button
                key={align}
                className={`table-align-btn ${block.placement === align ? "active" : ""}`}
                onClick={() => setPlacement(align)}
                title={`整表${align === "left" ? "靠左" : align === "right" ? "靠右" : "居中"}`}
              >
                {align === "left" ? "左" : align === "right" ? "右" : "中"}
              </button>
            ))}
          </div>
          <div className="table-grid-wrap">
            <table className="table-grid">
              <thead>
                <tr>
                  {block.header.map((cell, colIndex) => (
                    <th key={colIndex}>
                      <RichField
                        variant="cell"
                        value={cell}
                        textAlign={aligns[colIndex] ?? "center"}
                        onFocus={() => focusColumn(colIndex)}
                        onChange={(value) => updateTableHeader(block, colIndex, value)}
                      />
                      <button
                        className="cell-remove"
                        onClick={() => removeTableColumn(block, colIndex)}
                        aria-label="删除列"
                      >
                        ×
                      </button>
                    </th>
                  ))}
                  <th className="row-actions-head" />
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, colIndex) => (
                      <td key={colIndex}>
                        <RichField
                          variant="cell"
                          value={cell}
                          textAlign={aligns[colIndex] ?? "center"}
                          onFocus={() => focusColumn(colIndex)}
                          onChange={(value) => updateTableCell(block, rowIndex, colIndex, value)}
                        />
                      </td>
                    ))}
                    <td className="row-actions">
                      <button
                        className="cell-remove"
                        onClick={() => removeTableRow(block, rowIndex)}
                        aria-label="删除行"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-tools">
            <button className="mini-btn" onClick={() => addTableRow(block)}>
              <Icon name="plus" size={12} />
              行
            </button>
            <button className="mini-btn" onClick={() => addTableColumn(block)}>
              <Icon name="plus" size={12} />
              列
            </button>
            <button
              className="mini-btn"
              onClick={() => setPasteModal({ blockId: block.id, value: "" })}
            >
              粘贴 Excel
            </button>
            <label className="check">
              <input
                type="checkbox"
                checked={block.firstColumnHeader}
                onChange={(event) =>
                  updateBlockAnywhere(block.id, { firstColumnHeader: event.target.checked })
                }
              />
              首列为行标题
            </label>
          </div>
          <LayoutControls
            scale={block.scale}
            offsetX={block.offsetX}
            offsetY={block.offsetY}
            scaleLabel="间距"
            onChange={(patch) => updateBlockAnywhere(block.id, patch)}
          />
        </div>
      );
    }

    return (
      <>
        <RichField
          key={block.id}
          value={block.body}
          placeholder="输入正文，选中文字后使用浮动工具栏"
          align={block.align ?? "left"}
          onAlignChange={(next) => updateBlockAnywhere(block.id, { align: next })}
          onChange={(value) => updateBlockAnywhere(block.id, { body: value })}
        />
        <PositionControls
          offsetX={block.offsetX ?? 0}
          offsetY={block.offsetY ?? 0}
          onChange={(patch) => updateBlockAnywhere(block.id, patch)}
        />
      </>
    );
  };

  const renderAddButtons = (pane: number) => (
    <div className="block-add-buttons">
      {BLOCK_KINDS.map((kind) => (
        <button key={kind} className="mini-btn" onClick={() => addBlock(kind, pane)}>
          <Icon name="plus" size={12} />
          {blockKindLabel[kind]}
        </button>
      ))}
    </div>
  );

  const renderBlockCard = (
    block: Block,
    index: number,
    paneIndex: number,
    paneLength: number,
  ) => (
    <div
      className={`block-card block-${block.kind}`}
      data-block-id={block.id}
      data-block-index={index}
    >
      <div
        className="block-card-head"
        onPointerDown={(event) => {
          const target = event.target as HTMLElement;
          if (target.closest("button, input, textarea, [contenteditable=true]")) return;
          startBlockDrag(event, block, paneIndex, index);
        }}
      >
        <button
          className="block-drag-handle"
          onPointerDown={(event) => startBlockDrag(event, block, paneIndex, index)}
          aria-label="拖动内容块"
          title="拖动内容块到其他版面"
        >
          <Icon name="grip" size={12} />
        </button>
        {block.kind === "definition" ||
        block.kind === "theorem" ||
        block.kind === "consensus" ||
        block.kind === "group" ? (
          <>
            <input
              className="block-label-input"
              value={block.label ?? ""}
              placeholder={blockKindLabel[block.kind]}
              onChange={(event) =>
                updateBlockAnywhere(block.id, {
                  label: event.target.value || undefined,
                })
              }
            />
            {textOrdinal(project, block.id, block.kind) > 0 && (
              <span className="block-ordinal">
                {textOrdinal(project, block.id, block.kind)}
              </span>
            )}
          </>
        ) : (
          <span className="block-kind">{blockKindLabel[block.kind]}</span>
        )}
        <div className="block-actions">
          {paneLength === 1 && (
            <button
              className={`icon-btn tiny ${block.centered ? "active" : ""}`}
              onClick={() =>
                updateBlockAnywhere(block.id, { centered: !block.centered })
              }
              aria-label="在本版面居中"
              title="在本版面垂直居中"
            >
              <Icon name="center" size={13} />
            </button>
          )}
          <button
            className="icon-btn tiny"
            disabled={index === 0}
            onClick={() => moveBlock(block.id, -1)}
            aria-label="上移内容块"
          >
            <Icon name="up" size={13} />
          </button>
          <button
            className="icon-btn tiny"
            disabled={index === paneLength - 1}
            onClick={() => moveBlock(block.id, 1)}
            aria-label="下移内容块"
          >
            <Icon name="down" size={13} />
          </button>
          <button
            className="icon-btn tiny"
            onClick={() => removeBlock(block.id)}
            aria-label="删除内容块"
          >
            <Icon name="trash" size={13} />
          </button>
        </div>
      </div>
      <div className="block-card-body">{renderBlockEditor(block)}</div>
    </div>
  );

  const renderPaneBlocks = (blocks: Block[], paneIndex: number) => (
    <>
      {blocks.map((block, index) => (
        <Fragment key={block.id}>
          {blockDrop?.pane === paneIndex && blockDrop.index === index && (
            <div className="block-drop-line" />
          )}
          {renderBlockCard(block, index, paneIndex, blocks.length)}
        </Fragment>
      ))}
      {blockDrop?.pane === paneIndex && blockDrop.index === blocks.length && (
        <div className="block-drop-line" />
      )}
    </>
  );

  const renderAddRow = (pane: number, label: string) => (
    <div className="block-add-row">
      <span className="field-label">{label}</span>
      {renderAddButtons(pane)}
    </div>
  );

  const layoutGlyph = (layout: SlideLayout) => (
    <span className={`layout-glyph layout-glyph-${layout}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );

  return (
    <EditorThemeContext.Provider value={project.theme}>
      <div className="editor" style={themeVars(project.theme)}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden-input"
        onChange={(event) => {
          onFigureFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      <header className="topbar">
        <button className="icon-btn" onClick={onBack} aria-label="返回项目">
          <Icon name="back" />
        </button>
        <span className="brand-mark small" aria-hidden="true">
          <i />
          <i />
        </span>
        <div className="project-switch-wrap">
          <button
            className="project-name project-switch"
            onClick={() => setProjectMenuOpen((value) => !value)}
          >
            {project.name}
            <Icon name="down" size={12} />
          </button>
          {projectMenuOpen && (
            <>
              <div
                className="menu-backdrop"
                onClick={() => setProjectMenuOpen(false)}
              />
              <div className="project-menu">
                {projects.map((item) => (
                  <button
                    key={item.path}
                    className={item.path === projectPath ? "active" : ""}
                    onClick={() => {
                      setProjectMenuOpen(false);
                      if (item.path !== projectPath) onSwitchProject(item.path);
                    }}
                  >
                    <i
                      className="theme-dot"
                      style={{ background: paletteOf(item.theme).primary }}
                    />
                    <span>{item.name}</span>
                    {item.path === projectPath && <Icon name="check" size={13} />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <button
          className="theme-chip"
          onClick={() => setPaletteOpen(true)}
          title="选择配色"
          aria-haspopup="dialog"
        >
          <i />
          {shortTheme[project.theme]}
        </button>

        <div className="topbar-right">
          <span className="status">
            <i />
            已同步
          </span>
          <div className="export-wrap">
            <button
              className="btn ghost export-btn"
              onClick={() => setExportOpen((value) => !value)}
            >
              <Icon name="download" />
              导出
            </button>
            {exportOpen && (
              <>
                <div className="menu-backdrop" onClick={() => setExportOpen(false)} />
                <div className="export-menu">
                  <button
                    onClick={() => {
                      setExportOpen(false);
                      void exportPdf();
                    }}
                  >
                    <Icon name="file" />
                    导出 PDF
                  </button>
                  <button
                    onClick={() => {
                      setExportOpen(false);
                      void exportEdgePdf();
                    }}
                    title="上下加 0.5 厘米安全边，避免 Edge 全屏演示裁掉顶部导航"
                  >
                    <Icon name="file" />
                    导出 PDF（Edge 放映）
                  </button>
                  <button
                    onClick={() => {
                      setExportOpen(false);
                      void exportPptxFile();
                    }}
                  >
                    <Icon name="table" />
                    导出 PPTX
                  </button>
                  <button
                    onClick={() => {
                      setExportOpen(false);
                      void exportLatexProject();
                    }}
                  >
                    <Icon name="document" />
                    导出 LaTeX 工程
                  </button>
                  <button
                    onClick={() => {
                      setExportOpen(false);
                      void exportAiPackageFile();
                    }}
                  >
                    <Icon name="package" />
                    导出 AI 包
                  </button>
                  <button
                    onClick={() => {
                      setExportOpen(false);
                      void importYaml();
                    }}
                  >
                    <Icon name="document" />
                    导入内容 YAML
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="editor-body">
        <aside className="rail">
          <div className="rail-head">
            <span>幻灯片</span>
            <div className="add-wrap">
              <button
                className="icon-btn"
                onClick={() => setAddMenuOpen((value) => !value)}
                aria-label="添加页面"
              >
                <Icon name="plus" />
              </button>
              {addMenuOpen && (
                <>
                  <div className="menu-backdrop" onClick={() => setAddMenuOpen(false)} />
                  <div className="add-menu">
                    <button onClick={() => addSlide()}>
                      <Icon name="document" />
                      内容页
                    </button>
                    <button
                      onClick={() => {
                        goTo("cover");
                        setAddMenuOpen(false);
                      }}
                    >
                      <Icon name="file" />
                      封面模板
                    </button>
                    <button
                      onClick={() => {
                        goTo("toc");
                        setAddMenuOpen(false);
                      }}
                    >
                      <Icon name="table" />
                      目录模板
                    </button>
                    <button
                      onClick={() => {
                        setAddMenuOpen(false);
                        openAddChapter();
                      }}
                    >
                      <Icon name="folder" />
                      新建章节
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          <button
            className={`slide-row cover-row ${selectedId === "cover" ? "active" : ""}`}
            onClick={() => goTo("cover")}
          >
            <span className="slide-type cover" />
            <span className="slide-row-label">封面</span>
            <span className="slide-row-page">封面</span>
          </button>
          <button
            className={`slide-row toc-row ${selectedId === "toc" ? "active" : ""}`}
            onClick={() => goTo("toc")}
          >
            <span className="slide-type toc" />
            <span className="slide-row-label">目录</span>
            <span className="slide-row-page">目录</span>
          </button>

          <div className="rail-sections">
            {project.sections.map((section) => (
              <div
                className={`rail-section ${selectedSectionId === section.id ? "selected" : ""}`}
                key={section.id}
              >
                <div
                  className={`rail-section-title ${
                    slideDrop?.sectionId === section.id &&
                    slideDrop.index === section.slides.length
                      ? "drop-target"
                      : ""
                  }`}
                  data-slide-drop="section"
                  data-section-id={section.id}
                  data-slide-count={section.slides.length}
                >
                  <button
                    className="rail-section-name"
                    onClick={() => handleSectionClick(section)}
                    onDoubleClick={() => handleSectionDoubleClick(section)}
                    title="单击定位章节，双击重命名"
                  >
                    {section.title}
                  </button>
                  <button
                    className="icon-btn tiny"
                    onClick={() => addSlide(section.id)}
                    title="在本章节添加幻灯片"
                    aria-label="在本章节添加幻灯片"
                  >
                    <Icon name="plus" size={12} />
                  </button>
                </div>
                {section.slides.map((item, index) => (
                  <button
                    key={item.id}
                    className={`slide-row ${selectedId === item.id ? "active" : ""} ${
                      slideDrag?.id === item.id && slideDrag.active ? "dragging" : ""
                    } ${
                      slideDrop?.sectionId === section.id && slideDrop.index === index
                        ? "drop-target"
                        : ""
                    }`}
                    data-slide-drop="slide"
                    data-section-id={section.id}
                    data-index={index}
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      event.currentTarget.setPointerCapture?.(event.pointerId);
                      const title = plainText(item.title) || "未命名";
                      dragRef.current = {
                        id: item.id,
                        title,
                        sectionId: section.id,
                        index,
                        pointerId: event.pointerId,
                        startX: event.clientX,
                        startY: event.clientY,
                        active: false,
                      };
                      suppressSlideClick.current = false;
                      setSlideDrag({
                        id: item.id,
                        title,
                        x: event.clientX,
                        y: event.clientY,
                        active: false,
                      });
                    }}
                    onClick={() => {
                      if (suppressSlideClick.current) {
                        suppressSlideClick.current = false;
                        return;
                      }
                      selectSlide(item.id, section.id);
                    }}
                    title="拖动可调整顺序"
                  >
                    <span className="slide-type content" />
                    <span className="slide-row-label">
                      {plainText(item.title) || "未命名"}
                    </span>
                    <span className="slide-row-page">{pageMap.get(item.id)}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>

          <button
            className={`slide-row ending-row ${selectedId === "ending" ? "active" : ""}`}
            onClick={() => goTo("ending")}
          >
            <span className="slide-type ending" />
            <span className="slide-row-label">结尾</span>
            <span className="slide-row-page">结尾</span>
          </button>

          <div className="rail-footer">
            <button className="rail-add" onClick={openAddChapter}>
              <Icon name="folder" size={14} />
              添加章节
            </button>
            <button className="rail-add" onClick={() => setAddMenuOpen(true)}>
              <Icon name="plus" size={14} />
              添加幻灯片
            </button>
          </div>
        </aside>

        <section className="form">
          {pageKind === "cover" && (
            <>
              <div className="form-head">
                <span className="type-chip">封面</span>
                <span className="page-meta">不计入正文页码</span>
              </div>
              <div className="field">
                <label className="field-label">课程名</label>
                <RichField
                  variant="title"
                  value={project.cover.title}
                  placeholder="输入课程名"
                  onChange={(value) => updateCover({ title: value })}
                />
              </div>
              <label className="field-label">封面字段</label>
              <div className="cover-fields">
                {project.cover.fields.map((field, index) => (
                  <div className="cover-field-card" key={field.id}>
                    <div className="cover-field-row">
                      <input
                        className="input cover-label-input"
                        value={field.label}
                        placeholder="字段名"
                        onChange={(event) =>
                          updateCoverField(field.id, { label: event.target.value })
                        }
                      />
                      <div className="size-toggle">
                        {(["lg", "md", "sm"] as CoverFieldSize[]).map((size) => (
                          <button
                            key={size}
                            className={`size-btn ${field.size === size ? "active" : ""}`}
                            onClick={() => updateCoverField(field.id, { size })}
                          >
                            {coverSizeLabel[size]}
                          </button>
                        ))}
                      </div>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={field.showLabel}
                          onChange={(event) =>
                            updateCoverField(field.id, { showLabel: event.target.checked })
                          }
                        />
                        显示标签
                      </label>
                      <div className="cover-field-actions">
                        <button
                          className="icon-btn tiny"
                          disabled={index === 0}
                          onClick={() => moveCoverField(index, -1)}
                          aria-label="上移字段"
                        >
                          <Icon name="up" size={13} />
                        </button>
                        <button
                          className="icon-btn tiny"
                          disabled={index === project.cover.fields.length - 1}
                          onClick={() => moveCoverField(index, 1)}
                          aria-label="下移字段"
                        >
                          <Icon name="down" size={13} />
                        </button>
                        <button
                          className="icon-btn tiny"
                          onClick={() => removeCoverField(field.id)}
                          aria-label="删除字段"
                        >
                          <Icon name="trash" size={13} />
                        </button>
                      </div>
                    </div>
                    <RichField
                      variant="compact"
                      value={field.value}
                      placeholder="内容"
                      onChange={(value) => updateCoverField(field.id, { value })}
                    />
                  </div>
                ))}
              </div>
              <button className="add-item" onClick={addCoverField}>
                <Icon name="plus" size={13} />
                添加字段
              </button>
            </>
          )}

          {pageKind === "toc" && (
            <>
              <div className="form-head">
                <span className="type-chip">目录</span>
                <span className="page-meta">不计入正文页码</span>
              </div>
              <label className="field-label">章节</label>
              <div className="toc-edit-list">
                {project.sections.map((section, index) => (
                  <div className="toc-edit-item" key={section.id}>
                    <span className="toc-edit-index">{index + 1}</span>
                    <span className="toc-edit-name">{section.title}</span>
                    <span className="toc-edit-count">{section.slides.length} 页</span>
                    <button
                      className="icon-btn tiny"
                      onClick={() => openRenameChapter(section)}
                      aria-label="重命名章节"
                    >
                      <Icon name="edit" size={13} />
                    </button>
                    <button
                      className="icon-btn tiny"
                      onClick={() => deleteSection(section.id)}
                      aria-label="删除章节"
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                ))}
              </div>
              <button className="add-item" onClick={openAddChapter}>
                <Icon name="plus" size={13} />
                添加章节
              </button>
              <div className="auto-number">目录由章节与页码自动生成</div>
            </>
          )}

          {pageKind === "ending" && (
            <>
              <div className="form-head">
                <span className="type-chip">结尾页</span>
                <span className="page-meta">不计入正文页码</span>
              </div>
              <div className="field">
                <label className="field-label">中间文字</label>
                <RichField
                  variant="title"
                  value={endingTitle(project)}
                  placeholder="恳请各位批判指正"
                  onChange={(value) =>
                    onChange({ ...project, ending: { title: value } })
                  }
                />
              </div>
              <div className="ending-fields-info">
                <div>
                  <span>汇报人</span>
                  <b>{endingPresenter(project)}</b>
                </div>
                <div>
                  <span>汇报时间</span>
                  <b>{endingDate(project)}</b>
                </div>
              </div>
              <div className="auto-number">
                汇报人和汇报时间取自封面字段，可在封面页修改
              </div>
            </>
          )}

          {pageKind === "content" && selectedSlide && (
            <>
              <div className="form-head">
                <span className="type-chip">
                  {selectedSlide.blocks.length === 0
                    ? "空白"
                    : selectedSlide.blocks.length === 1
                      ? blockKindLabel[selectedSlide.blocks[0].kind]
                      : "混排"}
                </span>
                <span className="page-meta">
                  第 {currentPage} 页 / 共 {total} 页
                </span>
                <button
                  className="icon-btn more"
                  onClick={() => deleteSlide(selectedSlide.id)}
                  title="删除此页"
                  aria-label="删除此页"
                >
                  <Icon name="trash" />
                </button>
              </div>

              <div className="field">
                <label className="field-label">标题</label>
                <RichField
                  variant="title"
                  value={selectedSlide.title}
                  placeholder="输入标题"
                  onChange={(value) => updateSlide(selectedSlide.id, { title: value })}
                />
              </div>

              <div className="layout-field">
                <span className="field-label">版面</span>
                <div className="layout-options">
                  {SLIDE_LAYOUTS.map((item) => (
                    <button
                      key={item.id}
                      className={`layout-option ${selectedSlide.layout === item.id ? "active" : ""}`}
                      onClick={() => changeSlideLayout(item.id)}
                      aria-pressed={selectedSlide.layout === item.id}
                      title={item.label}
                    >
                      {layoutGlyph(item.id)}
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <label className="field-label">内容</label>
              {selectedSlide.layout === "full" ? (
                <div className="block-pane-shell" data-block-pane={0}>
                  <div className="block-list">
                    {renderPaneBlocks(orderedBlocks(selectedSlide), 0)}
                  </div>
                  {renderAddRow(0, "添加内容")}
                </div>
              ) : (
                <div className={`pane-editor-grid layout-${selectedSlide.layout}`}>
                  {paneBlocks(selectedSlide).map((blocks, paneIndex) => (
                    <section
                      className="pane-editor"
                      data-block-pane={paneIndex}
                      key={paneIndex}
                    >
                      <div className="pane-editor-head">
                        <span>{paneLabel(selectedSlide.layout, paneIndex)}</span>
                        <span>{blocks.length} 个内容块</span>
                      </div>
                      <div className="block-list">
                        {renderPaneBlocks(blocks, paneIndex)}
                      </div>
                      {renderAddRow(
                        paneIndex,
                        `添加到${paneLabel(selectedSlide.layout, paneIndex)}`,
                      )}
                    </section>
                  ))}
                </div>
              )}

              <div className="footnotes-editor">
                <div className="footnotes-head">
                  <span className="field-label">脚注</span>
                  <span className="footnotes-count">
                    {selectedSlide.footnotes?.length ?? 0} 条
                  </span>
                </div>
                {(selectedSlide.footnotes ?? []).map((note, index) => (
                  <div className="footnote-editor-row" key={index}>
                    <span className="footnote-editor-index">注 {index + 1}</span>
                    <RichField
                      variant="compact"
                      value={note}
                      placeholder="脚注内容"
                      onChange={(value) => updateFootnote(index, value)}
                    />
                    <button
                      className="icon-btn tiny"
                      onClick={() => removeFootnote(index)}
                      aria-label="删除脚注"
                    >
                      <Icon name="close" size={12} />
                    </button>
                  </div>
                ))}
                <button className="add-item" onClick={addFootnote}>
                  <Icon name="plus" size={12} />
                  脚注
                </button>
              </div>
            </>
          )}

          {pageKind === "content" && !selectedSlide && (
            <div className="form-empty">选择一页开始编辑</div>
          )}
        </section>

        <aside className="preview-pane">
          <div className="preview-head">
            <span>预览</span>
            <div className="preview-nav">
              <button className="icon-btn" onClick={goPrev} aria-label="上一页">
                <Icon name="left" />
              </button>
              <span>
                {pageKind === "cover" ? "封面" : pageKind === "toc" ? "目录" : pageKind === "ending" ? "结尾" : `${currentPage} / ${total}`}
              </span>
              <button className="icon-btn" onClick={goNext} aria-label="下一页">
                <Icon name="right" />
              </button>
            </div>
            <span className="zoom">适应</span>
            {isDesktop && (
              <div className="preview-mode-switch">
                <button
                  className={!layoutPreview ? "active" : ""}
                  onClick={() => setLayoutPreview(false)}
                >
                  PDF
                </button>
                <button
                  className={layoutPreview ? "active" : ""}
                  onClick={() => setLayoutPreview(true)}
                  title="布局预览里可以直接拖动块"
                >
                  布局
                </button>
              </div>
            )}
            {isDesktop && (
              <button
                className="compile-btn"
                disabled={compiling}
                onClick={() => void compileNow()}
                title="⌃⌥ 编译"
              >
                {compiling ? "编译中" : "编译"}
              </button>
            )}
            <button
              className={`dots-toggle ${project.showDots ? "active" : ""}`}
              onClick={() => onChange({ ...project, showDots: !project.showDots })}
              title="显示章节圆点"
              aria-label="显示章节圆点"
            >
              <span className="dots-icon">
                <i />
                <i />
                <i />
              </span>
            </button>
          </div>

          <div className="preview-card">
            {isDesktop && !layoutPreview ? (
              <PdfPreview pdf={pdf} page={pdfPage} />
            ) : (
              <SlidePreview
                project={project}
                pageKind={pageKind}
                slide={pageKind === "content" ? selectedSlide : null}
                page={currentPage}
                total={total}
                assetUrls={assetUrls}
                onBlockMove={(blockId, offsetX, offsetY) =>
                  updateBlockAnywhere(blockId, { offsetX, offsetY })
                }
              />
            )}
          </div>

          {compileError && (
            <div className="compile-error" title={compileError}>
              {compileError}
            </div>
          )}
          <div className={`compile-status ${compileError ? "error" : ""}`}>
            <i />
            {compiling
              ? "编译中"
              : compileError
                ? "编译失败"
                : isDesktop && dirty
                  ? "有改动 · 点编译"
                  : compileMs !== null
                    ? `已编译 · ${(compileMs / 1000).toFixed(1)}s${compileWarnings > 0 ? ` · ${compileWarnings} 处提示` : ""}`
                    : isDesktop
                      ? "等待编译"
                      : "已同步"}
          </div>
          <div className={`progress-track ${compiling ? "active" : ""}`}>
            <span />
          </div>
        </aside>
      </div>

      {confirmDialog && (
        <div className="modal-overlay" onMouseDown={() => setConfirmDialog(null)}>
          <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>确认删除</h3>
              <button
                className="icon-btn"
                onClick={() => setConfirmDialog(null)}
                aria-label="关闭"
              >
                <Icon name="close" />
              </button>
            </div>
            <p className="modal-text">{confirmDialog.message}</p>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setConfirmDialog(null)}>
                取消
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  const action = confirmDialog.action;
                  setConfirmDialog(null);
                  action();
                }}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      {chapterModal && (
        <div className="modal-overlay" onMouseDown={() => setChapterModal(null)}>
          <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>{chapterModal.mode === "add" ? "新建章节" : "重命名章节"}</h3>
              <button className="icon-btn" onClick={() => setChapterModal(null)} aria-label="关闭">
                <Icon name="close" />
              </button>
            </div>
            <label className="field-label">章节名</label>
            <input
              className="input modal-input"
              autoFocus
              value={chapterModal.value}
              onChange={(event) =>
                setChapterModal({ ...chapterModal, value: event.target.value })
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") submitChapter();
              }}
            />
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setChapterModal(null)}>
                取消
              </button>
              <button
                className="btn primary"
                onClick={submitChapter}
                disabled={!chapterModal.value.trim()}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {slideDrag?.active &&
        createPortal(
          <div
            className="slide-drag-ghost"
            style={{
              ...themeVars(project.theme),
              left: slideDrag.x + 14,
              top: slideDrag.y + 14,
            }}
          >
            {slideDrag.title}
          </div>,
          document.body,
        )}

      {blockDrag?.active &&
        createPortal(
          <div
            className="block-drag-ghost"
            style={{
              ...themeVars(project.theme),
              left: blockDrag.x + 14,
              top: blockDrag.y + 14,
            }}
          >
            {blockDrag.title}
          </div>,
          document.body,
        )}

      {paletteOpen && (
        <PaletteGallery
          project={project}
          pageKind={pageKind}
          slide={pageKind === "content" ? selectedSlide : null}
          page={currentPage}
          total={total}
          assetUrls={assetUrls}
          onSelect={(theme) => onChange({ ...project, theme })}
          onClose={() => setPaletteOpen(false)}
        />
      )}

      {pasteModal && (
        <div className="modal-overlay" onMouseDown={() => setPasteModal(null)}>
          <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>粘贴表格</h3>
              <button className="icon-btn" onClick={() => setPasteModal(null)} aria-label="关闭">
                <Icon name="close" />
              </button>
            </div>
            <textarea
              className="paste-area"
              autoFocus
              value={pasteModal.value}
              placeholder="从 Excel 复制表格，粘贴到这里"
              onChange={(event) => setPasteModal({ ...pasteModal, value: event.target.value })}
            />
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setPasteModal(null)}>
                取消
              </button>
              <button
                className="btn primary"
                onClick={submitPaste}
                disabled={!pasteModal.value.trim()}
              >
                导入
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </EditorThemeContext.Provider>
  );
}
