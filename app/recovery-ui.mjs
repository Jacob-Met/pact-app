import { createTabRecovery } from "./tab-recovery.mjs";
import { citationFromDraft } from "./source-citations.mjs";

const FORMS = {
  setup: ["#setup-form", ["title", "budget", "performer", "reviewer", "additionalParties", "source"]],
  obligation: ["#obligation-form", ["title", "amount", "performerId", "reviewerId", "criterion", "dueAt", "citationStart", "citationEnd", "citationQuote", "citationRelated"]],
  evidence: ["#evidence-form", ["obligationId", "submittedBy", "description", "reference"]],
  evaluation: ["#evaluate-form", ["asOf"]],
  amendment: ["#amendment-draft-form", ["state"]]
};

// Retain authoring fields and the author’s lookup question, never model results or payment acknowledgements.
export function captureDrafts(document) {
  const drafts = {};
  for (const [name, [selector, fields]] of Object.entries(FORMS)) {
    const form = document.querySelector(selector);
    if (!form) continue;
    drafts[name] = Object.fromEntries(fields.map(field => [field, form.elements[field]?.value ?? ""]));
  }
  drafts.sourceLookup = { question: document.querySelector("#ai-objective")?.value ?? "" };
  const imported = document.querySelector("#agreement-file-review");
  drafts.agreementImport = imported && !imported.hidden ? { text: document.querySelector("#agreement-import-text").value, label: document.querySelector("#agreement-file-name").textContent } : {};
  const sourceFiles = {};
  document.querySelector("#setup-form")?.dispatchEvent(new CustomEvent("pact:capture-agreement-file", { detail: sourceFiles }));
  drafts.agreementFiles = sourceFiles;
  drafts.dependencies = [...document.querySelectorAll("#dependency-options input:checked")].map(input => input.value);
  drafts.decisions = {};
  for (const input of document.querySelectorAll("[data-evidence-reason]")) {
    const actor = [...document.querySelectorAll("[data-evidence-actor]")].find(select => select.dataset.evidenceActor === input.dataset.evidenceReason);
    drafts.decisions[input.dataset.evidenceReason] = { reason: input.value, actor: actor?.value ?? "" };
  }
  return drafts;
}

export function restoreDrafts(document, drafts, project) {
  const question = document.querySelector("#ai-objective");
  if (question) question.value = project ? drafts.sourceLookup?.question ?? "" : "";
  for (const [name, [selector, fields]] of Object.entries(FORMS)) {
    if (name !== "setup" && !project) continue;
    const form = document.querySelector(selector);
    if (!form) continue;
    for (const field of fields) {
      if (typeof drafts[name]?.[field] !== "string") continue;
      const control = form.elements[field];
      if (!control) continue;
      if (control.tagName === "SELECT" && ![...control.options].some(option => option.value === drafts[name][field])) continue;
      control.value = drafts[name][field];
    }
  }
  document.querySelector("#setup-form")?.dispatchEvent(new CustomEvent("pact:restore-agreement-import", { detail: { ...drafts.agreementImport, pendingFile: drafts.agreementFiles?.pending, adoptedFile: drafts.agreementFiles?.adopted } }));
  for (const input of document.querySelectorAll("#dependency-options input")) input.checked = drafts.dependencies.includes(input.value);
  for (const input of document.querySelectorAll("[data-evidence-reason]")) {
    const value = drafts.decisions[input.dataset.evidenceReason];
    if (value) input.value = value.reason;
  }
  for (const select of document.querySelectorAll("[data-evidence-actor]")) {
    const value = drafts.decisions[select.dataset.evidenceActor];
    if (value && [...select.options].some(option => option.value === value.actor)) select.value = value.actor;
  }
  if (project) {
    const form = document.querySelector("#obligation-form");
    try {
      const citation = citationFromDraft(project.source, Object.fromEntries(
        ["citationStart", "citationEnd", "citationQuote", "citationRelated"].map(name => [name, form.elements[name]?.value ?? ""])));
      if (citation) document.querySelector("#citation-preview").textContent = "Source selection restored.";
    } catch {
      for (const name of ["citationStart", "citationEnd", "citationQuote", "citationRelated"])
        if (form.elements[name]) form.elements[name].value = "";
    }
  }
  document.dispatchEvent(new Event("pact-drafts-restored"));
}

export function mountRecovery({ document, getProject, setProject, getStorage = () => window.sessionStorage }) {
  const recovery = createTabRecovery(getStorage);
  const note = document.querySelector("#recovery-state");
  let ready = false, paused = false, failed = false, timer;
  function state(message, warning = false) {
    if (note.textContent !== message) note.textContent = message;
    note.classList.toggle("recovery-warning", warning);
  }
  function save() {
    clearTimeout(timer);
    if (!ready || paused) return;
    const result = recovery.write({ project: getProject(), drafts: captureDrafts(document) });
    failed = result.status !== "saved";
    state(failed ? "This tab could not save your changes. Use Save workspace before reloading." :
      "Saved in this tab. Save workspace keeps a file.", failed);
  }
  function start() {
    const result = recovery.read();
    if (result.status === "restored") {
      setProject(result.snapshot.project);
      restoreDrafts(document, result.snapshot.drafts, result.snapshot.project);
      state(result.snapshot.project ? "Restored this tab’s agreement and " + result.snapshot.project.events.length + " audit events." :
        "Restored your unfinished agreement draft in this tab.");
    } else if (result.status === "invalid") {
      paused = true;
      state("This tab’s recovery copy could not be read and was left untouched. Import an exported project or start a new one to continue.", true);
    } else if (result.status === "unavailable") {
      failed = true;
      state("Recovery is unavailable in this browser. Use Save workspace before leaving your work.", true);
    } else state("Kept through reloads. Save workspace before closing.");
    ready = true;
    return result.status;
  }
  function changedProject() {
    if (!ready) return;
    paused = false;
    save();
  }
  function schedule(event) {
    if (!event.target.closest("#setup-form, #obligation-form, #evidence-form, #evaluate-form, #evidence-list, #ai-objective")) return;
    clearTimeout(timer);
    timer = setTimeout(save, 180);
  }
  document.addEventListener("input", schedule);
  document.addEventListener("change", schedule);
  window.addEventListener("pagehide", save);
  window.addEventListener("beforeunload", event => {
    save();
    if (failed && getProject()) { event.preventDefault(); event.returnValue = ""; }
  });
  return { start, save, changedProject };
}
