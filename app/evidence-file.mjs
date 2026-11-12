import { identifySource } from "./source-identity.mjs";

// The record stores a precise byte count, not file contents. Reads use bounded
// chunks; the former 25 MiB whole-buffer restriction is no longer necessary.
export const MAX_EVIDENCE_FILE_BYTES = Number.MAX_SAFE_INTEGER;

export function validateFileFingerprint(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(key => !["algorithm", "sha256", "bytes", "name"].includes(key)) ||
      value.algorithm !== "SHA-256" || typeof value.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.sha256) ||
      !Number.isSafeInteger(value.bytes) || value.bytes < 0 ||
      value.bytes > MAX_EVIDENCE_FILE_BYTES ||
      typeof value.name !== "string" || !value.name.trim() || value.name.length > 255)
    throw new Error("Invalid evidence file fingerprint.");
  return value;
}

export async function fingerprintFile(file, { signal, onProgress } = {}) {
  if (!file || !Number.isSafeInteger(file.size) || file.size < 0 ||
      file.size > MAX_EVIDENCE_FILE_BYTES)
    throw new Error("Choose a local file with an exact byte count.");
  const result = await identifySource(file, globalThis.crypto, { signal, onProgress });
  return validateFileFingerprint({
    algorithm: "SHA-256", sha256: result.sha256, bytes: result.byte_length, name: file.name
  });
}

export function compareFileFingerprint(recorded, candidate) {
  validateFileFingerprint(recorded); validateFileFingerprint(candidate);
  return recorded.sha256 === candidate.sha256 && recorded.bytes === candidate.bytes;
}

const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
};
const fileSize = bytes => {
  if (bytes < 1024) return bytes.toLocaleString() + (bytes === 1 ? " byte" : " bytes");
  for (const [size, unit] of [[1024 ** 3, "GiB"], [1024 ** 2, "MiB"], [1024, "KiB"]]) {
    if (bytes >= size) return (bytes / size).toLocaleString(undefined, { maximumFractionDigits: 1 }) + " " + unit;
  }
};
function fileProgress() {
  const row = node("div", null, "file-progress");
  const meter = node("progress");
  meter.setAttribute("aria-label", "File bytes checked");
  const label = node("span"); label.setAttribute("aria-hidden", "true");
  row.append(meter, label); row.hidden = true;
  return {
    row,
    hide() { row.hidden = true; meter.value = 0; },
    update({ bytesRead, totalBytes }) {
      row.hidden = false; meter.max = totalBytes || 1; meter.value = bytesRead;
      const text = fileSize(bytesRead) + " of " + fileSize(totalBytes);
      label.textContent = text; meter.setAttribute("aria-valuetext", text);
    }
  };
}

