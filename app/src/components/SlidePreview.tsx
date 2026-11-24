import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import type { Block, LineAlign, Project, Slide, TextBlock } from "../types";
import { blockKindLabel } from "../types";
import { themeVars } from "../lib/palettes";
import {
  orderedBlocks,
  paneBlocks,
  TABLE_TEXT_INSET,
} from "../lib/layout";
import { parseRich, splitRichLines } from "../lib/richtext";
import { isCodeComment } from "../lib/code";
import { endingDate, endingPresenter, endingTitle } from "../lib/ending";
import {
  blockHasVisibleContent,
  hasVisibleRich,
  plainText,
  stripCaptionNumber,
} from "../lib/text";

function MathTex({ tex, display }: { tex: string; display?: boolean }) {
  const html = katex.renderToString(tex, {
    throwOnError: false,
    displayMode: display,
    strict: false,
    output: "html",
  });
  return (
    <span
      className={display ? "math-display" : "math-inline"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function richNode(node: ReturnType<typeof parseRich>[number], key: number) {
  if (node.type === "text") {
    const lines = node.text.split("\n");
    return (
      <span key={key}>
        {lines.map((line, lineIndex) => (
          <span key={lineIndex}>
            {lineIndex > 0 && <br />}
            {line}
          </span>
        ))}
      </span>
    );
  }
  if (node.type === "math") {
    return <MathTex key={key} tex={node.tex} display={node.display} />;
  }
  const children = node.children.map((child, index) => richNode(child, index));
  if (node.mark === "emphasis") {
    return <strong className="kw" key={key}>{children}</strong>;
  }
  if (node.mark === "italic") {
    return <em key={key}>{children}</em>;
  }
  if (node.mark === "underline") {
    return <u key={key}>{children}</u>;
  }
  if (node.mark === "strike") {
    return <s key={key}>{children}</s>;
  }
  if (node.mark === "overline") {
    return <span className="rich-overline" key={key}>{children}</span>;
  }
  return <mark className="rich-highlight" key={key}>{children}</mark>;
}

function Rich({ text }: { text: string }) {
  return <>{parseRich(text).map((node, index) => richNode(node, index))}</>;
}

function RichLines({ text, aligns }: { text: string; aligns?: LineAlign[] }) {
  const lines = splitRichLines(parseRich(text));
  return (
    <>
      {lines.map((nodes, index) => {
        const align = aligns?.[index] ?? "left";
        return (
          <div className="rich-line" data-align={align} style={{ textAlign: align }} key={index}>
            {nodes.length > 0 ? nodes.map((node, nodeIndex) => richNode(node, nodeIndex)) : <br />}
          </div>
        );
      })}
    </>
  );
}

function blockOrdinal(project: Project, blockId: string, kind: Block["kind"]): number {
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

interface SlidePreviewProps {
  project: Project;
  pageKind: "cover" | "toc" | "content" | "ending";
  slide: Slide | null;
  page: number;
  total: number;
  assetUrls?: Map<string, string>;
  onBlockMove?: (blockId: string, offsetX: number, offsetY: number) => void;
}

export function SlidePreview({
  project,
  pageKind,
  slide,
  page,
  total,
  assetUrls,
  onBlockMove,
}: SlidePreviewProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.39);
  const blockMoveRef = useRef<{
    blockId: string;
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const update = () => setScale(element.clientWidth / 1280);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const beginBlockMove = (
    event: ReactPointerEvent<HTMLDivElement>,
    block: Block,
  ) => {
    if (!onBlockMove || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    blockMoveRef.current = {
      blockId: block.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: block.offsetX ?? 0,
      offsetY: block.offsetY ?? 0,
    };
  };

  useEffect(() => {
    if (!onBlockMove) return;
    const onMove = (event: PointerEvent) => {
      const drag = blockMoveRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      event.preventDefault();
      const dx = (event.clientX - drag.startX) / scale;
      const dy = (event.clientY - drag.startY) / scale;
      onBlockMove(
        drag.blockId,
        Math.round(drag.offsetX + dx),
        Math.round(drag.offsetY + dy),
      );
    };
    const finish = (event: PointerEvent) => {
      if (blockMoveRef.current?.pointerId === event.pointerId) {
        blockMoveRef.current = null;
      }
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [onBlockMove, scale]);

  const activeSection =
    pageKind === "content" && slide
      ? project.sections.findIndex((section) =>
          section.slides.some((item) => item.id === slide.id),
        )
      : -1;
  const indexInSection =
    pageKind === "content" && slide
      ? project.sections[activeSection]?.slides.findIndex((item) => item.id === slide.id) ?? 0
      : 0;

  const presenterField = project.cover.fields.find((field) => field.role === "presenter");
  const presenter = presenterField
    ? `${presenterField.label}：${plainText(presenterField.value)}`
    : "";
  const showDots = project.showDots;
  const dense = project.sections.length > 5;
  const veryDense = project.sections.length > 8;
  const fullBlocks = slide ? orderedBlocks(slide) : [];
  const fullCentered =
    slide?.layout === "full" &&
    fullBlocks.length === 1 &&
    fullBlocks[0].centered === true;

  const renderBlockContent = (block: Block) => {
    if (block.kind !== "figure" && !blockHasVisibleContent(block)) return null;
    if (block.kind === "bullets") {
      const items = block.items.filter((item) => hasVisibleRich(item.text));
      return (
        <div className="slide-bullets" key={block.id} data-block-id={block.id}>
          {hasVisibleRich(block.title ?? "") && (
            <div className="slide-block-title">
              <Rich text={block.title ?? ""} />
            </div>
          )}
          {items.map((item) => (
            <div className="slide-bullet" key={item.id}>
              <i className="slide-bullet-dot" />
              <div className="slide-bullet-text">
                <RichLines text={item.text} aligns={item.aligns} />
                {item.notes.map(
                  (note, noteIndex) =>
                    hasVisibleRich(note) && (
                      <div className="slide-bullet-note" key={noteIndex}>
                        <RichLines text={note} aligns={item.noteAligns?.[noteIndex]} />
                      </div>
                    ),
                )}
              </div>
            </div>
          ))}
        </div>
      );
    }
    if (block.kind === "figure") {
      return (
        <div
          className="slide-figure-layout"
          key={block.id}
          data-block-id={block.id}
          style={{
            transform: `scale(${block.scale})`,
          }}
        >
          <figure className="slide-figure">
            {block.src ? (
              <img
                src={assetUrls?.get(block.src) ?? block.src}
                alt={plainText(block.caption)}
              />
            ) : (
              <div className="slide-figure-empty">图片</div>
            )}
            {block.caption.trim() && (
              <figcaption>
                <span className="slide-caption-number">
                  图 {blockOrdinal(project, block.id, "figure")}
                </span>
                <Rich text={stripCaptionNumber("图", block.caption)} />
              </figcaption>
            )}
          </figure>
        </div>
      );
    }
    if (block.kind === "table") {
      return (
        <div
          className="slide-table-layout"
          key={block.id}
          data-block-id={block.id}
          style={
            {
              justifyContent:
                block.placement === "left"
                  ? "flex-start"
                  : block.placement === "right"
                    ? "flex-end"
                    : "center",
              paddingLeft: TABLE_TEXT_INSET,
              "--table-scale": block.scale,
            } as CSSProperties
          }
        >
          <div className="slide-table-wrap">
            <table className="slide-table">
              {block.caption.trim() && (
                <caption className="slide-table-caption">
                  <span className="slide-caption-number">
                    表 {blockOrdinal(project, block.id, "table")}
                  </span>
                  <Rich text={stripCaptionNumber("表", block.caption)} />
                </caption>
              )}
              {block.header.length > 0 && (
                <thead>
                  <tr>
                    {block.header.map((cell, index) => (
                      <th key={index} style={{ textAlign: block.aligns?.[index] ?? "center" }}>
                        <Rich text={cell} />
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) =>
                      block.firstColumnHeader && cellIndex === 0 ? (
                        <th
                          key={cellIndex}
                          scope="row"
                          style={{ textAlign: block.aligns?.[cellIndex] ?? "center" }}
                        >
                          <Rich text={cell} />
                        </th>
                      ) : (
                        <td
                          key={cellIndex}
                          style={{ textAlign: block.aligns?.[cellIndex] ?? "center" }}
                        >
                          <Rich text={cell} />
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
    if (block.kind === "code") {
      return (
        <div className="slide-code" key={block.id} data-block-id={block.id}>
          {hasVisibleRich(block.title ?? "") && (
            <div className="slide-block-title">
              <Rich text={block.title ?? ""} />
            </div>
          )}
          <pre className="slide-code-pre">
            {block.code.split("\n").map((line, index) => (
              <div
                className={`code-line${isCodeComment(line) ? " comment" : ""}`}
                key={index}
              >
                {line || " "}
              </div>
            ))}
          </pre>
        </div>
      );
    }
    if (block.kind === "references") {
      const items = block.items.filter((item) => hasVisibleRich(item));
      if (items.length === 0 && !hasVisibleRich(block.title ?? "")) return null;
      return (
        <div className="slide-references" key={block.id} data-block-id={block.id}>
          {hasVisibleRich(block.title ?? "") && (
            <div className="slide-block-title">
              <Rich text={block.title ?? ""} />
            </div>
          )}
          {items.map((item, index) => (
            <div className="slide-reference" key={index}>
              <Rich text={item} />
            </div>
          ))}
        </div>
      );
    }
    const textBlock = block as TextBlock;
    const label = textBlock.label?.trim() || blockKindLabel[textBlock.kind];
    const ordinal = blockOrdinal(project, textBlock.id, textBlock.kind);
    return (
      <div className={`slide-block ${textBlock.kind}`} key={textBlock.id} data-block-id={textBlock.id}>
        <div className="slide-block-head">
          {label}
          {ordinal > 0 ? ` ${ordinal}` : ""}
        </div>
        <div
          className="slide-block-body"
          style={textBlock.align === "center" ? { textAlign: "center" } : undefined}
        >
          <Rich text={textBlock.body} />
        </div>
      </div>
    );
  };

  const renderBlock = (block: Block) => {
    const content = renderBlockContent(block);
    if (!content) return null;
    const offsetX = block.offsetX ?? 0;
    const offsetY = block.offsetY ?? 0;
    return (
      <div
        className={`slide-block-move${onBlockMove ? " draggable" : ""}`}
        key={block.id}
        style={
          offsetX || offsetY
            ? { transform: `translate(${offsetX}px, ${offsetY}px)` }
            : undefined
        }
        onPointerDown={
          onBlockMove ? (event) => beginBlockMove(event, block) : undefined
        }
      >
        {content}
      </div>
    );
  };

  return (
    <div className="slide-viewport" ref={wrapRef}>
      <div
        className="slide-canvas"
        style={{ ...themeVars(project.theme), transform: `scale(${scale})` }}
      >
        {pageKind !== "ending" && (
        <div className="slide-headline">
          <div className={`slide-sections ${dense ? "dense" : ""} ${veryDense ? "very-dense" : ""}`}>
            {project.sections.map((section, sectionIndex) => {
              const slideCount = section.slides.length;
              const dotCount = Math.min(slideCount, 12);
              const activeDot =
                sectionIndex === activeSection && slideCount > 0
                  ? slideCount <= 12
                    ? Math.min(indexInSection, dotCount - 1)
                    : Math.round(
                        (indexInSection * (dotCount - 1)) / Math.max(1, slideCount - 1),
                      )
                  : -1;
              return (
                <div
                  className={`slide-section ${sectionIndex === activeSection ? "active" : ""}`}
                  key={section.id}
                >
                  <div className="slide-section-label">{section.title}</div>
                  {showDots && dotCount > 0 && (
                    <div className="slide-dots">
                      {Array.from({ length: dotCount }).map((_, dotIndex) => (
                        <i
                          key={dotIndex}
                          className={`slide-dot ${dotIndex === activeDot ? "filled" : ""}`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <img className="slide-logo" src="/whu-logo-white.png" alt="" />
        </div>
        )}

        {pageKind === "ending" && (
          <div className="slide-ending">
            <div className="ending-band">
              <div className="ending-logo">
                <img src="/whu-logo-white.png" alt="" />
              </div>
              <div className="ending-title">
                <Rich text={endingTitle(project)} />
              </div>
              <svg className="ending-curve" viewBox="0 0 1280 78" preserveAspectRatio="none" aria-hidden="true">
                <path d="M0,0 H1280 V34 Q640,76 0,34 Z" fill="var(--primary)" />
                <path d="M0,34 Q640,76 1280,34 L1280,78 L0,78 Z" fill="#fff" />
                <path d="M0,34 Q640,76 1280,34" fill="none" stroke="#D8A47F" strokeWidth="4" />
              </svg>
            </div>
            <div className="ending-info">
              <div className="ending-row">
                <span className="ending-label">汇报人：</span>
                <span className="ending-value">{endingPresenter(project)}</span>
              </div>
              <div className="ending-row">
                <span className="ending-label">汇报时间：</span>
                <span className="ending-value">{endingDate(project)}</span>
              </div>
            </div>
          </div>
        )}

        {pageKind === "cover" && (
          <div className="slide-cover">
            <div className="slide-cover-band">
              <div className="slide-cover-title">
                <Rich text={project.cover.title} />
              </div>
              <div className="slide-cover-line" />
            </div>
            <div className="slide-cover-fields">
              {project.cover.fields.map((field) => (
                <div className={`slide-cover-field ${field.size}`} key={field.id}>
                  {field.showLabel && <span className="slide-cover-label">{field.label}：</span>}
                  <Rich text={field.value} />
                </div>
              ))}
            </div>
          </div>
        )}

        {pageKind === "toc" && (
          <>
            <div className="slide-title">大纲</div>
            <div className={`slide-toc ${project.sections.length > 5 ? "two-col" : ""}`}>
              {project.sections.map((section, index) => (
                <div className="slide-toc-item" key={section.id}>
                  <span className="slide-toc-index">{index + 1}</span>
                  <span className="slide-toc-name">{section.title}</span>
                </div>
              ))}
            </div>
            <div className="slide-footer">
              <span>{presenter}</span>
              <span className="slide-footer-title">{plainText(project.cover.title)}</span>
              <span className="slide-footer-page" />
            </div>
          </>
        )}

        {pageKind === "content" && slide && (
          <>
            <div className="slide-title">
              <Rich text={slide.title} />
            </div>
            <div className="slide-body">
              <div
                className={`slide-content layout-${slide.layout}${
                  fullCentered ? " is-centered" : ""
                }`}
              >
                {slide.layout === "full"
                  ? fullBlocks.map(renderBlock)
                  : paneBlocks(slide).map((blocks, paneIndex) => (
                      <div
                        className={`slide-pane${
                          blocks.length === 1 && blocks[0].centered
                            ? " is-centered"
                            : ""
                        }`}
                        data-pane={paneIndex}
                        key={paneIndex}
                      >
                        {blocks.map(renderBlock)}
                      </div>
                    ))}
              </div>
              {slide.footnotes && slide.footnotes.some((note) => hasVisibleRich(note)) && (
                <div className="slide-footnotes">
                  {slide.footnotes
                    .filter((note) => hasVisibleRich(note))
                    .map((note, index) => (
                      <div className="slide-footnote" key={index}>
                        <span className="slide-footnote-index">注 {index + 1}</span>
                        <span className="slide-footnote-text">
                          <Rich text={note} />
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>
            <div className="slide-footer">
              <span>{presenter}</span>
              <span className="slide-footer-title">{plainText(project.cover.title)}</span>
              <span className="slide-footer-page">
                {page} / {total}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
