// Compare already validated records. File timestamps and event IDs alone never
// establish ancestry: the base agreement and the entire ordered prefix must match.
function canonical(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map(item => JSON.parse(canonical(item))));
  if (value && typeof value === "object") return JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))])));
  return JSON.stringify(value);
}
const count = n => n + (n === 1 ? " recorded event" : " recorded events");
export function compareImportHistory(current, incoming) {
  if (!current || !incoming) return { kind: "replacement", summary: "This replaces the current workspace and its recovery copy." };
  const { events: local, ...localBase } = current;
  const { events: received, ...receivedBase } = incoming;
  if (canonical(localBase) !== canonical(receivedBase)) {
    return { kind: "different", summary: "This file has a different agreement identity or base terms. Its " + count(received.length) + " will replace the current " + count(local.length) + "; histories will not be combined." };
  }
  let shared = 0;
  while (shared < local.length && shared < received.length && canonical(local[shared]) === canonical(received[shared])) shared++;
  const missing = local.length - shared, added = received.length - shared;
  if (!missing && !added) return { kind: "same", shared, missing, added, summary: "The recorded agreement history is identical (" + count(shared) + "). Opening still replaces unfinished drafts." };
  if (!missing) return { kind: "continuation", shared, missing, added, summary: "This file preserves all " + count(shared) + " in this workspace and adds " + count(added) + ". Review the received changes after opening." };
  if (!added) return { kind: "older", shared, missing, added, summary: "Older agreement history: this file is missing " + count(missing) + " currently in this workspace. Opening will remove those local records from this tab, including any later decisions or disputes." };
  return { kind: "diverged", shared, missing, added, summary: "Different histories: both copies share the first " + count(shared) + ", then differ. Opening replaces " + count(missing) + " from this workspace with " + count(added) + " from the file. Decisions and disputes in the replaced history will no longer be present in this tab. Histories will not be combined." };
}
export function importReviewCopy(current, incoming, hasDrafts) {
  const review = compareImportHistory(current, incoming);
  const title = incoming?.title ?? "unfinished agreement draft";
  return {
    title: review.kind === "older" ? "Open an older agreement?" : review.kind === "diverged" ? "Replace a different history?" : "Review incoming workspace",
    copy: "Open “" + title + "”? " + review.summary + " " + (hasDrafts ? "This workspace file also replaces unfinished drafts." : "This project file contains no unfinished drafts; current drafts will be cleared.") + " Save workspace before continuing to keep your current work.",
    confirmLabel: review.kind === "older" || review.kind === "diverged" ? "Replace with this history" : "Open and replace workspace"
  };
}
