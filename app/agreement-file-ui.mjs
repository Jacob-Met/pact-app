import { extractAgreement } from "./agreement-file.mjs";
import { fingerprintFile, validateFileFingerprint } from "./evidence-file.mjs";
import { findSourceText } from "./source-passages.mjs";

export function mountAgreementFile({ document }) {
  const form = document.querySelector("#setup-form");
  const input = document.querySelector("#agreement-file");
  const submit = form.querySelector('button[type="submit"]');
  const open = document.querySelector("#agreement-file-open");
  const status = document.querySelector("#agreement-file-status");
  const review = document.querySelector("#agreement-file-review");
  const candidate = document.querySelector("#agreement-import-text");
  const use = document.querySelector("#agreement-file-use");
  const cancel = document.querySelector("#agreement-file-cancel");
  const original = document.querySelector("#agreement-file-original");
  const find = document.querySelector("#agreement-import-find");
  const previous = document.querySelector("#agreement-import-previous");
  const next = document.querySelector("#agreement-import-next");
  const matchesLabel = document.querySelector("#agreement-import-matches");
  let matches = [], matchIndex = -1;
  function resetFind() {
    find.value = ""; matches = []; matchIndex = -1;
    previous.disabled = next.disabled = true; matchesLabel.textContent = "";
  }
  function showMatch(index) {
    if (!matches.length) return;
    matchIndex = (index + matches.length) % matches.length;
    const match = matches[matchIndex];
    candidate.setSelectionRange(match.start, match.end);
    // Measure the actual wrapping in the editable field; selection APIs alone do
    // not scroll a textarea consistently when focus stays in the search control.
    const mirror = document.createElement("div");
    const style = document.defaultView.getComputedStyle(candidate);
    for (const key of ["fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "padding", "wordBreak", "overflowWrap", "tabSize"]) mirror.style[key] = style[key];
    Object.assign(mirror.style, { position: "absolute", left: "-10000px", top: "0",
      visibility: "hidden", width: candidate.clientWidth + "px", boxSizing: "border-box",
      whiteSpace: "pre-wrap", overflowWrap: "break-word" });
    mirror.textContent = candidate.value.slice(0, match.start);
    const marker = document.createElement("span"); marker.textContent = candidate.value.slice(match.start, match.end) || " ";
    mirror.append(marker); document.body.append(mirror);
    candidate.scrollTop = Math.max(0, marker.offsetTop - candidate.clientHeight / 3);
    mirror.remove();
    matchesLabel.textContent = "Match " + (matchIndex + 1) + " of " + matches.length;
  }
  function refreshFind(select) {
    matches = findSourceText(candidate.value, find.value); matchIndex = -1;
    previous.disabled = next.disabled = matches.length === 0;
    matchesLabel.textContent = !find.value.trim() ? "" : matches.length ? matches.length + (matches.length === 1 ? " match" : " matches") : "No matching text";
    if (select && matches.length) showMatch(0);
  }
  find.addEventListener("input", () => refreshFind(true));
  find.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); showMatch(matchIndex + (event.shiftKey ? -1 : 1)); }
    if (event.key === "Escape") { event.preventDefault(); resetFind(); }
  });
  previous.addEventListener("click", () => { showMatch(matchIndex < 0 ? matches.length - 1 : matchIndex - 1); candidate.focus({ preventScroll: true }); });
  next.addEventListener("click", () => { showMatch(matchIndex + 1); candidate.focus({ preventScroll: true }); });
  candidate.addEventListener("input", () => refreshFind(false));
  let controller = null, generation = 0, url = null;
  let importedFile = null, adoptedFile = null;
  const normalize = text => text.replace(/\r\n?/g, "\n");
  const copyFile = value => {
    if (!value) return null;
    validateFileFingerprint(value.fingerprint);
    if (typeof value.originalText !== "string" || value.originalText.length > 100000) throw Error("Invalid imported source text.");
    return structuredClone(value);
  };
  form.addEventListener("pact:capture-agreement-file", event => {
    event.detail.pending = copyFile(importedFile);
    event.detail.adopted = copyFile(adoptedFile);
  });
  function clear() {
    generation++; controller?.abort(); controller = null; importedFile = null;
    if (url) URL.revokeObjectURL(url);
    url = null; original.removeAttribute("href"); original.hidden = true;
    review.hidden = true; candidate.value = ""; input.value = ""; resetFind();
    open.disabled = false; open.textContent = "Open agreement file"; submit.disabled = false; status.textContent = "";
  }
  open.addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    form.dataset.sourceImport = "true";
    clear();
    const token = generation;
    controller = new AbortController();
    submit.disabled = true;
    status.textContent = "Reading " + file.name + "…";
    cancel.hidden = false;
    try {
      const result = await extractAgreement(file, {
        signal: controller.signal,
        progress: (page, total) => { if (token === generation) status.textContent = "Reading page " + page + " of " + total + "…"; }
      });
      if (token !== generation) return;
      const fingerprint = await fingerprintFile(file, { signal: controller.signal });
      if (token !== generation) return;
      importedFile = { fingerprint, originalText: normalize(result.text) };
      candidate.value = result.text;
      document.querySelector("#agreement-file-name").textContent = result.name + (result.pages ? " · " + result.pages + (result.pages === 1 ? " page" : " pages") : "");
      use.textContent = form.elements.source.value.trim() ? "Replace source with this text" : "Use this agreement text";
      url = URL.createObjectURL(file); original.href = url; original.hidden = false;
      review.hidden = false; open.textContent = "Choose another"; status.textContent = "";
      candidate.dispatchEvent(new Event("input", { bubbles: true }));
      candidate.focus({ preventScroll: true }); candidate.setSelectionRange(0, 0); candidate.scrollTop = 0; review.scrollIntoView({ block: "start", behavior: "smooth" });
    } catch (error) {
      if (token !== generation) return;
      status.textContent = error.message || "The agreement could not be read.";
      submit.disabled = false;
      cancel.hidden = true;
    } finally {
      if (token === generation) controller = null;
    }
  });
  cancel.addEventListener("click", () => { clear(); cancel.hidden = true; form.dispatchEvent(new Event("input", { bubbles: true })); open.focus(); });
  use.addEventListener("click", () => {
    if (!candidate.value.trim()) { status.textContent = "Enter the complete agreement text before using it."; candidate.focus(); return; }
    if (candidate.value.length > 100000) { status.textContent = "The source must fit within 100,000 characters."; return; }
    adoptedFile = copyFile(importedFile);
    form.elements.source.value = normalize(candidate.value);
    form.elements.source.dispatchEvent(new Event("input", { bubbles: true }));
    clear(); cancel.hidden = true;
    status.textContent = adoptedFile ? adoptedFile.fingerprint.name + " · original file identified." : "Agreement text added.";
    form.elements.source.focus();
  });
  form.addEventListener("pact:restore-agreement-import", event => {
    clear(); cancel.hidden = true;
    const draft = event.detail;
    adoptedFile = copyFile(draft?.adoptedFile);
    importedFile = copyFile(draft?.pendingFile);
    if (typeof draft?.text !== "string") return;
    form.dataset.sourceImport = "true";
    candidate.value = draft.text;
    document.querySelector("#agreement-file-name").textContent = draft.label || "Imported agreement";
    use.textContent = form.elements.source.value.trim() ? "Replace source with this text" : "Use this agreement text";
    review.hidden = false; open.textContent = "Choose another"; cancel.hidden = false; submit.disabled = true;
  });
  form.addEventListener("reset", () => { clear(); adoptedFile = null; delete form.dataset.sourceImport; cancel.hidden = true; });
  return { clear, pending: () => controller !== null || !review.hidden,
    sourceFile: () => adoptedFile ? {
      fingerprint: structuredClone(adoptedFile.fingerprint),
      textEdited: normalize(form.elements.source.value) !== adoptedFile.originalText
    } : undefined
  };
}
