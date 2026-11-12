import { resolveSourceReferences, sourceAttachedReferenceCandidates, resolveSourceDefinitions, sourceEnclosingSection, sourceIncomingReferenceIndex, resolveIncomingSourceReferences } from "./source-references.mjs";

const labelFor = target => target.kind === "definition"
  ? "“" + target.label + "”" + (target.location ? " · " + target.location : "")
  : target.kind[0].toUpperCase() + target.kind.slice(1) + " " + target.label;

// Navigation never captures wording; the author keeps the existing explicit action.
export function mountSourceReferences({ document, host, onTarget }) {
  host.classList.add("source-references");
  host.setAttribute("aria-label", "Source references");
  let indexedSource = null, incomingIndex = [];
  return {
    update(source, passages, {scope=null} = {}) {
      host.replaceChildren();
      const references = [...resolveSourceReferences(source, passages), ...resolveSourceDefinitions(source, passages)], seen = new Set();
      for (const reference of references) {
        if (reference.status === "resolved" || reference.kind === "definition" && reference.targets.length) {
          for (const target of reference.targets) {
            const key = target.start + ":" + target.end;
            if (seen.has(key)) continue;
            seen.add(key);
            const button = document.createElement("button");
            button.type = "button"; button.textContent = "Read " + labelFor(target);
            button.dataset.sourceReference = target.label;
            if (target.kind === "definition") button.dataset.sourceDefinition = target.label;
            button.title = target.quote.split(/\r\n|\r|\n/, 1)[0].trim();
            button.addEventListener("click", () => onTarget(target));
            host.append(button);
          }
        } else {
          const note = document.createElement("span"), text = reference.quote.replace(/\s+/g, " ").trim();
          note.textContent = reference.status === "external" ? "External: " + text
            : reference.status === "missing" ? text + " is not included in this source"
            : reference.status === "ambiguous" ? text + " has more than one matching heading"
            : text + " needs source review";
          note.className = "source-reference-note"; host.append(note);
          for(const target of sourceAttachedReferenceCandidates(source,reference)) {
            const key=target.start+":"+target.end;
            if(seen.has(key))continue;
            seen.add(key);
            const button=document.createElement("button");
            button.type="button";button.textContent="Read included "+labelFor(target);
            button.dataset.sourceAttached=target.label;
            button.title="Read the included copy named by this source";
            button.addEventListener("click",()=>onTarget(target));
            host.append(button);
          }
        }
      }
      for (const passage of passages) {
        const target = sourceEnclosingSection(source, passage);
        if (!target || scope && target.start===scope.start && target.end===scope.end) continue;
        const key = target.start + ":" + target.end;
        if (seen.has(key)) continue;
        seen.add(key);
        const button = document.createElement("button");
        button.type = "button"; button.textContent = "Read surrounding " + labelFor(target);
        button.dataset.sourceContaining = target.label;
        button.title = "Read the provision containing this passage";
        button.addEventListener("click", () => onTarget(target));
        host.append(button);
      }
      if (indexedSource !== source) {
        incomingIndex = sourceIncomingReferenceIndex(source); indexedSource = source;
      }
      for (const link of resolveIncomingSourceReferences(source, passages, incomingIndex)) {
        const target = link.origin;
        const button = document.createElement("button");
        button.type = "button"; button.textContent = link.viaContainingSection
          ? labelFor(link.target) + " referenced by " + labelFor(target)
          : "Referenced by " + labelFor(target);
        button.dataset.sourceIncoming = target.label;
        button.title = link.reference.quote;
        button.addEventListener("click", () => onTarget(target));
        host.append(button);
      }
      host.hidden = !host.childNodes.length;
    },
    showEnclosing(source, target, contextHost) {
      contextHost.replaceChildren();
      const parent = sourceEnclosingSection(source,target);
      contextHost.hidden = !parent;
      if (!parent) return;
      const button = document.createElement("button");
      button.type = "button"; button.textContent = "Read " + labelFor(parent);
      button.dataset.sourceEnclosing = parent.label;
      button.title = "Read the enclosing provision";
      button.addEventListener("click", () => onTarget(parent));
      contextHost.append(button);
    },
    clear() { host.replaceChildren(); host.hidden = true; },
  };
}
