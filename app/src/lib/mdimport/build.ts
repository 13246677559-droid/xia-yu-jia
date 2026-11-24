import type { Block, BulletsBlock, Project } from "../../types";
import {
  makeBulletItem,
  makeCodeBlock,
  makeCover,
  makeCoverField,
  makeFigureBlock,
  makeReferencesBlock,
  makeSection,
  makeSlide,
  makeTableBlock,
  makeTextBlock,
  uid,
} from "../../data";
import { parseProject } from "../project/schema";
import type { MdDeck } from "./types";

export interface ImportAssetRef {
  source: string;
  targetName: string;
}

export interface BuiltImport {
  project: Project;
  assets: ImportAssetRef[];
}

function withCentered<T extends Block>(block: T, centered: boolean | undefined): T {
  if (centered !== undefined) block.centered = centered;
  return block;
}

export function buildProjectFromDeck(deck: MdDeck): BuiltImport {
  const assets: ImportAssetRef[] = [];
  const cover = makeCover(
    deck.cover.title,
    deck.cover.fields.map((field) =>
      makeCoverField(field.label, field.value, {
        size: field.size,
        showLabel: field.showLabel,
        role: field.role,
      }),
    ),
  );

  const sections = deck.sections.map((section) =>
    makeSection(
      section.title,
      section.slides.map((slide) => {
        const blocks: Block[] = [];
        const footnotes: string[] = [];
        for (const spec of slide.blocks) {
          if (spec.kind === "footnote") {
            footnotes.push(...spec.items);
            continue;
          }
          if (spec.kind === "bullets") {
            const items = spec.items.map((item) => {
              const bullet = makeBulletItem(
                item.text,
                item.notes.map((note) => note.text),
              );
              bullet.aligns = [item.center ? "center" : "left"];
              bullet.noteAligns = item.notes.map((note) => [
                note.center ? "center" : "left",
              ]);
              return bullet;
            });
            const block: BulletsBlock = {
              id: uid("block"),
              kind: "bullets",
              pane: spec.pane,
              ...(spec.title ? { title: spec.title } : {}),
              items,
            };
            blocks.push(withCentered(block, spec.centered));
            continue;
          }
          if (spec.kind === "figure") {
            const block = makeFigureBlock("", spec.caption, spec.pane);
            const extension = spec.src.split(".").pop()?.toLowerCase() ?? "png";
            block.src = `fig-${block.id}.${extension}`;
            block.scale = spec.scale;
            assets.push({ source: spec.src, targetName: block.src });
            blocks.push(withCentered(block, spec.centered));
            continue;
          }
          if (spec.kind === "table") {
            blocks.push(
              withCentered(
                makeTableBlock({
                pane: spec.pane,
                caption: spec.caption,
                header: spec.header,
                rows: spec.rows,
                aligns: spec.aligns,
                placement: spec.placement,
                firstColumnHeader: spec.firstColumnHeader,
                  scale: spec.scale,
                }),
                spec.centered,
              ),
            );
            continue;
          }
          if (spec.kind === "code") {
            blocks.push(
              withCentered(
                makeCodeBlock(spec.title ?? "", spec.code, spec.pane),
                spec.centered,
              ),
            );
            continue;
          }
          if (spec.kind === "references") {
            blocks.push(
              withCentered(
                makeReferencesBlock(
                  spec.items,
                  spec.pane,
                  spec.title ?? "参考文献",
                ),
                spec.centered,
              ),
            );
            continue;
          }
          const block = makeTextBlock(spec.kind, spec.body, spec.pane);
          if (spec.label) block.label = spec.label;
          if (spec.align) block.align = spec.align;
          blocks.push(withCentered(block, spec.centered));
        }
        const built = makeSlide(slide.title, blocks, slide.layout);
        if (footnotes.length > 0) built.footnotes = footnotes;
        return built;
      }),
    ),
  );

  const project: Project = {
    version: 1,
    id: uid("proj"),
    name: deck.project.name,
    theme: deck.project.theme,
    updated: new Date().toISOString(),
    showDots: deck.project.showDots,
    cover,
    ending: deck.ending ?? { title: "恳请各位批判指正" },
    sections,
  };
  return { project: parseProject(project), assets };
}
