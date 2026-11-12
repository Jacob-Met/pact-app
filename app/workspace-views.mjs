// Views retain the original form nodes so navigation never discards a draft.
export function revealWorkspaceTarget(target) {
  target?.dispatchEvent(new CustomEvent("pact:reveal", { bubbles: true }));
}

export function mountWorkspaceViews(workbench) {
  const doc = workbench.ownerDocument;
  const section = (name, label, nodes) => {
    const panel = doc.createElement("section");
    panel.id = "workspace-" + name;
    panel.dataset.workspaceView = name;
    panel.setAttribute("aria-label", label);
    for (const node of nodes) if (node) panel.append(node);
    workbench.append(panel);
    return panel;
  };
  const network = doc.querySelector("#obligation-network");
  const evidence = doc.querySelector(".evidence-panel");
  const agreement = section("agreement", "Agreement", [doc.querySelector(".source-panel"), doc.querySelector(".proposal-sheet")]);
  const commitments = section("commitments", "Commitments", [network, evidence, doc.querySelector(".evaluation-details")]);
  section("payments", "Payments", [doc.querySelector(".checkout-sheet")]);
  section("activity", "Activity", [doc.querySelector(".audit-panel")]);
  doc.querySelector(".workspace-grid")?.remove();
  doc.querySelector(".agreement-transition")?.remove();
  doc.querySelector(".project-more-actions")?.prepend(doc.querySelector("#import-open-active"));
  const nav = doc.createElement("nav");
  nav.className = "workspace-navigation"; nav.setAttribute("aria-label", "Agreement workspace");
  const panels = [...workbench.querySelectorAll("[data-workspace-view]")];
  let current = "commitments", projectId = null, hasCommitments = false, delivery = null;
  for (const [key, label] of [["commitments","Commitments"],["agreement","Agreement"],["payments","Payments"],["activity","Activity"]]) {
    const button = doc.createElement("button"); button.type = "button"; button.textContent = label;
    button.dataset.workspaceNav = key; button.setAttribute("aria-controls", "workspace-" + key);
    button.addEventListener("click", () => { delivery = null; open(key); });
    nav.append(button);
  }
  doc.querySelector(".project-bar").after(nav);
  const auditReturn = doc.querySelector(".audit-return"); if (auditReturn) nav.after(auditReturn);
  const back = doc.createElement("button");
  back.type = "button"; back.className = "delivery-back"; back.textContent = "← All commitments";
  back.addEventListener("click", () => { delivery = null; open("commitments"); network.querySelector("[aria-pressed=true]")?.focus(); });
  evidence.prepend(back);

  doc.querySelector("#read-complete-agreement")?.addEventListener("click", () => {
    delivery = null; open("commitments");
    const reader = network.querySelector(".contract-document");
    if (reader) { reader.tabIndex = -1; reader.scrollIntoView({block:"start",behavior:"instant"}); reader.focus({preventScroll:true}); }
  });

  function apply() {
    for (const panel of panels) panel.classList.toggle("workspace-inactive", panel.dataset.workspaceView !== current);
    for (const button of nav.children) {
      if (button.dataset.workspaceNav === current) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    const reviewing = current === "commitments" && delivery;
    network.classList.toggle("workspace-inactive", Boolean(reviewing));
    evidence.classList.toggle("workspace-inactive", !reviewing);
    doc.querySelector(".evaluation-details").classList.toggle("workspace-inactive", Boolean(reviewing));
    const form = doc.querySelector("#evidence-form");
    form.classList.toggle("workspace-inactive", delivery?.kind !== "add");
    for (const card of doc.querySelectorAll("[data-evidence-id]")) card.classList.toggle("workspace-inactive", delivery?.kind !== "review" || card.dataset.evidenceId !== delivery.id);
    const heading = evidence.querySelector("h2");
    heading.textContent = delivery?.kind === "add" ? "Add delivery evidence" : "Review delivery";
    evidence.querySelector(".section-head p:not(.step)")?.classList.add("workspace-inactive");
  }
  function open(name) {
    const status = doc.querySelector("#status"); if (status) status.hidden = true;
    current = name;
    apply();
  }
  workbench.addEventListener("pact:reveal", event => {
    const target = event.target;
    const panel = target.closest("[data-workspace-view]");
    if (!panel) return;
    const card = target.closest("[data-evidence-id]");
    if (card) delivery = { kind: "review", id: card.dataset.evidenceId };
    else if (target.closest("#evidence-form")) delivery = { kind: "add" };
    else delivery = null;
    open(panel.dataset.workspaceView);
  });
  return {
    update(view) {
      hasCommitments = view.obligations.length > 0;
      if (projectId !== view.project.id) { projectId = view.project.id; current = hasCommitments ? "commitments" : "agreement"; delivery = null; }
      const corrections = doc.querySelector("#party-corrections");
      if (corrections && corrections.parentElement !== agreement) agreement.append(corrections);
      apply();
    },
    reveal: revealWorkspaceTarget,
    open
  };
}
