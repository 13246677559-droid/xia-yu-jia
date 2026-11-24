import { PDFDocument, rgb } from "pdf-lib";

const POINTS_PER_CM = 72 / 2.54;
const DEFAULT_MARGIN_CM = 0.5;

export interface EdgePdfOptions {
  topColor?: string;
  marginCm?: number;
}

function decodeBase64(value: string): Uint8Array {
  const payload = value.replace(/^data:[^,]*;base64,/, "");
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function hexColor(hex: string): ReturnType<typeof rgb> | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return rgb(
    ((value >> 16) & 0xff) / 255,
    ((value >> 8) & 0xff) / 255,
    (value & 0xff) / 255,
  );
}

export async function makeEdgePresentationPdf(
  base64: string,
  options: EdgePdfOptions = {},
): Promise<string> {
  const source = await PDFDocument.load(decodeBase64(base64));
  const target = await PDFDocument.create();
  const pages = await target.copyPages(source, source.getPageIndices());
  const margin = (options.marginCm ?? DEFAULT_MARGIN_CM) * POINTS_PER_CM;
  const topFill = options.topColor ? hexColor(options.topColor) : null;
  const white = rgb(1, 1, 1);

  for (const page of pages) {
    const { width, height } = page.getSize();
    page.setSize(width, height + margin * 2);
    page.setCropBox(0, 0, width, height + margin * 2);
    page.translateContent(0, margin);
    page.drawRectangle({
      x: 0,
      y: 0,
      width,
      height: margin,
      color: white,
    });
    if (topFill) {
      page.drawRectangle({
        x: 0,
        y: height + margin,
        width,
        height: margin,
        color: topFill,
      });
    }
    target.addPage(page);
  }

  return encodeBase64(await target.save());
}