export function mountEvidenceFile(form) {
  const panel = node("fieldset", null, "evidence-file");
  panel.append(node("legend", "Identify an evidence file (optional)"));
  const label = node("label", "Choose the exact file you reviewed");
  const input = node("input"); input.type = "file"; input.id = "evidence-file";
  label.htmlFor = input.id; label.append(input);
  const status = node("p", "No file fingerprint selected.", "muted");
  status.setAttribute("role", "status");
  const progress = fileProgress();
  const clear = node("button", "Remove selected fingerprint");
  clear.type = "button"; clear.hidden = true;
  panel.append(label,
    node("p", "Your file stays on this device. PACT records its name, size and SHA-256 fingerprint, not its contents.", "muted"),
    status, progress.row, clear,
    node("p", "A fingerprint identifies bytes, not authorship or acceptance. Saved with the evidence; reselect the file after reopening an unfinished draft.", "muted"));
  form.insertBefore(panel, form.lastElementChild);

  let selected = null, busy = false, generation = 0, controller = null;
  const submit = form.querySelector('button[type="submit"]'), submitLabel = submit?.textContent;
  const setBusy = value => {
    busy = value;
    if (submit) {
      submit.disabled = value;
      submit.textContent = value ? "Checking selected file…" : submitLabel;
    }
  };
  const reset = (message = "No file fingerprint selected.") => {
    generation++; controller?.abort(); controller = null;
    selected = null; setBusy(false); input.value = "";
    status.textContent = message; progress.hide(); clear.hidden = true;
    panel.removeAttribute("aria-busy");
  };
  clear.addEventListener("click", () => {
    reset(busy ? "File check stopped. No fingerprint will be recorded." : "No file fingerprint selected.");
    input.focus();
  });
  form.addEventListener("reset", () => reset());
  input.addEventListener("change", async () => {
    const current = ++generation, file = input.files?.[0];
    controller?.abort(); controller = null; selected = null; progress.hide();
    if (!file) { reset(); return; }
    const active = new AbortController(); controller = active;
    setBusy(true); clear.hidden = false; clear.textContent = "Cancel file check";
    panel.setAttribute("aria-busy", "true");
    status.textContent = "Reading " + file.name + " on this device…";
    try {
      const result = await fingerprintFile(file, {
        signal: active.signal,
        onProgress: value => { if (current === generation) progress.update(value); }
      });
      if (current !== generation || active.signal.aborted) return;
      selected = result;
      status.textContent = result.name + " · " + fileSize(result.bytes) + " · SHA-256 " + result.sha256;
    } catch (error) {
      if (current === generation)
        status.textContent = error.name === "AbortError" ? "File check stopped. No fingerprint will be recorded." : error.message;
    } finally {
      if (current === generation) {
        setBusy(false); controller = null; panel.removeAttribute("aria-busy"); progress.hide();
        clear.textContent = selected ? "Remove selected fingerprint" : "Remove file selection";
        clear.hidden = !input.files?.length;
      }
    }
  });
  return {
    draft() {
      if (busy) throw new Error("Wait for the selected file fingerprint to finish before recording evidence.");
      if (input.files?.length && !selected)
        throw new Error("Choose a readable file or remove the file selection before recording evidence.");
      return selected ? { ...selected } : null;
    }
  };
}

