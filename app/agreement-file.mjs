export const MAX_AGREEMENT_BYTES = 12 * 1024 * 1024;
export const MAX_AGREEMENT_TEXT = 100_000;

function checkedText(text) {
  const value = text.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "");
  if (!value.trim()) throw Error("This file contains no readable agreement text.");
  if (value.includes("\0")) throw Error("This is not a readable text file. Choose a PDF or UTF-8 text file.");
  if (value.length > MAX_AGREEMENT_TEXT) throw Error("This agreement exceeds 100,000 characters. Import a complete agreement within that limit.");
  return value;
}

export function pageText(items) {
  let text = "", previous = null;
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    if (previous && item.str && !/\s$/.test(text)) {
      const a = previous.transform, b = item.transform;
      const height = Math.max(Math.abs(a?.[3] ?? 0), Math.abs(b?.[3] ?? 0), 1);
      if (a && b && Math.abs(a[5] - b[5]) > height * .45) text += "\n";
      else if (!a || !b || b[4] - (a[4] + previous.width) > height * .12) text += " ";
    }
    text += item.str;
    if (item.hasEOL && !text.endsWith("\n")) text += "\n";
    previous = item;
  }
  return text.trim();
}

export async function extractAgreement(file, { signal, progress = () => {} } = {}) {
  if (!file || !Number.isSafeInteger(file.size) || file.size === 0) throw Error("Choose a file containing the agreement.");
  if (file.size > MAX_AGREEMENT_BYTES) throw Error("Choose an agreement file no larger than 12 MB.");
  signal?.throwIfAborted();
  const word = /\.docx$/i.test(file.name);
  const pdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
  if (!pdf && !word && !/\.(txt|md)$/i.test(file.name)) throw Error("Choose a PDF, Word DOCX, TXT or Markdown agreement.");
  const data = await file.arrayBuffer();
  signal?.throwIfAborted();
  if (word) {
    const { wordText } = await import("./agreement-word.mjs");
    return { text: checkedText(await wordText(data, { signal })), pages: null, name: file.name };
  }
  if (!pdf) {
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(data); }
    catch { throw Error("This text file is not UTF-8. Save it as UTF-8 or choose a PDF."); }
    return { text: checkedText(text), pages: null, name: file.name };
  }
  const pdfjs = await import("./vendor/pdfjs/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.mjs", import.meta.url).href;
  signal?.throwIfAborted();
  const task = pdfjs.getDocument({
    data: new Uint8Array(data), isEvalSupported: false, disableFontFace: true,
    useSystemFonts: false, stopAtErrors: true,
    cMapUrl: new URL("./vendor/pdfjs/cmaps/", import.meta.url).href, cMapPacked: true,
    standardFontDataUrl: new URL("./vendor/pdfjs/standard_fonts/", import.meta.url).href
  });
  const abort = () => { task.destroy(); };
  signal?.addEventListener("abort", abort, { once: true });
  task.onPassword = () => { task.destroy(); };
  try {
    const document = await task.promise;
    if (document.numPages > 200) throw Error("Choose a complete agreement with no more than 200 pages.");
    const pages = [], unreadable = [];
    let length = 0;
    for (let i = 1; i <= document.numPages; i++) {
      signal?.throwIfAborted();
      progress(i, document.numPages);
      const page = await document.getPage(i);
      const content = await page.getTextContent();
      const text = pageText(content.items);
      if (!text.trim()) unreadable.push(i);
      pages.push(text); length += text.length + 2;
      page.cleanup();
      if (length > MAX_AGREEMENT_TEXT) throw Error("This agreement exceeds 100,000 characters. Import a complete agreement within that limit.");
    }
    if (unreadable.length) throw Error("No readable text on PDF page" + (unreadable.length === 1 ? " " : "s ") + unreadable.join(", ") + ". Choose a text PDF or paste the complete agreement.");
    return { text: checkedText(pages.join("\n\n")), pages: document.numPages, name: file.name };
  } catch (error) {
    signal?.throwIfAborted();
    if (error?.name === "PasswordException" || /password|destroyed/i.test(error?.message ?? "")) throw Error("This PDF is password protected. Choose an unlocked copy.");
    if (error?.name === "InvalidPDFException" || error?.name === "UnknownErrorException") throw Error("This PDF could not be read. Choose another copy or paste the agreement text.");
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    await task.destroy();
  }
}
