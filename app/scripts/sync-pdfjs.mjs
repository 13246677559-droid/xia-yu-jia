import { cpSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = resolve(root, "node_modules/pdfjs-dist");
const target = resolve(root, "public/pdfjs");

mkdirSync(target, { recursive: true });
cpSync(resolve(source, "cmaps"), resolve(target, "cmaps"), { recursive: true });
cpSync(resolve(source, "standard_fonts"), resolve(target, "standard_fonts"), {
  recursive: true,
});
