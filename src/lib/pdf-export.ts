/**
 * Export a DOM node to a multi-page A4 PDF.
 * Marked worksheet questions are never split between pages.
 */
export async function exportNodeToPdf(
  node: HTMLElement,
  fileName: string,
  options?: { credit?: string },
) {
  if (typeof document !== "undefined" && document.fonts?.ready) await document.fonts.ready;

  await Promise.all(
    Array.from(node.querySelectorAll("img")).map((image) =>
      image.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            image.addEventListener("load", () => resolve(), { once: true });
            image.addEventListener("error", () => resolve(), { once: true });
          }),
    ),
  );

  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas-pro"),
    import("jspdf"),
  ]);

  const isMobile = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const scale = isMobile ? 1.5 : 2;
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 6;
  const credit = options?.credit?.trim() || "";
  const footerSpace = credit ? 9 : 0;
  const usableWidth = pageWidth - margin * 2;
  const usableHeight = pageHeight - margin * 2 - footerSpace;
  const A4_CONTENT_PX = Math.round((usableWidth / 25.4) * 96);
  const previousWidth = node.style.width;
  const previousMaxWidth = node.style.maxWidth;
  node.style.width = `${A4_CONTENT_PX}px`;
  node.style.maxWidth = `${A4_CONTENT_PX}px`;
  node.classList.add("pdf-exporting");
  void node.offsetHeight;

  const nodeRect = node.getBoundingClientRect();
  const questionBlocks = Array.from(node.querySelectorAll<HTMLElement>(".pdf-question"))
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return { top: (rect.top - nodeRect.top) * scale, bottom: (rect.bottom - nodeRect.top) * scale };
    })
    .filter((b) => b.bottom > b.top && b.bottom > 0)
    .sort((a, b) => a.top - b.top);

  let canvas: HTMLCanvasElement;
  try {
    canvas = await html2canvas(node, {
      scale,
      useCORS: true,
      backgroundColor: "#ffffff",
      width: A4_CONTENT_PX,
      windowWidth: A4_CONTENT_PX,
      foreignObjectRendering: false,
      onclone: (clonedDoc) => {
        clonedDoc.documentElement.classList.remove("dark");
        clonedDoc.body.classList.remove("dark");
        clonedDoc.body.style.background = "#ffffff";
        const style = clonedDoc.createElement("style");
        style.textContent = `
          .pdf-exporting,
          .pdf-exporting * {
            letter-spacing: normal !important;
            word-spacing: normal !important;
            font-kerning: normal !important;
            font-variant-ligatures: normal !important;
          }
          .pdf-exporting [dir="rtl"],
          .pdf-exporting .rtl {
            direction: rtl !important;
            text-align: right !important;
            unicode-bidi: isolate !important;
          }
          .pdf-exporting [dir="ltr"],
          .pdf-exporting .ltr {
            direction: ltr !important;
            text-align: left !important;
            unicode-bidi: isolate !important;
          }
          .pdf-exporting mjx-container,
          .pdf-exporting mjx-container[display="true"] {
            direction: ltr !important;
            unicode-bidi: isolate !important;
            white-space: nowrap !important;
          }
          .pdf-exporting .pdf-question {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
        `;
        clonedDoc.head.appendChild(style);
      },
    });
  } finally {
    node.classList.remove("pdf-exporting");
    node.style.width = previousWidth;
    node.style.maxWidth = previousMaxWidth;
  }

  const canvasPageHeight = (usableHeight * canvas.width) / usableWidth;
  const cuts: number[] = [0];
  let pageStart = 0;
  let guard = 0;
  while (pageStart < canvas.height && guard++ < 200) {
    const naturalEnd = pageStart + canvasPageHeight;
    if (naturalEnd >= canvas.height) break;
    const crossing = questionBlocks.find((block) => block.top > pageStart + 1 && block.top < naturalEnd && block.bottom > naturalEnd);
    const pageEnd = crossing ? crossing.top : naturalEnd;
    if (pageEnd <= pageStart + 1) break;
    cuts.push(pageEnd);
    pageStart = pageEnd;
  }

  const { getIsPremium } = await import("@/lib/premium-flag");
  const watermark = getIsPremium() ? null : "تصميم مروة أبوبكر / أكاديمية التعزيز";
  cuts.forEach((start, index) => {
    const end = cuts[index + 1] ?? canvas.height;
    const sliceHeight = Math.max(1, Math.round(end - start));
    const slice = document.createElement("canvas");
    slice.width = canvas.width;
    slice.height = sliceHeight;
    const ctx = slice.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(canvas, 0, Math.round(start), canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
    const imageHeight = (sliceHeight * usableWidth) / canvas.width;
    if (index > 0) pdf.addPage();
    pdf.addImage(slice.toDataURL("image/jpeg", 0.95), "JPEG", margin, margin, usableWidth, Math.min(imageHeight, usableHeight));
  });

  if (watermark) {
    const dpi = 4;
    const heightMm = 14;
    const probe = document.createElement("canvas").getContext("2d");
    const fontPx = Math.round(heightMm * dpi * 0.6);
    const font = `700 ${fontPx}px Cairo, Tahoma, Arial, sans-serif`;
    if (probe) probe.font = font;
    const widthMm = Math.max(40, (probe?.measureText(watermark).width ?? 300) / dpi + 6);
    const c = document.createElement("canvas");
    c.width = Math.round(widthMm * dpi);
    c.height = Math.round(heightMm * dpi);
    const ctx = c.getContext("2d");
    if (ctx) {
      ctx.font = font;
      ctx.fillStyle = "rgba(120,120,120,0.18)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(watermark, c.width / 2, c.height / 2);
      const dataUrl = c.toDataURL("image/png");
      const pageCount = pdf.getNumberOfPages();
      for (let page = 1; page <= pageCount; page++) {
        pdf.setPage(page);
        for (let row = 0; row < 5; row++) pdf.addImage(dataUrl, "PNG", (pageWidth - widthMm) / 2, 30 + row * 55, widthMm, heightMm, undefined, "NONE", -20);
      }
    }
  }

  if (credit) {
    const dpi = 4;
    const heightMm = 5;
    const c = document.createElement("canvas").getContext("2d");
    if (c) {
      const fontPx = Math.round(heightMm * dpi * 0.72);
      c.font = `600 ${fontPx}px Cairo, Tahoma, Arial, sans-serif`;
      const widthMm = Math.max(20, c.measureText(credit).width / dpi + 4);
      const canvasCredit = document.createElement("canvas");
      canvasCredit.width = Math.round(widthMm * dpi);
      canvasCredit.height = Math.round(heightMm * dpi);
      const ctx2 = canvasCredit.getContext("2d")!;
      ctx2.fillStyle = "#ffffff";
      ctx2.fillRect(0, 0, canvasCredit.width, canvasCredit.height);
      ctx2.font = `600 ${fontPx}px Cairo, Tahoma, Arial, sans-serif`;
      ctx2.fillStyle = "#6b7280";
      ctx2.textAlign = "center";
      ctx2.textBaseline = "middle";
      ctx2.fillText(credit, canvasCredit.width / 2, canvasCredit.height / 2);
      const dataUrl = canvasCredit.toDataURL("image/png");
      const pageCount = pdf.getNumberOfPages();
      for (let page = 1; page <= pageCount; page++) {
        pdf.setPage(page);
        pdf.addImage(dataUrl, "PNG", (pageWidth - widthMm) / 2, pageHeight - margin - heightMm, widthMm, heightMm);
      }
    }
  }

  const blob = pdf.output("blob");
  const safeName = fileName.toLowerCase().endsWith(".pdf") ? fileName : `${fileName}.pdf`;
  const file = new File([blob], safeName, { type: "application/pdf" });
  if (isMobile && typeof navigator !== "undefined" && typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: safeName });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safeName;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
