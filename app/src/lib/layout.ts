import type { Block, Slide, SlideLayout } from "../types";

export const CONTENT_RECT = { left: 64, top: 146, width: 1152, height: 530 };
export const PANE_GAP = 24;
export const TABLE_TEXT_INSET = 33;

export const SLIDE_LAYOUTS: Array<{ id: SlideLayout; label: string }> = [
  { id: "full", label: "整页" },
  { id: "rows", label: "上下" },
  { id: "cols", label: "左右" },
  { id: "grid", label: "四分" },
];

const PANE_COUNTS: Record<SlideLayout, number> = {
  full: 1,
  rows: 2,
  cols: 2,
  grid: 4,
};

const PANE_LABELS: Record<SlideLayout, string[]> = {
  full: ["整页"],
  rows: ["上版", "下版"],
  cols: ["左版", "右版"],
  grid: ["左上", "右上", "左下", "右下"],
};

const LAYOUT_MAPS: Record<SlideLayout, Record<SlideLayout, number[]>> = {
  full: { full: [0], rows: [0], cols: [0], grid: [0] },
  rows: { full: [0, 0], rows: [0, 1], cols: [0, 1], grid: [0, 2] },
  cols: { full: [0, 0], rows: [0, 1], cols: [0, 1], grid: [0, 1] },
  grid: {
    full: [0, 0, 0, 0],
    rows: [0, 0, 1, 1],
    cols: [0, 1, 0, 1],
    grid: [0, 1, 2, 3],
  },
};

export function paneCount(layout: SlideLayout): number {
  return PANE_COUNTS[layout];
}

export function paneLabel(layout: SlideLayout, index: number): string {
  return PANE_LABELS[layout][index] ?? `第 ${index + 1} 版`;
}

export function paneRect(
  layout: SlideLayout,
  index: number,
  contentHeight = CONTENT_RECT.height,
): { left: number; top: number; width: number; height: number } {
  const fullWidth = CONTENT_RECT.width;
  const fullHeight = contentHeight;
  if (layout === "full") {
    return { left: 0, top: 0, width: fullWidth, height: fullHeight };
  }
  const paneWidth = (fullWidth - PANE_GAP) / 2;
  const paneHeight = (fullHeight - PANE_GAP) / 2;
  if (layout === "rows") {
    return {
      left: 0,
      top: index === 0 ? 0 : paneHeight + PANE_GAP,
      width: fullWidth,
      height: paneHeight,
    };
  }
  if (layout === "cols") {
    return {
      left: index === 0 ? 0 : paneWidth + PANE_GAP,
      top: 0,
      width: paneWidth,
      height: fullHeight,
    };
  }
  const column = index % 2;
  const row = Math.floor(index / 2);
  return {
    left: column === 0 ? 0 : paneWidth + PANE_GAP,
    top: row === 0 ? 0 : paneHeight + PANE_GAP,
    width: paneWidth,
    height: paneHeight,
  };
}

export function orderedBlocks(slide: Slide): Block[] {
  if (slide.layout === "full") return slide.blocks;
  return [...slide.blocks].sort((left, right) => left.pane - right.pane);
}

export function paneBlocks(slide: Slide): Block[][] {
  const groups: Block[][] = Array.from({ length: paneCount(slide.layout) }, () => []);
  for (const block of orderedBlocks(slide)) {
    if (groups[block.pane]) groups[block.pane].push(block);
  }
  return groups;
}

export interface RelayoutResult {
  slide: Slide;
  merged: boolean;
}

export function relayoutSlide(slide: Slide, nextLayout: SlideLayout): RelayoutResult {
  if (slide.layout === nextLayout) return { slide, merged: false };
  const sourceCount = paneCount(slide.layout);
  const sources: Block[][] = Array.from({ length: sourceCount }, () => []);
  for (const block of slide.blocks) {
    if (sources[block.pane]) sources[block.pane].push(block);
  }
  const targets: Block[][] = Array.from({ length: paneCount(nextLayout) }, () => []);
  const map = LAYOUT_MAPS[slide.layout][nextLayout];
  sources.forEach((blocks, sourceIndex) => {
    const target = map[sourceIndex] ?? 0;
    targets[target].push(...blocks);
  });
  let merged = false;
  const blocks: Block[] = [];
  targets.forEach((targetBlocks, targetIndex) => {
    targetBlocks.forEach((block) => {
      if (block.pane !== targetIndex) merged = true;
      blocks.push({ ...block, pane: targetIndex });
    });
  });
  return { slide: { ...slide, layout: nextLayout, blocks }, merged };
}
