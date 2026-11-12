// Search the existing event projection. Results never alter the project or readiness.
export function findCommitments(items, { query = "", state = "all", deadline = "all" } = {}) {
  const words = query.normalize("NFKC").toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const normalize = text => text.normalize("NFKC").toLocaleLowerCase();
  const results = [];
  for (const item of items) {
    if (state !== "all" && item.state !== state) continue;
    if (deadline === "attention" && !["overdue", "due", "accepted-late"].includes(item.deadlineState)) continue;
    if (deadline !== "all" && deadline !== "attention" && item.deadlineState !== deadline) continue;
    const fields = [
      ["Title", item.title], ["Clause", item.source], ["Criterion", item.criterion],
      ["Delivery", item.performer], ["Review", item.reviewer],
      ...item.evidence.flatMap(e => [["Evidence", e.description], ["Reference", e.reference]])
    ];
    const normalized = fields.map(([, text]) => normalize(text));
    if (!words.every(word => normalized.some(text => text.includes(word)))) continue;
    const matched = words.length ? fields.findIndex(([,text], index) => index > 0 && words.some(word => normalized[index].includes(word))) : -1;
    let context = "";
    if (matched >= 0) {
      const [label, text] = fields[matched];
      const at = Math.max(0, normalized[matched].indexOf(words.find(word => normalized[matched].includes(word))) - 40);
      context = label + ": " + (at ? "…" : "") + text.slice(at, at + 160) + (text.length > at + 160 ? "…" : "");
    }
    results.push({ item, context });
  }
  return results;
}
