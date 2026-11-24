import { memo, useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy } from "pdfjs-dist";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

function base64Bytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

interface PdfPreviewProps {
  pdf: string | null;
  page: number;
  onPageCount?: (count: number) => void;
}

export const PdfPreview = memo(function PdfPreview({ pdf, page, onPageCount }: PdfPreviewProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [width, setWidth] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const update = () => setWidth(element.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdf) {
      setDocument(null);
      return;
    }
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;
    setError(null);
    pdfjs
      .getDocument({
        data: base64Bytes(pdf),
        isEvalSupported: false,
        cMapUrl: "/pdfjs/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: "/pdfjs/standard_fonts/",
      })
      .promise.then((next) => {
        loaded = next;
        if (cancelled) {
          void next.destroy();
          return;
        }
        setDocument(next);
        onPageCount?.(next.numPages);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "PDF 无法载入");
        }
      });
    return () => {
      cancelled = true;
      if (loaded) void loaded.destroy();
    };
  }, [pdf, onPageCount]);

  useEffect(() => {
    const current = document;
    const canvas = canvasRef.current;
    const container = viewportRef.current;
    if (!current || !canvas || !container || width <= 0) return;
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    setRendering(true);
    const pageNumber = Math.min(Math.max(1, page), current.numPages);
    current
      .getPage(pageNumber)
      .then((pdfPage) => {
        if (cancelled) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const scale = width / base.width;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = pdfPage.getViewport({ scale: scale * dpr });
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        canvas.style.width = `${Math.round(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.round(viewport.height / dpr)}px`;
        const context = canvas.getContext("2d");
        if (!context) return;
        const renderTask = pdfPage.render({
          canvasContext: context,
          viewport,
        });
        task = renderTask;
        return renderTask.promise;
      })
      .then(() => {
        if (!cancelled) setRendering(false);
      })
      .catch((reason) => {
        if (cancelled || (reason && reason.name === "RenderingCancelledException")) return;
        setRendering(false);
        setError(reason instanceof Error ? reason.message : "页面渲染失败");
      });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [document, page, width]);

  return (
    <div className="pdf-viewport" ref={viewportRef}>
      {!pdf && <div className="pdf-placeholder">等待编译</div>}
      {pdf && (rendering || !document) && !error && (
        <div className="pdf-placeholder">正在渲染</div>
      )}
      {error && <div className="pdf-placeholder">{error}</div>}
      <canvas ref={canvasRef} className={pdf && !error ? "pdf-canvas" : "pdf-canvas hidden"} />
    </div>
  );
});
