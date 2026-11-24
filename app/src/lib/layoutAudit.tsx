import { createRoot } from "react-dom/client";
import type { Block, Project, Section, Slide } from "../types";
import { blockKindLabel } from "../types";
import { paneLabel } from "./layout";
import { SlidePreview } from "../components/SlidePreview";

export interface LayoutIssue {
  slideId: string;
  slideTitle: string;
  sectionTitle: string;
  pane: number | null;
  blockId: string | null;
  message: string;
}

interface AuditPage {
  section: Section;
  slide: Slide;
  page: number;
}

function contentPages(project: Project): AuditPage[] {
  let page = 0;
  const pages: AuditPage[] = [];
  for (const section of project.sections) {
    for (const slide of section.slides) {
      page += 1;
      pages.push({ section, slide, page });
    }
  }
  return pages;
}

function blockKind(blockId: string, slide: Slide): string {
  const block = slide.blocks.find((item) => item.id === blockId) as Block | undefined;
  return block ? blockKindLabel[block.kind] : "内容块";
}

function waitForImages(root: HTMLElement): Promise<void> {
  const images = Array.from(root.querySelectorAll("img"));
  return Promise.all(
    images.map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete) {
            resolve();
            return;
          }
          const done = () => resolve();
          image.addEventListener("load", done, { once: true });
          image.addEventListener("error", done, { once: true });
        }),
    ),
  ).then(() => undefined);
}

function outside(
  rect: DOMRect,
  bounds: DOMRect,
  sides: Array<"top" | "right" | "bottom" | "left">,
): boolean {
  const tolerance = 1.5;
  return sides.some((side) => {
    if (side === "top") return rect.top < bounds.top - tolerance;
    if (side === "bottom") return rect.bottom > bounds.bottom + tolerance;
    if (side === "left") return rect.left < bounds.left - tolerance;
    return rect.right > bounds.right + tolerance;
  });
}

export async function auditWebLayout(
  project: Project,
  assetUrls: Map<string, string>,
): Promise<LayoutIssue[]> {
  const pages = contentPages(project);
  if (pages.length === 0) return [];
  const stage = document.createElement("div");
  stage.setAttribute("data-xyj-audit", "true");
  stage.style.cssText =
    "position:fixed;left:-20000px;top:0;width:1280px;visibility:hidden;pointer-events:none;z-index:-1;";
  document.body.appendChild(stage);
  const root = createRoot(stage);
  const total = pages.length;

  try {
    root.render(
      <div>
        {pages.map(({ section, slide, page }) => (
          <div
            key={slide.id}
            data-audit-slide={slide.id}
            data-audit-section={section.id}
            style={{ position: "relative", width: 1280, height: 720 }}
          >
            <SlidePreview
              project={project}
              pageKind="content"
              slide={slide}
              page={page}
              total={total}
              assetUrls={assetUrls}
            />
          </div>
        ))}
      </div>,
    );
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    await document.fonts.ready;
    await waitForImages(stage);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );

    const issues: LayoutIssue[] = [];
    const seen = new Set<string>();
    const add = (
      slide: Slide,
      section: Section,
      pane: number | null,
      blockId: string | null,
      message: string,
    ) => {
      const key = `${slide.id}:${pane ?? "full"}:${blockId ?? ""}:${message}`;
      if (seen.has(key)) return;
      seen.add(key);
      issues.push({
        slideId: slide.id,
        slideTitle: slide.title,
        sectionTitle: section.title,
        pane,
        blockId,
        message,
      });
    };

    for (const { section, slide } of pages) {
      const pageEl = stage.querySelector<HTMLElement>(
        `[data-audit-slide="${CSS.escape(slide.id)}"]`,
      );
      if (!pageEl) continue;
      const content = pageEl.querySelector<HTMLElement>(".slide-content");
      if (!content) continue;
      const contentRect = content.getBoundingClientRect();

      for (const table of pageEl.querySelectorAll<HTMLElement>(".slide-table")) {
        if (outside(table.getBoundingClientRect(), contentRect, ["left", "right"])) {
          add(slide, section, null, null, "表格超出页面正文范围");
        }
      }
      for (const caption of pageEl.querySelectorAll<HTMLElement>(
        ".slide-table-caption",
      )) {
        if (outside(caption.getBoundingClientRect(), contentRect, ["left", "right"])) {
          add(slide, section, null, null, "表注超出页面正文范围");
        }
      }
      for (const figure of pageEl.querySelectorAll<HTMLElement>(".slide-figure")) {
        if (outside(figure.getBoundingClientRect(), contentRect, ["left", "right"])) {
          add(slide, section, null, null, "图片超出页面正文范围");
        }
        const image = figure.querySelector("img");
        if (image?.complete && image.naturalWidth === 0) {
          add(slide, section, null, null, "图片无法加载");
        }
      }

      if (slide.layout === "full") {
        if (content.scrollHeight > content.clientHeight + 1) {
          add(slide, section, null, null, "内容超出版面高度");
        }
        for (const blockEl of Array.from(
          content.querySelectorAll<HTMLElement>("[data-block-id]"),
        )) {
          if (outside(blockEl.getBoundingClientRect(), contentRect, ["top", "bottom"])) {
            const blockId = blockEl.dataset.blockId ?? null;
            add(
              slide,
              section,
              null,
              blockId,
              `${blockKind(blockId ?? "", slide)}超出版面高度`,
            );
          }
        }
        continue;
      }

      const paneElements = Array.from(
        pageEl.querySelectorAll<HTMLElement>(".slide-pane"),
      );
      paneElements.forEach((paneEl, paneIndex) => {
        const paneRect = paneEl.getBoundingClientRect();
        if (
          paneEl.scrollHeight > paneEl.clientHeight + 1 ||
          paneEl.scrollWidth > paneEl.clientWidth + 1
        ) {
          add(
            slide,
            section,
            paneIndex,
            null,
            `${paneLabel(slide.layout, paneIndex)}版面内容超出版面`,
          );
        }
        for (const blockEl of Array.from(
          paneEl.querySelectorAll<HTMLElement>("[data-block-id]"),
        )) {
          const blockId = blockEl.dataset.blockId ?? null;
          if (outside(blockEl.getBoundingClientRect(), paneRect, ["top", "bottom"])) {
            add(
              slide,
              section,
              paneIndex,
              blockId,
              `${paneLabel(slide.layout, paneIndex)}版面的${blockKind(
                blockId ?? "",
                slide,
              )}超出版面高度`,
            );
          }
          for (const inner of Array.from(
            blockEl.querySelectorAll<HTMLElement>(
              ".slide-table, .slide-table-caption, .slide-figure",
            ),
          )) {
            if (
              outside(inner.getBoundingClientRect(), paneRect, [
                "left",
                "right",
                "top",
                "bottom",
              ])
            ) {
              add(
                slide,
                section,
                paneIndex,
                blockId,
                `${paneLabel(slide.layout, paneIndex)}版面的${blockKind(
                  blockId ?? "",
                  slide,
                )}超出版面`,
              );
            }
          }
        }
        for (const image of Array.from(paneEl.querySelectorAll("img"))) {
          if (image.complete && image.naturalWidth === 0) {
            add(
              slide,
              section,
              paneIndex,
              null,
              `${paneLabel(slide.layout, paneIndex)}版面有图片无法加载`,
            );
          }
        }
      });
    }

    return issues;
  } finally {
    root.unmount();
    stage.remove();
  }
}
