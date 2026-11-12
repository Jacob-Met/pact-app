import { validateProject, projectView, PactError } from "./core.mjs";
function stable(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map(x => JSON.parse(stable(x))));
  if (value && typeof value === "object") return JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(stable(value[k]))])));
  return JSON.stringify(value);
}
const record = ({ seq, ...event }) => stable(event);
const base = ({ events, ...project }) => stable(project);
const refuse = message => { throw new PactError("HISTORY_CONFLICT", message); };

// Combine only independent branches. Same-commitment or connected-commitment
// changes require a person to reconcile the two decisions, not timestamp wins.
export function previewHistoryMerge(localInput, incomingInput) {
  const local = validateProject(localInput), incoming = validateProject(incomingInput);
  if (base(local) !== base(incoming)) refuse("The agreement identity or base terms differ.");
  const localById = new Map(local.events.map(e => [e.id, e]));
  const incomingById = new Map(incoming.events.map(e => [e.id, e]));
  for (const event of incoming.events) {
    const previous = localById.get(event.id);
    if (previous && record(previous) !== record(event)) refuse("The same record has different contents in these copies.");
  }
  const added = incoming.events.filter(e => !localById.has(e.id));
  const retained = local.events.filter(e => !incomingById.has(e.id));
  if (!added.length || !retained.length) refuse("There are no independent changes to combine.");
  const sharedLocal = local.events.filter(e => incomingById.has(e.id)).map(e => e.id);
  const sharedIncoming = incoming.events.filter(e => localById.has(e.id)).map(e => e.id);
  if (stable(sharedLocal) !== stable(sharedIncoming)) refuse("The copies disagree about the order of shared records.");
  const views = [projectView(local), projectView(incoming)];
  const obligations = new Map(views.flatMap(v => v.obligations.map(o => [o.id, o])));
  const evidence = new Map(views.flatMap(v => v.evidence.map(e => [e.id, e.obligationId])));
  const amendments = new Map(views.flatMap(v => v.amendments.map(a => [a.id, a.obligation.id])));
  const disputes = new Map(views.flatMap(v => v.disputes.map(d => [d.id, evidence.get(d.evidenceId)])));
  function touched(events) {
    const ids = new Set();
    for (const e of events) {
      const p = e.payload;
      let id = e.type === "obligation.added" ? p.obligation.id :
        e.type === "evidence.submitted" ? p.evidence.obligationId :
        e.type.startsWith("evidence.") ? evidence.get(p.evidenceId) :
        e.type === "dispute.resolved" ? disputes.get(p.disputeId) :
        e.type === "amendment.proposed" ? p.amendment.obligation.id :
        e.type.startsWith("amendment.") ? amendments.get(p.amendmentId) : null;
      if (!id) refuse("Party or agreement-wide changes must be reconciled separately.");
      ids.add(id);
    }
    return ids;
  }
  const ours = touched(retained), theirs = touched(added);
  // Dependencies make commitments one decision domain in both directions.
  const links = new Map([...obligations.keys()].map(id => [id, new Set()]));
  for (const view of views) for (const o of view.obligations) for (const dep of o.dependsOn) {
    links.get(o.id)?.add(dep); links.get(dep)?.add(o.id);
  }
  const connected = new Set(ours), queue = [...ours];
  while (queue.length) for (const id of links.get(queue.pop()) ?? []) if (!connected.has(id)) { connected.add(id); queue.push(id); }
  if ([...theirs].some(id => connected.has(id))) refuse("Both copies change the same commitment or its prerequisites.");
  const byId = new Map([...local.events, ...added].map(e => [e.id, e]));
  const next = new Map([...byId.keys()].map(id => [id,new Set()]));
  const degree = new Map([...byId.keys()].map(id => [id,0]));
  for (const branch of [local.events,incoming.events]) for (let i=1;i<branch.length;i++) {
    const from=branch[i-1].id,to=branch[i].id;
    if (!next.get(from).has(to)) {next.get(from).add(to);degree.set(to,degree.get(to)+1);}
  }
  const ready=[...byId.keys()].filter(id=>degree.get(id)===0), events=[];
  while(ready.length) {
    ready.sort((a,b)=>byId.get(a).at.localeCompare(byId.get(b).at)||a.localeCompare(b));
    const id=ready.shift();events.push({...byId.get(id),seq:events.length+1});
    for(const to of next.get(id)) {degree.set(to,degree.get(to)-1);if(!degree.get(to)) ready.push(to);}
  }
  if(events.length!==byId.size) refuse("The copies disagree about record order.");
  const merged = validateProject({...local,events});
  return {project:merged, added:added.length, retained:retained.length,
    commitments:[...theirs].map(id => obligations.get(id).title),
    incomingEventIds:added.map(event => event.id),
    baseSnapshot:stable(local)};
}
export function commitHistoryMerge(current, incoming, preview) {
  if (stable(validateProject(current)) !== preview.baseSnapshot) refuse("The workspace changed. Open the collaborator file again to review the current history.");
  return previewHistoryMerge(current, incoming).project;
}
