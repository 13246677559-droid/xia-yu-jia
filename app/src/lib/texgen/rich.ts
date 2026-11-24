import { parseRich, type RichNode } from "../richtext";

const escapes: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "{": "\\{",
  "}": "\\}",
  "&": "\\&",
  "%": "\\%",
  "#": "\\#",
  "$": "\\$",
  "_": "\\_",
  "^": "\\textasciicircum{}",
  "~": "\\textasciitilde{}",
};

export function escapeTex(text: string): string {
  return Array.from(text)
    .map((character) => escapes[character] ?? character)
    .join("");
}

function lineBreak(kind: "break" | "space"): string {
  return kind === "break" ? "\\\\" : " ";
}

export interface RichTexOptions {
  displayMath?: "display" | "inline";
  lineBreak?: "break" | "space";
}

function nodeToTex(node: RichNode, options: RichTexOptions): string {
  if (node.type === "text") {
    return escapeTex(node.text).replace(/\n/g, lineBreak(options.lineBreak ?? "break"));
  }
  if (node.type === "math") {
    if (node.display) {
      return options.displayMath === "inline" ? `$${node.tex}$` : `\\[${node.tex}\\]`;
    }
    return `$${node.tex}$`;
  }
  const inner = node.children.map((child) => nodeToTex(child, options)).join("");
  switch (node.mark) {
    case "emphasis":
      return `\\kw{${inner}}`;
    case "italic":
      return `\\textit{${inner}}`;
    case "underline":
      return `\\underline{${inner}}`;
    case "strike":
      return `\\xyjstrike{${inner}}`;
    case "overline":
      return `\\xyjoverline{${inner}}`;
    case "highlight":
      return `\\colorbox{xyjSoft}{${inner}}`;
    default:
      return inner;
  }
}

export function richNodesToTex(nodes: RichNode[], options: RichTexOptions = {}): string {
  return nodes.map((node) => nodeToTex(node, options)).join("");
}

export function richToTex(text: string, options: RichTexOptions = {}): string {
  return richNodesToTex(parseRich(text), options);
}

const CJK_RANGE = "\\u3400-\\u9fff\\uf900-\\ufaff";
const CJK_SPACE = new RegExp(`([${CJK_RANGE}])[ \\t]+(?=[${CJK_RANGE}])`, "g");

export function preserveCjkSpaces(tex: string): string {
  return tex.replace(CJK_SPACE, "$1\\hspace{0.5em}");
}

export function plainToTex(text: string): string {
  return preserveCjkSpaces(escapeTex(text.replace(/\n/g, " ")));
}
