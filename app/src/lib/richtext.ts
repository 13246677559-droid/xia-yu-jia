export type RichMark =
  | "emphasis"
  | "italic"
  | "underline"
  | "strike"
  | "overline"
  | "highlight";

export type RichNode =
  | { type: "text"; text: string }
  | { type: "math"; tex: string; display: boolean }
  | { type: "mark"; mark: RichMark; children: RichNode[] };

const MARKERS: Array<{ token: string; mark: RichMark }> = [
  { token: "**", mark: "emphasis" },
  { token: "__", mark: "underline" },
  { token: "~~", mark: "strike" },
  { token: "^^", mark: "overline" },
  { token: "==", mark: "highlight" },
  { token: "//", mark: "italic" },
];

function findClosing(text: string, from: number, token: string): number {
  return text.indexOf(token, from);
}

function parseSegment(text: string): RichNode[] {
  const nodes: RichNode[] = [];
  let buffer = "";
  let index = 0;

  const flush = () => {
    if (buffer) {
      nodes.push({ type: "text", text: buffer });
      buffer = "";
    }
  };

  while (index < text.length) {
    if (text.startsWith("$$", index)) {
      const close = findClosing(text, index + 2, "$$");
      if (close >= 0) {
        flush();
        const tex = text.slice(index + 2, close).trim();
        if (tex) nodes.push({ type: "math", tex, display: true });
        index = close + 2;
        continue;
      }
    }
    if (text[index] === "$") {
      const close = findClosing(text, index + 1, "$");
      if (close >= 0) {
        flush();
        const tex = text.slice(index + 1, close).trim();
        if (tex) nodes.push({ type: "math", tex, display: false });
        index = close + 1;
        continue;
      }
    }

    let matched = false;
    for (const marker of MARKERS) {
      if (!text.startsWith(marker.token, index)) continue;
      const close = findClosing(text, index + marker.token.length, marker.token);
      if (close < 0) continue;
      flush();
      nodes.push({
        type: "mark",
        mark: marker.mark,
        children: parseSegment(text.slice(index + marker.token.length, close)),
      });
      index = close + marker.token.length;
      matched = true;
      break;
    }
    if (matched) continue;

    buffer += text[index];
    index += 1;
  }

  flush();
  return nodes;
}

export function parseRich(text: string): RichNode[] {
  return parseSegment(text);
}

function plainNodes(nodes: RichNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text") return node.text;
      if (node.type === "math") return node.display ? `$$${node.tex}$$` : `$${node.tex}$`;
      return plainNodes(node.children);
    })
    .join("");
}

export function richToPlain(text: string): string {
  return plainNodes(parseRich(text));
}

export function splitRichLines(nodes: RichNode[]): RichNode[][] {
  const lines: RichNode[][] = [[]];

  const walk = (items: RichNode[]) => {
    items.forEach((node) => {
      if (node.type === "text") {
        const parts = node.text.split("\n");
        parts.forEach((part, index) => {
          if (part) lines[lines.length - 1].push({ type: "text", text: part });
          if (index < parts.length - 1) lines.push([]);
        });
        return;
      }
      if (node.type === "math") {
        lines[lines.length - 1].push(node);
        return;
      }
      const childLines = splitRichLines(node.children);
      childLines.forEach((childLine, index) => {
        if (index > 0) lines.push([]);
        if (childLine.length > 0) {
          lines[lines.length - 1].push({
            type: "mark",
            mark: node.mark,
            children: childLine,
          });
        }
      });
    });
  };

  walk(nodes);
  return lines;
}
