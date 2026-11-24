import { useEffect } from "react";
import type { Project, Slide, ThemeId } from "../types";
import { PALETTES, themeVars } from "../lib/palettes";
import { Icon } from "./Icons";
import { SlidePreview } from "./SlidePreview";

interface PaletteGalleryProps {
  project: Project;
  pageKind: "cover" | "toc" | "content" | "ending";
  slide: Slide | null;
  page: number;
  total: number;
  assetUrls: Map<string, string>;
  onSelect: (theme: ThemeId) => void;
  onClose: () => void;
}

export function PaletteGallery({
  project,
  pageKind,
  slide,
  page,
  total,
  assetUrls,
  onSelect,
  onClose,
}: PaletteGalleryProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-overlay palette-overlay" onMouseDown={onClose}>
      <div
        className="palette-modal"
        role="dialog"
        aria-modal="true"
        aria-label="配色方案"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-head">
          <div>
            <h3>配色方案</h3>
            <p>点击套用；PDF 需要重新编译</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <Icon name="close" />
          </button>
        </div>
        <div className="palette-grid">
          {PALETTES.map((palette) => {
            const active = project.theme === palette.id;
            return (
              <button
                key={palette.id}
                className={`palette-card ${active ? "active" : ""}`}
                style={themeVars(palette.id)}
                onClick={() => onSelect(palette.id)}
                aria-pressed={active}
              >
                <div className="palette-preview">
                  <SlidePreview
                    project={{ ...project, theme: palette.id }}
                    pageKind={pageKind}
                    slide={slide}
                    page={page}
                    total={total}
                    assetUrls={assetUrls}
                  />
                </div>
                <div className="palette-meta">
                  <div className="palette-name">
                    <span>{palette.name}</span>
                    {active && <Icon name="check" size={14} />}
                  </div>
                  <div className="palette-swatches" aria-hidden="true">
                    <i style={{ background: palette.primary }} />
                    <i style={{ background: palette.accent }} />
                    <i style={{ background: palette.tint }} />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