export function renderEvidenceFile(evidence, { compact = false, preview = false, source = false, onMatch = () => {} } = {}) {
  if (!evidence.fileFingerprint) return null;
  const recorded = validateFileFingerprint(evidence.fileFingerprint);
  const box = node("section", null, "evidence-file recorded-file");
  if (!compact) box.append(node("h4", "Recorded file fingerprint"));
  box.append(node("p", recorded.name + " · " + fileSize(recorded.bytes)));
  if (compact) {
    box.classList.add("file-compact");
    const identity = node("details"); identity.append(node("summary", "File identity"), node("code", recorded.sha256)); box.append(identity);
  } else box.append(node("code", recorded.sha256));
  const label = node("label", compact ? "Choose your copy" : "Check a file against this record"), input = node("input");
  input.type = "file"; input.setAttribute("aria-label", "Check file for " + recorded.name); label.append(input);
  const status = node("p", compact ? (source ? "Match the original agreement file." : "Compare it with the recorded delivery.") : "Choose a local file to compare its bytes. Nothing is uploaded, accepted or paid.", "muted");
  status.setAttribute("role", "status");
  const progress = fileProgress();
  const cancel = node("button", "Cancel file comparison");
  cancel.type = "button"; cancel.hidden = true;
  box.append(label, status, progress.row, cancel);
  let comparison = null, summary = null;
  if (compact) {
    comparison = node("details"); comparison.open = true;
    summary = node("summary", recorded.name + " · compare file");
    comparison.append(summary, ...Array.from(box.childNodes)); box.append(comparison);
  }
  const visual = preview ? node("figure", null, "delivery-preview") : null;
  if (visual) { visual.hidden = true; box.append(visual); }
  let previewUrl = null, closeInspection = null, clearDocument = null, clearMedia = null;
  const clearPreview = () => {
    onMatch(null);
    clearDocument?.(); clearDocument = null;
    clearMedia?.(); clearMedia = null;
    closeInspection?.();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    if (visual) { visual.replaceChildren(); visual.hidden = true; }
  };
  const showPdfPreview = async (file, current) => {
    if (!visual || file.size > 12 * 1024 * 1024) return;
    visual.hidden = false;
    const notice = node("p", "Opening PDF…"); notice.setAttribute("role", "status");
    visual.append(notice);
    let task = null, pdf = null, stopped = false, renderTask = null, renderVersion = 0;
    let pageNumber = 1, inspection = null, textTask = null;
    let findVersion=0, findQuery="", matches=[], matchIndex=-1, findUI=null;
    const pageTexts=new Map();
    const normalizeFind=value=>value.toLowerCase().replace(/\s+/gu," ").trim();
    const occurrences=(text,query)=>{
      const found=[];let from=0,index;
      while(query && (index=text.indexOf(query,from))!==-1 && found.length<1000){found.push(index);from=index+query.length;}
      return found;
    };
    const markMatch=()=>{
      const layer=inspection?.querySelector(".delivery-pdf-text");if(!layer)return;
      const spans=[...layer.querySelectorAll("span[role=presentation]")].filter(s=>!s.querySelector("span"));
      for(const span of spans)span.classList.remove("delivery-pdf-match");
      const match=matches[matchIndex];if(!match||match.page!==pageNumber)return;
      let text="";const ranges=[];
      for(const span of spans){const value=normalizeFind(span.textContent);if(!value)continue;if(text)text+=" ";const start=text.length;text+=value;ranges.push({span,start,end:text.length});}
      const start=occurrences(text,findQuery)[match.occurrence];if(start===undefined)return;
      const selected=ranges.filter(r=>r.end>start&&r.start<start+findQuery.length);
      for(const r of selected)r.span.classList.add("delivery-pdf-match");
      selected[0]?.span.scrollIntoView({block:"center",inline:"nearest"});
    };
    const active = () => !stopped && current === generation && box.isConnected;
    const dispose = () => {
      if (stopped) return;
      stopped = true; findVersion++; renderVersion++; renderTask?.cancel(); textTask?.cancel();
      inspection?.close(); inspection?.remove(); observer.disconnect();
      void task?.destroy().catch(() => {});
    };
    const observer = new MutationObserver(() => { if (!box.isConnected) dispose(); });
    observer.observe(document.body, {childList:true, subtree:true});
    clearDocument = dispose;
    try {
      const pdfjs = await import("./vendor/pdfjs/pdf.mjs");
      if (!active()) return;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.mjs", import.meta.url).href;
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!active()) return;
      task = pdfjs.getDocument({data:bytes, isEvalSupported:false, disableFontFace:true,
        useSystemFonts:false, stopAtErrors:true,
        cMapUrl:new URL("./vendor/pdfjs/cmaps/",import.meta.url).href, cMapPacked:true,
        standardFontDataUrl:new URL("./vendor/pdfjs/standard_fonts/",import.meta.url).href});
      task.onPassword = () => { notice.textContent = "Choose an unlocked PDF to inspect its pages."; void task.destroy(); };
      pdf = await task.promise;
      if (!active()) return;
      if (pdf.numPages > 200) throw Error("Open this PDF in your document app to inspect all its pages.");
      const canvas = node("canvas", null, "delivery-pdf-page");
      canvas.setAttribute("role", "img");
      const toolbar = node("div", null, "delivery-pdf-tools");
      const pageControl = () => {
        const label = node("label", "Page ", "delivery-pdf-page-control");
        const input = node("input"); input.type="number"; input.min="1";
        input.max=String(pdf.numPages); input.step="1"; input.inputMode="numeric";
        input.value=String(pageNumber); input.setAttribute("aria-label","PDF page");
        const total=node("span"," of "+pdf.numPages);
        const jump=()=>{
          if(!input.checkValidity() || !Number.isInteger(input.valueAsNumber)) {
            input.setCustomValidity("Enter a page from 1 to "+pdf.numPages+".");
            input.reportValidity(); return;
          }
          pageNumber=input.valueAsNumber; void render();
        };
        input.addEventListener("input",()=>input.setCustomValidity(""));
        input.addEventListener("change",jump);
        input.addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();jump();}});
        label.append(input,total); return label;
      };
      const count = pageControl();
      const previous = node("button", "Previous"), next = node("button", "Next");
      previous.type = next.type = "button";
      const inspect = node("button", "Inspect PDF", "delivery-inspect"); inspect.type = "button";
      toolbar.append(previous, count, next);
      visual.replaceChildren(toolbar, canvas, inspect, notice, node("figcaption", file.name));
      let zoom = null, renderedScale = 1;
      const render = async () => {
        const version = ++renderVersion;
        textTask?.cancel(); textTask=null;
        const previousRender = renderTask; previousRender?.cancel();
        if (previousRender) await previousRender.promise.catch(() => {});
        if (!active() || version !== renderVersion) return;
        const target = inspection?.querySelector("canvas") || canvas;
        const textLayer=inspection?.querySelector(".delivery-pdf-text");
        textLayer?.replaceChildren();
        try {
          const page = await pdf.getPage(pageNumber);
          if (!active() || version !== renderVersion) return;
          const base = page.getViewport({scale:1});
          const viewport = inspection?.querySelector(".delivery-image-viewport");
          const fit = viewport
            ? Math.min(1, (viewport.clientWidth - 24) / base.width, (viewport.clientHeight - 24) / base.height)
            : Math.min(1, Math.max(240, visual.clientWidth - 24) / base.width, 360 / base.height);
          const scale = viewport && zoom !== null ? zoom : fit;
          renderedScale = scale;
          const width = base.width * scale, height = base.height * scale;
          const density = Math.min(devicePixelRatio || 1, 2, Math.sqrt(4000000 / (width * height)));
          const view = page.getViewport({scale:scale * density});
          target.width = Math.ceil(view.width); target.height = Math.ceil(view.height);
          target.style.width = width + "px"; target.style.height = height + "px";
          target.setAttribute("aria-label", file.name + ", page " + pageNumber + " of " + pdf.numPages);
          target.dataset.page = ""; notice.textContent = "Rendering page " + pageNumber + "…";
          renderTask = page.render({canvasContext:target.getContext("2d"),viewport:view});
          await renderTask.promise;
          if (!active() || version !== renderVersion) return;
          if(textLayer) {
            const sheet=inspection.querySelector(".delivery-pdf-sheet");
            sheet.style.width=width+"px";sheet.style.height=height+"px";
            const textView=page.getViewport({scale});
            textLayer.style.setProperty("--total-scale-factor",String(scale*textView.userUnit));
            textLayer.setAttribute("aria-label","Page "+pageNumber+" text");
            textTask=new pdfjs.TextLayer({textContentSource:page.streamTextContent({includeMarkedContent:true}),container:textLayer,viewport:textView});
            try { await textTask.render(); }
            catch(error) { if(active()&&version===renderVersion)textLayer.replaceChildren(); }
            if(!active()||version!==renderVersion)return;
          }
          target.dataset.page = String(pageNumber); notice.textContent = "";
          markMatch();
          count.querySelector("input").value = String(pageNumber);
          count.querySelector("input").setCustomValidity("");
          previous.disabled = pageNumber === 1; next.disabled = pageNumber === pdf.numPages;
          if (inspection) {
            inspection.querySelector(".delivery-pdf-page-control input").value = String(pageNumber);
            inspection.querySelector(".delivery-pdf-page-control input").setCustomValidity("");
            inspection.querySelector("[data-previous]").disabled = previous.disabled;
            inspection.querySelector("[data-next]").disabled = next.disabled;
          }
          page.cleanup();
        } catch (error) {
          if (active() && version === renderVersion && error.name !== "RenderingCancelledException")
            notice.textContent = "This page could not be displayed. Open your local PDF to inspect it.";
        }
      };
      const showMatch=async(delta=0)=>{
        if(!inspection||!matches.length)return;
        matchIndex=(matchIndex+delta+matches.length)%matches.length;
        const match=matches[matchIndex];
        findUI.status.textContent=(matchIndex+1)+" of "+matches.length+(matches.length===1000?"+":"");
        pageNumber=match.page;await render();
      };
      const find=async()=>{
        const version=++findVersion,dialog=inspection,query=normalizeFind(findUI.input.value);
        findQuery=query;matches=[];matchIndex=-1;markMatch();
        findUI.previous.disabled=findUI.next.disabled=true;
        if(!query){findUI.status.textContent="";return;}
        try{
          for(let n=1;n<=pdf.numPages;n++){
            if(!active()||inspection!==dialog||version!==findVersion)return;
            findUI.status.textContent="Searching "+n+" of "+pdf.numPages+"…";
            if(!pageTexts.has(n)){
              const page=await pdf.getPage(n),content=await page.getTextContent();
              if(!active()||inspection!==dialog||version!==findVersion)return;
              pageTexts.set(n,normalizeFind(content.items.filter(i=>typeof i.str==="string").map(i=>i.str).join(" ")));
            }
            occurrences(pageTexts.get(n),query).forEach((_,occurrence)=>{if(matches.length<1000)matches.push({page:n,occurrence});});
            if(matches.length===1000)break;
          }
          if(!active()||inspection!==dialog||version!==findVersion)return;
          findUI.previous.disabled=findUI.next.disabled=!matches.length;
          if(!matches.length){findUI.status.textContent="No matches";return;}
          matchIndex=matches.findIndex(m=>m.page>=pageNumber);if(matchIndex<0)matchIndex=0;
          await showMatch();
        }catch{
          if(active()&&inspection===dialog&&version===findVersion)findUI.status.textContent="Text search unavailable";
        }
      };
      const move = delta => { pageNumber = Math.max(1, Math.min(pdf.numPages, pageNumber + delta)); void render(); };
      previous.addEventListener("click", () => move(-1)); next.addEventListener("click", () => move(1));
      inspect.addEventListener("click", () => {
        inspection = node("dialog", null, "delivery-image-dialog delivery-pdf-dialog");
        inspection.setAttribute("aria-label", "Inspect " + file.name);
        const tools = node("div", null, "delivery-image-tools");
        const viewport = node("div", null, "delivery-image-viewport"); viewport.tabIndex = 0;
        viewport.setAttribute("aria-label", "PDF page. Scroll to inspect when zoomed.");
        const detail = node("canvas"); detail.setAttribute("role", "img");
        const sheet=node("div",null,"delivery-pdf-sheet");
        const textLayer=node("div",null,"delivery-pdf-text");
        textLayer.setAttribute("role","document");
        sheet.append(detail,textLayer);viewport.append(sheet);
        const control = (label, action) => { const b=node("button",label);b.type="button";b.addEventListener("click",action);tools.append(b);return b; };
        control("Previous",()=>move(-1)).dataset.previous="";
        tools.append(pageControl());
        control("Next",()=>move(1)).dataset.next="";
        control("Fit",()=>{zoom=null;void render();});
        control("100%",()=>{zoom=1;void render();});
        control("+",()=>{zoom=Math.min(4,renderedScale*1.5);void render();}).setAttribute("aria-label","Zoom in");
        control("−",()=>{zoom=Math.max(Number.EPSILON,renderedScale/1.5);void render();}).setAttribute("aria-label","Zoom out");
        control("Close",()=>inspection.close());
        const search=node("form",null,"delivery-pdf-find");
        const input=node("input");input.type="search";input.placeholder="Find in PDF";input.maxLength=200;input.setAttribute("aria-label","Find in PDF");
        const submit=node("button","Find");submit.type="submit";
        const before=node("button","↑"),after=node("button","↓");
        before.type=after.type="button";before.setAttribute("aria-label","Previous match");after.setAttribute("aria-label","Next match");
        before.disabled=after.disabled=true;
        const status=node("output");status.setAttribute("aria-live","polite");
        findUI={input,status,previous:before,next:after};findQuery="";matches=[];matchIndex=-1;
        search.append(input,submit,before,after,status);
        search.addEventListener("submit",event=>{event.preventDefault();if(normalizeFind(input.value)===findQuery&&matches.length)void showMatch(1);else void find();});
        input.addEventListener("input",()=>{findVersion++;matches=[];matchIndex=-1;findQuery="";status.textContent="";before.disabled=after.disabled=true;markMatch();});
        input.addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();if(normalizeFind(input.value)===findQuery&&matches.length)void showMatch(event.shiftKey?-1:1);else void find();}});
        before.addEventListener("click",()=>void showMatch(-1));after.addEventListener("click",()=>void showMatch(1));
        inspection.addEventListener("keydown",event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="f"){event.preventDefault();input.focus();input.select();}});
        inspection.append(tools,search,viewport);document.body.append(inspection);
        let viewportSize="";
        const resize=new ResizeObserver(()=>{
          const size=viewport.clientWidth+"x"+viewport.clientHeight;
          if(size!==viewportSize){viewportSize=size;if(inspection&&zoom===null)void render();}
        });
        resize.observe(viewport);
        inspection.addEventListener("close",()=>{
          resize.disconnect();
          const old=inspection;inspection=null;old?.remove();zoom=null;findVersion++;findUI=null;matches=[];matchIndex=-1;
          if(active()){void render();inspect.focus();}
        },{once:true});
        inspection.showModal();void render();
      });
      await render();
    } catch (error) {
      if (active() && !notice.textContent.includes("unlocked"))
        notice.textContent = "This PDF could not be displayed. Open your local copy to inspect it.";
      void task?.destroy().catch(() => {});
    }
  };
  const showMediaPreview = (file, current, kind) => {
    if (!visual) return;
    const player = node(kind);
    if (kind === "video") player.playsInline = true;
    player.controls = true; player.preload = "metadata";
    player.setAttribute("aria-label", (kind === "video" ? "Watch " : "Listen to ") + file.name);
    const url = URL.createObjectURL(file);
    let stopped = false;
    const dispose = () => {
      if (stopped) return;
      stopped = true; observer.disconnect();
      window.removeEventListener("pagehide", dispose);
      player.pause(); player.removeAttribute("src"); player.load();
      URL.revokeObjectURL(url);
    };
    const observer = new MutationObserver(() => { if (!box.isConnected) dispose(); });
    observer.observe(document.body, {childList:true, subtree:true});
    window.addEventListener("pagehide", dispose, {once:true});
    clearMedia = dispose;
    const message = node("p", "", "muted"); message.hidden = true;
    message.setAttribute("role", "status");
    player.addEventListener("error", () => {
      if (stopped || current !== generation) return;
      message.textContent = kind === "video" ? "This browser cannot play this video. Open your local copy to watch." : "This browser cannot play this audio. Open your local copy to listen.";
      message.hidden = false;
    });
    player.src = url;
    visual.replaceChildren(player, message, node("figcaption", file.name));
    visual.hidden = false;
  };
  const showPreview = (file, current) => {
    if (/^video\/(mp4|webm|ogg|quicktime)$/i.test(file.type) || /\.(mp4|m4v|webm|ogv|mov)$/i.test(file.name)) { showMediaPreview(file, current, "video"); return; }
    if (/^audio\/(mpeg|mp3|mp4|aac|ogg|wav|x-wav|wave|webm|flac|x-flac)$/i.test(file.type) || /\.(mp3|m4a|aac|ogg|oga|wav|flac|opus|weba)$/i.test(file.name)) { showMediaPreview(file, current, "audio"); return; }
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) { void showPdfPreview(file, current); return; }
    if (!visual || file.size > 10 * 1024 * 1024 ||
        !/^image\/(png|jpeg|gif|webp|avif|svg\+xml)$/.test(file.type)) return;
    const image = node("img");
    image.alt = (source ? "Original agreement: " : "Selected delivery: ") + file.name;
    const url = URL.createObjectURL(file); previewUrl = url;
    image.onload = () => {
      URL.revokeObjectURL(url);
      if (previewUrl === url) previewUrl = null;
      if (current !== generation || !box.isConnected) return;
      visual.hidden = false;
    };
    image.onerror = () => { URL.revokeObjectURL(url); if (current === generation) clearPreview(); };
    const inspect = node("button", "Inspect image", "delivery-inspect");
    inspect.type = "button";
    inspect.addEventListener("click", () => {
      const dialog = node("dialog", null, "delivery-image-dialog");
      dialog.setAttribute("aria-label", "Inspect " + file.name);
      const toolbar = node("div", null, "delivery-image-tools");
      const viewport = node("div", null, "delivery-image-viewport");
      viewport.tabIndex = 0;
      viewport.setAttribute("aria-label", "Image. Scroll to inspect when zoomed.");
      const detail = node("img"); detail.alt = image.alt;
      const detailUrl = URL.createObjectURL(file);
      let scale = 1, fitMode = true;
      const percent = node("output");
      const apply = (value, fitting = false) => {
        fitMode = fitting;
        scale = Math.max(fitting ? Number.EPSILON : .05, Math.min(4, value));
        detail.style.width = Math.round(image.naturalWidth * scale) + "px";
        detail.style.height = Math.round(image.naturalHeight * scale) + "px";
        percent.textContent = Math.round(scale * 100) + "%";
      };
      const control = (label, action) => {
        const button = node("button", label); button.type = "button";
        button.addEventListener("click", action); toolbar.append(button); return button;
      };
      const fit = () => apply(Math.min(1, Math.max(1, viewport.clientWidth - 24) / image.naturalWidth, Math.max(1, viewport.clientHeight - 24) / image.naturalHeight), true);
      control("Fit", fit);
      control("100%", () => apply(1));
      control("−", () => apply(scale / 1.5)).setAttribute("aria-label", "Zoom out");
      control("+", () => apply(scale * 1.5)).setAttribute("aria-label", "Zoom in");
      toolbar.append(percent);
      control("Close", () => dialog.close());
      viewport.append(detail); dialog.append(toolbar, viewport);
      document.body.append(dialog);
      const resize = new ResizeObserver(() => { if (fitMode && detail.complete && detail.naturalWidth) fit(); });
      resize.observe(viewport);
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true; resize.disconnect(); URL.revokeObjectURL(detailUrl);
        dialog.remove(); closeInspection = null;
        if (inspect.isConnected) inspect.focus();
      };
      closeInspection = () => { dialog.close(); cleanup(); };
      dialog.addEventListener("close", cleanup, {once:true});
      detail.onload = fit;
      detail.src = detailUrl;
      dialog.showModal();
    });
    visual.append(image, inspect, node("figcaption", file.name));
    image.src = url;
  };
  const clearSummary = () => { if (summary) { delete summary.dataset.match; summary.textContent = recorded.name + " · compare file"; } };
  let generation = 0, controller = null;
  cancel.addEventListener("click", () => {
    generation++; controller?.abort(); controller = null; input.value = ""; clearPreview();
    clearSummary(); delete status.dataset.match; progress.hide(); cancel.hidden = true; box.removeAttribute("aria-busy");
    status.textContent = compact ? "File comparison stopped." : "File comparison stopped. Recorded evidence is unchanged."; input.focus();
  });
  input.addEventListener("change", async () => {
    const current = ++generation, file = input.files?.[0];
    controller?.abort(); controller = null; clearPreview(); clearSummary(); delete status.dataset.match;
    progress.hide(); cancel.hidden = true; box.removeAttribute("aria-busy");
    if (!file) { status.textContent = "Choose a local file to compare its bytes."; return; }
    const active = new AbortController(); controller = active;
    status.textContent = "Comparing " + file.name + " on this device…";
    box.setAttribute("aria-busy", "true"); cancel.hidden = false;
    try {
      const candidate = await fingerprintFile(file, {
        signal: active.signal,
        onProgress: value => {
          if (current !== generation) return;
          if (!box.isConnected) { active.abort(); return; }
          progress.update(value);
        }
      });
      if (current !== generation || !box.isConnected || active.signal.aborted) return;
      const matches = compareFileFingerprint(recorded, candidate);
      status.textContent = compact
        ? (source ? (matches ? "File matches the imported agreement." : "Different file: this copy does not match the imported agreement.") : (matches ? "File matches the recorded delivery." : "Different file: this copy does not match the delivery."))
        : matches
        ? "Matching bytes: this file has the recorded SHA-256 and size." +
          (candidate.name !== recorded.name ? " Its filename is different." : "") +
          " This does not verify authorship or acceptance."
        : "Different bytes: this file does not match the recorded evidence. The agreement and its decisions have not changed.";
      status.dataset.match = String(matches);
      if (matches) { showPreview(file, current); onMatch(file); }
      if (comparison) {
        summary.textContent = recorded.name + (matches ? " · file matches" : " · different file");
        summary.dataset.match = String(matches);
        comparison.open = !matches;
        if (matches) summary.focus();
      }
    } catch (error) {
      if (current === generation && box.isConnected)
        status.textContent = error.name === "AbortError" ? "File comparison stopped. Recorded evidence is unchanged." : error.message;
    } finally {
      if (current === generation) {
        controller = null; progress.hide(); cancel.hidden = true; box.removeAttribute("aria-busy");
      }
    }
  });
  return box;
}

// A reference label stays text. Only a supplied absolute web URL becomes a link.
export function deliveryReferenceUrl(reference) {
  if (typeof reference !== "string") return null;
  try {
    const url = new URL(reference.trim());
    return ["http:", "https:"].includes(url.protocol) && url.hostname && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
