// Saved requests stay read-only here; continuing one requires a separate, explicit current-terms review.
export function mountPaymentHistory({ anchor, getContext, post, run, showStatus, onReviewExisting }) {
  const make = (tag, text = "", className = "") => {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  if (!document.querySelector('link[data-payment-history]')) {
    const style = document.createElement("link");
    style.rel = "stylesheet"; style.href = "/payment-history.css";
    style.dataset.paymentHistory = "true"; document.head.append(style);
  }
  const section = make("section", "", "payment-history");
  section.setAttribute("aria-labelledby", "pay-history-heading");
  const heading = make("h4", "Previous Sandbox requests");
  heading.id = "pay-history-heading";
  const explanation = make("p", "Inspect a saved request or review it against the current agreement.", "payment-history-note");
  const currentTerms = make("p", "", "payment-history-current");
  const load = make("button", "Show saved requests");
  load.id = "pay-history-load"; load.type = "button";
  const message = make("p", "Choose an obligation to inspect its saved requests.", "payment-history-note");
  message.id = "pay-history-state"; message.setAttribute("role", "status");
  const list = make("ol"); list.id = "pay-history-list";
  section.append(heading, currentTerms, explanation, load, message, list);
  anchor.after(section);
  let token = null, busy = false, loaded = false;
  const rows = new Map();
  const context = () => {
    const value = getContext();
    return value ? { ...value, token: JSON.stringify([value.project, value.obligationId]) } : null;
  };
  const matches = ctx => context()?.token === ctx.token;
  function updateRow(row, record) {
    row.record = record;
    row.title.textContent = "Revision " + record.obligationRevision + " · " + record.amount + " " + record.currency;
    row.binding.textContent = record.matchesCurrentSnapshot ? "Current agreement history" : "Earlier agreement history";
    row.status.textContent = ({ captured: "Payment captured", "awaiting-payer": "Awaiting payer", "approved-by-payer": "Approved by payer", uncertain: "Provider outcome uncertain", preparing: "Request being prepared", capturing: "Capture awaiting confirmation", voided: "Payment request voided" })[record.state] || record.state;
    row.observed.textContent = record.lastObservedAt
      ? "Last provider observation: " + record.lastObservedAt
      : "No provider observation has been recorded.";
    row.reference.textContent = "Order: " + (record.orderId || "not received") + "\nRequest: " + record.requestId + (record.captureId ? "\nCapture: " + record.captureId : "");
    row.legacy.textContent = record.revisionInferred ? "Revision 1 is inferred from a legacy journal record." : "";
    row.note.textContent = record.orderId ? "" : "No order ID was received. Investigate this request in PayPal Sandbox before another write.";
    row.note.hidden = !row.note.textContent;
    row.legacy.hidden = !row.legacy.textContent;
    row.read.disabled = busy || !record.orderId;
    const ctx=context();
    row.review.hidden = !onReviewExisting || record.matchesCurrentSnapshot || !record.orderId ||
      ["captured","voided"].includes(record.state) || record.obligationRevision !== ctx?.obligationRevision ||
      record.amount !== ((ctx?.amountMinor??0)/100).toFixed(2);
    row.review.disabled=busy;
  }
  function showRows(records) {
    rows.clear(); list.replaceChildren();
    for (const record of records) {
      const item = make("li", "", "payment-history-entry");
      const title = make("strong");
      const binding = make("p", "", "payment-history-note");
      const status = make("p");
      const observed = make("p", "", "payment-history-note");
      const reference = make("pre", "", "payment-history-reference");
      const details = make("details");
      details.append(make("summary", "Order and request references"), reference);
      const legacy = make("p", "", "payment-history-note");
      const note = make("p", "", "payment-history-note");
      const read = make("button", "Read provider status for revision " + record.obligationRevision);
      read.type = "button"; read.dataset.historyKey = record.key;
      const review=make("button","Review this existing request");
      review.type="button";review.dataset.reviewHistoryKey=record.key;
      review.addEventListener("click",()=>void onReviewExisting?.(record));
      const row = { item, title, binding, status, observed, reference, legacy, note, read, review, record };
      updateRow(row, record);
      read.addEventListener("click", async () => {
        const started = context(), hadFocus = document.activeElement === read;
        await run(async () => {
        const ctx = context();
        if (!ctx || !record.orderId) return;
        message.textContent = "Reading this prior request from PayPal Sandbox…";
        try {
          const result = await post("/api/paypal/history-status", {
            project: ctx.project, obligationId: ctx.obligationId, key: record.key
          });
          if (!matches(ctx)) {
            showStatus("A provider read completed for an earlier selection. Its saved history can be reopened there.");
            return;
          }
          if (result.key !== record.key || result.obligationId !== ctx.obligationId || result.readOnly !== true)
            throw new Error("The returned history does not match this request.");
          updateRow(row, result);
          message.textContent = "Provider observation refreshed.";
        } catch (cause) {
          if (matches(ctx)) message.textContent = "Provider status could not be refreshed. The last saved observation remains visible.";
          throw cause;
        }
        });
        if (hadFocus && started && matches(started) && read.isConnected &&
            (document.activeElement === document.body || document.activeElement === read)) read.focus();
      });
      item.append(title, binding, status, observed, read, review, details, legacy, note);
      list.append(item); rows.set(record.key, row);
    }
  }
  load.addEventListener("click", () => run(async () => {
    const ctx = context();
    if (!ctx) return;
    message.textContent = "Reading saved request metadata on this server…";
    try {
      const result = await post("/api/paypal/history", { project: ctx.project, obligationId: ctx.obligationId });
      if (!matches(ctx)) return;
      if (result.projectId !== ctx.project.id || result.obligationId !== ctx.obligationId || !Array.isArray(result.requests))
        throw new Error("The returned history does not match the selected obligation.");
      loaded = true; showRows(result.requests);
      message.textContent = result.requests.length
        ? "Saved observations · read status to refresh."
        : "No saved Sandbox requests for this obligation.";
    } catch (cause) {
      if (matches(ctx)) message.textContent = "Saved request history could not be read. Existing observations were kept.";
      throw cause;
    }
  }));
  function refresh({ busy: nextBusy = false } = {}) {
    busy = nextBusy;
    const ctx = context();
    currentTerms.textContent = ctx ? ctx.title + " · current revision " + ctx.obligationRevision + " · $" + (ctx.amountMinor / 100).toFixed(2) + " USD" : "";
    if ((ctx?.token ?? null) !== token) {
      token = ctx?.token ?? null; loaded = false; rows.clear(); list.replaceChildren();
      message.textContent = ctx
        ? "Show requests saved for this commitment."
        : "Choose an obligation to inspect its saved requests.";
    }
    load.disabled = busy || !ctx;
    load.textContent = loaded ? "Reload saved requests" : "Show saved requests";
    for (const row of rows.values()) {row.read.disabled = busy || !row.record.orderId;row.review.disabled=busy;}
  }
  refresh();
  return { refresh, showRecords(records) {
    loaded=true;showRows(records);
    message.textContent=records.length?"Saved observations · read status to refresh.":"No saved requests for this commitment.";
  } };
}
