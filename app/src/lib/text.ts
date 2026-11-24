import type { Block } from "../types";
import { richToPlain } from "./richtext";

export function plainText(text: string): string {
  return richToPlain(text).replace(/\n/g, " ");
}

export function stripCaptionNumber(kind: "图" | "表", text: string): string {
  return text.replace(new RegExp(`^${kind}\\s*\\d+\\s*`), "").replace(/^\s+/, "");
}

export function hasVisibleRich(text: string): boolean {
  return richToPlain(text).replace(/[\s​-‍﻿]/g, "").length > 0;
}

export function blockHasVisibleContent(block: Block): boolean {
  if (block.kind === "bullets") {
    return block.items.some((item) => hasVisibleRich(item.text));
  }
  if (block.kind === "figure") {
    return block.src.trim().length > 0;
  }
  if (block.kind === "table") {
    return block.rows.some((row) => row.some(hasVisibleRich));
  }
  if (block.kind === "code") {
    return block.code.trim().length > 0 || hasVisibleRich(block.title ?? "");
  }
  if (block.kind === "references") {
    return (
      hasVisibleRich(block.title ?? "") ||
      block.items.some((item) => hasVisibleRich(item))
    );
  }
  return hasVisibleRich(block.body);
}
