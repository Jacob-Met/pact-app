import { citationPassages } from "./source-citations.mjs";
import { projectView, evaluateProject, partyNames } from "./core.mjs";
import { formatUsdMinor } from "./ui-utils.mjs";
import { buildObligationNetwork } from "./obligation-network.mjs";
import { amendmentTextChanges, amendmentEditPreview, amendmentCitationPairs } from "./amendment-terms.mjs";
import { citationExcerptsHtml, citationLocation, sourceTextHtml } from "./citation-view.mjs";
const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const money = value => escape(formatUsdMinor(value));
const paragraph = value => "<p>" + escape(value) + "</p>";
const stateName = result => result.readiness === "ready-for-human-review" ? "Ready for human review" : "Blocked";
const deadlineNames = { none: "No separate deadline recorded", upcoming: "Upcoming", due: "Due", overdue: "Overdue", "accepted-on-time": "Accepted on time", "accepted-late": "Accepted late" };

// A readable snapshot only. Its content comes from validated replay, never saved totals.
export function exportReadableReview(project, asOf) {
  const view = projectView(project), evaluation = evaluateProject(view.project, asOf);
  const source=view.project.source.text;
  const quoted=[...view.obligations,...view.obligationVersions,...view.amendments.map(item=>item.obligation)]
    .flatMap(item=>citationPassages(item.citation));
  const ranges=[...new Map(quoted.map(passage=>[passage.start+"-"+passage.end,passage])).entries()];
  const boundaries=[...new Set([0,source.length,...quoted.flatMap(passage=>[passage.start,passage.end])])].sort((a,b)=>a-b);
  const sourceHtml=sourceTextHtml(source,(text,offset)=>{
    if(!text)return "";
    const end=offset+text.length,cuts=[offset,...boundaries.filter(value=>value>offset&&value<end),end];
    return cuts.slice(0,-1).map((start,index)=>{
      const stop=cuts[index+1],covered=ranges.filter(([,passage])=>passage.start<=start&&passage.end>=stop).map(([key])=>key);
      const anchors=ranges.filter(([,passage])=>passage.start===start).map(([key,passage])=>
        '<span class="source-anchor" id="source-passage-'+key+'" data-source-start="'+start+'" data-source-end="'+passage.end+'"></span>').join("");
      return anchors+'<span data-source-start="'+start+'" data-source-end="'+stop+'" data-source-ranges="'+covered.join(" ")+'">'+escape(source.slice(start,stop))+'</span>';
    }).join("");
  });
  const sourceReturns = view.obligations.map((item,index) => {
    const versions = [item,...view.obligationVersions.filter(version=>version.id===item.id),...view.amendments.filter(amendment=>amendment.obligation.id===item.id).map(amendment=>amendment.obligation)];
    const keys = [...new Set(versions.flatMap(version=>citationPassages(version.citation)).map(passage=>passage.start+"-"+passage.end))];
    return '<a href="#commitment-'+index+'" data-source-ranges="'+keys.join(" ")+'">Return to commitment '+(index+1)+'</a>';
  }).join("");
  const sourceReturnCss=ranges.map(([key])=>'.agreement-sheet:has(#source-passage-'+key+':target) .source-return a[data-source-ranges~="'+key+'"]{display:block}').join("");
  const sourceHighlightCss=ranges.map(([key])=>'.source:has(#source-passage-'+key+':target) [data-source-ranges~="'+key+'"]{background:#fff0c8}').join("");
  const network = new Map(buildObligationNetwork(view, evaluation).map(item => [item.id, item]));
  const commitmentIndex = new Map(view.obligations.map((item, index) => [item.id, index]));
  const party = (id, seq = Infinity) => partyNames(view.project, seq).find(p => p.id === id)?.name ?? id;
  const obligation = id => view.obligations.find(o => o.id === id)?.title ?? id;
  const evidenceName = id => view.evidence.find(e => e.id === id)?.reference ?? id;
  const proposalName = id => { const a = view.amendments.find(a => a.id === id); return a ? a.obligation.title + " · revision " + a.obligation.revision : id; };
  const eventDetail = event => {
    const p = event.payload;
    if (event.type === "party.name-corrected") return "Corrected party name from " + p.previousName + " to " + p.name + ". " + p.reason;
    if (event.type === "amendment.proposed") return "Proposed revision " + p.amendment.obligation.revision + " of " + p.amendment.obligation.title + ". " + p.amendment.reason;
    if (event.type === "amendment.reviewed") return "Recorded " + p.decision + " review of " + proposalName(p.amendmentId) + ". " + p.reason;
    if (event.type === "amendment.withdrawn") return "Withdrew proposal for " + proposalName(p.amendmentId) + ". " + p.reason;
    if (event.type === "amendment.adopted") return "Applied " + proposalName(p.amendmentId) + " to the local record.";
    if (event.type === "obligation.added") return "Added commitment: " + p.obligation.title;
    if (event.type === "evidence.submitted") {
      const original = view.obligationVersions.find(o => o.id === p.evidence.obligationId && o.revision === p.evidence.obligationRevision);
      return "Submitted " + p.evidence.reference + " for " + original.title + " · revision " + original.revision + ". " + p.evidence.description;
    }
    if (event.type === "evidence.accepted") return "Accepted " + evidenceName(p.evidenceId) + ". " + p.rationale;
    if (event.type === "evidence.disputed") return "Disputed " + evidenceName(p.evidenceId) + ". " + p.reason;
    if (event.type === "evidence.revoked") return "Revoked " + evidenceName(p.evidenceId) + ". " + p.reason;
    if (event.type === "dispute.resolved") {
      const d = view.disputes.find(d => d.id === p.disputeId);
      return "Resolved dispute on " + evidenceName(d?.evidenceId ?? p.disputeId) + ". " + p.reason;
    }
    return event.type + ": " + JSON.stringify(p);
  };
  const summaries = view.obligations.map((item, i) => {
    const result = evaluation.obligations.find(r => r.obligationId === item.id);
    return '<li><a href="#commitment-' + i + '">' + escape(item.title) + '</a><span>' + escape(stateName(result)) + ' · ' + money(item.amountMinor) + '</span></li>';
  }).join("");
  const commitments = view.obligations.map((item, i) => {
    const result = evaluation.obligations.find(r => r.obligationId === item.id);
    const changedPrerequisites = network.get(item.id).changedPrerequisites;
    const prerequisiteReview = changedPrerequisites.length ? '<aside class="prerequisite-review"><h3>Prerequisites changed after earlier evidence was accepted</h3>' +
      paragraph("Review this delivery against the revised prerequisites.") +
      '<ul>' + changedPrerequisites.map(change => '<li><a href="#commitment-' + commitmentIndex.get(change.id) + '">' + escape(change.title) + '</a> · revision ' + escape(change.before ?? "not yet recorded") + ' → ' + escape(change.after) + '</li>').join("") + '</ul>' +
      '</aside>' : "";
    const blockers = [];
    if (result.blockers.includes("NO_VALID_ACCEPTED_EVIDENCE")) blockers.push("No valid recorded acceptance");
    if (result.blockers.includes("DEPENDENCY_NOT_READY")) blockers.push("Waiting for " + result.dependencyBlockers.map(obligation).join("; "));
    if (result.blockers.includes("OPEN_DISPUTE")) {
      for (const id of result.openDisputeIds) {
        const dispute = view.disputes.find(d => d.id === id);
        const event = view.project.events.find(e => e.type === "evidence.disputed" && e.payload.disputeId === id);
        blockers.push("Open dispute by " + party(dispute.openedBy) + ": " + event.payload.reason);
      }
    }
    const revisions = view.amendments.filter(a => a.obligation.id === item.id).map((a, revisionIndex) => {
      const proposalEvent = view.project.events.find(e => e.type === "amendment.proposed" && e.payload.amendment.id === a.id);
      const reviewEvents = view.project.events.filter(e => e.type === "amendment.reviewed" && e.payload.amendmentId === a.id);
      const closedEvent = view.project.events.find(e => ["amendment.adopted", "amendment.withdrawn"].includes(e.type) && e.payload.amendmentId === a.id) ?? reviewEvents.find(e => e.payload.decision === "reject");
      const old = view.obligationVersions.find(o => o.id === item.id && o.revision === a.baseRevision), next = a.obligation;
      const change = (label, before, after, wordingField = null) => {
        if (before === after) return "";
        if (!wordingField) return "<li><strong>" + escape(label) + ":</strong> " + escape(before) + " → " + escape(after) + "</li>";
        const prefix = "revision-" + i + "-" + revisionIndex + "-" + wordingField;
        const edits = []; let redline = "";
        for (const part of amendmentTextChanges(before.replace(/\r\n?/g,"\n"), after.replace(/\r\n?/g,"\n"))) {
          if (!part.changed) { redline += escape(part.after); continue; }
          const material = /\S/.test(part.before + part.after);
          const id = prefix + "-" + (edits.length + 1);
          if (material) edits.push({ ...part, id: id + (/\S/.test(part.after) ? "-after" : "-before") });
          const marked = (text, version, tag) => {
            if (!text) return "";
            const leading = text.match(/^\s*/u)[0], words = text.trim(), trailing = text.slice(leading.length + words.length);
            return '<' + tag + ' class="revision-word-' + version + '">' +
              (material && words ? escape(leading) + '<span id="' + id + '-' + version + '">' + escape(words) + '</span>' + escape(trailing) : escape(text)) + '</' + tag + '>';
          };
          redline += marked(part.before, "before", "del") + marked(part.after, "after", "ins");
        }
        const links = edits.length ? '<nav class="revision-edits" aria-label="' + escape(label) + ' wording edits"><ol>' + edits.map((edit,index) =>
          '<li><a href="#' + edit.id + '" aria-label="Review edit ' + (index + 1) + '"><span class="revision-edit-number">' + (index + 1) + '</span><span>' +
          (edit.before ? '<del class="revision-word-before">' + escape(amendmentEditPreview(edit.before)) + '</del>' : '') +
          (edit.before && edit.after ? ' → ' : '') +
          (edit.after ? '<ins class="revision-word-after">' + escape(amendmentEditPreview(edit.after)) + '</ins>' : '') + '</span></a></li>'
        ).join("") + '</ol></nav>' : "";
        return '<li class="revision-wording-change"><strong>' + escape(label) + ':</strong>' + links +
          '<p class="revision-key"><del class="revision-word-before">Removed</del> <ins class="revision-word-after">Added</ins></p>' +
          '<p class="revision-redline" data-wording-field="' + wordingField + '">' + redline + '</p></li>';
      };
      const citationChanges=()=>{
        if(JSON.stringify(old.citation)===JSON.stringify(next.citation))return "";
        const beforePassages=citationPassages(old.citation),afterPassages=citationPassages(next.citation);
        const count=Math.max(beforePassages.length,afterPassages.length);
        return amendmentCitationPairs(beforePassages,afterPassages).map(({beforeIndex,afterIndex},index)=>{
          const before=beforePassages[beforeIndex],after=afterPassages[afterIndex];
          if(before?.quote===after?.quote&&before?.start===after?.start&&before?.end===after?.end)return "";
          const label="Agreement passage"+(count>1?" "+((afterIndex??beforeIndex)+1):"");
          const wording=change(label,before?.quote??"",after?.quote??"","citation-"+index);
          const location=paragraph((before?citationLocation(old.citation,before,beforeIndex,beforePassages.length):"Not previously cited")+" → "+
            (after?citationLocation(next.citation,after,afterIndex,afterPassages.length):"Passage removed"));
          if(wording)return wording.slice(0,-5)+'<div class="meta">'+location+'</div></li>';
          return '<li><strong>'+escape(label)+':</strong>'+citationExcerptsHtml(next.citation,[after],{linkToSource:true})+
            '<div class="meta">'+location+'</div></li>';
        }).join("");
      };
      const differences = [
        change("Title", old.title, next.title),
        change("Performer", party(old.performerId), party(next.performerId)),
        citationChanges(),
        change("Completion criterion", old.criterion, next.criterion, "criterion"),
        change("Reviewer", party(old.reviewerId), party(next.reviewerId)),
        change("Amount", formatUsdMinor(old.amountMinor), formatUsdMinor(next.amountMinor)),
        change("Deadline", old.dueAt ?? "Not set", next.dueAt ?? "Not set"),
        change("Prerequisites", old.dependsOn.map(obligation).join("; ") || "None", next.dependsOn.map(obligation).join("; ") || "None")
      ].join("");
      const status = a.status === "adopted" ? "Applied to local record" : a.status === "pending" ? "Pending proposal · current terms remain active" : a.status === "rejected" ? "Rejected · not applied" : "Withdrawn · not applied";
      return '<article class="evidence revision-record" data-revision-status="' + escape(a.status) + '"><h4>Revision ' + next.revision + ' proposal</h4><p class="status">' + escape(status) + '</p>' +
        paragraph("Proposed by " + party(a.proposedBy, proposalEvent.seq - 1) + ". " + a.reason) + '<ul>' + differences + '</ul>' +
        (a.reviews.length ? '<ul>' + a.reviews.map((r, index) => '<li>' + escape(party(r.actorId, reviewEvents[index].seq - 1) + " recorded " + r.decision + ": " + r.reason) + '</li>').join("") + '</ul>' : paragraph("No party reviews recorded.")) +
        (a.status === "pending" ? paragraph(a.awaitingPartyIds.length ? "Awaiting recorded review from " + a.awaitingPartyIds.map(party).join("; ") + "." : "All declared reviews recorded; explicit application is still required.") : paragraph((a.status === "adopted" ? "Applied" : a.status === "rejected" ? "Rejected" : "Withdrawn") + " by " + party(a.closedBy, closedEvent.seq - 1) + ".")) +
        (a.withdrawalReason ? paragraph(a.withdrawalReason) : "") + '</article>';
    }).join("");
    const evidence = view.evidence.filter(e => e.obligationId === item.id).map(e => {
      const s = e.decision, historical = e.obligationRevision !== item.revision;
      const state = s.revoked ? "Revoked" : s.openDisputeIds.length ? "Disputed" : s.acceptedAt ? "Recorded acceptance" : "No recorded acceptance";
      const submitted = view.project.events.find(event => event.type === "evidence.submitted" && event.payload.evidence.id === e.id);
      const accepted = view.project.events.find(event => event.type === "evidence.accepted" && event.payload.evidenceId === e.id);
      return '<article class="evidence"><h4>' + escape(e.reference) + '</h4><p class="status">' + escape(state) + ' · revision ' + e.obligationRevision + '</p>' +
        (historical ? paragraph("Historical evidence. This acceptance or decision does not satisfy current revision " + item.revision + "; unresolved disputes still apply.") : '') +
        paragraph(e.description) + (e.fileFingerprint ? '<div class="file-record"><h4>Recorded file fingerprint</h4>' + paragraph(e.fileFingerprint.name + ' · ' + e.fileFingerprint.bytes + ' bytes') + '<p class="meta">SHA-256: ' + escape(e.fileFingerprint.sha256) + '</p></div>' : '') + '<p class="meta">Submitted by ' + escape(party(e.submittedBy, submitted.seq - 1)) + '. ' +
        (accepted ? 'Acceptance recorded by ' + escape(party(accepted.actorId, accepted.seq - 1)) + ' at ' + escape(accepted.at) + '. ' : '') +
        '</p><small>Record ' + escape(e.id) + '</small></article>';
    }).join("");
    return '<section class="commitment" id="commitment-' + i + '"><header><p class="sequence">COMMITMENT ' + (i + 1) + '</p><h2>' + escape(item.title) +
      '</h2><p class="status">' + escape(stateName(result)) + ' · ' + money(item.amountMinor) + ' USD</p></header>' +
      '<p class="meta">Current commitment revision ' + item.revision + '</p>' + prerequisiteReview + '<dl><div><dt>Performer</dt><dd>' + escape(party(item.performerId)) + '</dd></div><div><dt>Reviewer</dt><dd>' + escape(party(item.reviewerId)) +
      '</dd></div><div><dt>Recorded deadline</dt><dd>' + escape(item.dueAt ?? "Not set") + '</dd></div><div><dt>Deadline condition</dt><dd>' + escape(deadlineNames[result.deadlineState] ?? result.deadlineState) +
      '</dd></div></dl><h3>Completion criterion</h3><div class="completion-criterion">' + sourceTextHtml(item.criterion) + '</div><h3>Exact agreement passage</h3>' + citationExcerptsHtml(item.citation,citationPassages(item.citation),{linkToSource:true}) +
      '<h3>Prerequisites and current blockers</h3>' + paragraph(item.dependsOn.length ? item.dependsOn.map(obligation).join("; ") : "No prerequisites recorded.") +
      (blockers.length ? '<ul>' + blockers.map(x => '<li>' + escape(x) + '</li>').join("") + '</ul>' : paragraph("No blockers in this local evaluation.")) +
      '<h3>Evidence and recorded decisions</h3>' + (evidence || paragraph("No evidence recorded.")) + (revisions ? '<h3>Recorded revision proposals</h3>' + revisions : '') + '</section>';
  }).join("");
  const audit = view.project.events.map(event => '<li><p><strong>' + escape(party(event.actorId, event.seq - 1)) + '</strong> — ' + escape(eventDetail(event)) + '</p><small>Event ' + event.seq + ' · ' + escape(event.at) + '</small></li>').join("");
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><title>' + escape(project.title) + ' — PACT review</title><style>' +
    '*{box-sizing:border-box}html{color:#101b3e;background:white;font-family:Arial,Helvetica,sans-serif;line-height:1.55}body{max-width:1280px;margin:0 auto;padding:40px 32px}h1,h2,h3,h4,a{overflow-wrap:anywhere}h1{font:600 36px/1.2 Georgia,serif;letter-spacing:-.5px;margin:20px 0 16px}h2{font:600 24px/1.25 Georgia,serif;margin:0 0 14px}h3{font-size:13px;margin:24px 0 8px;color:#686868}h4{font-size:15px;margin:0}p{margin:.6em 0;white-space:pre-wrap;overflow-wrap:anywhere}a{color:#304ce5;text-underline-offset:3px}small,.meta{font-size:11px;color:#686868;overflow-wrap:anywhere}.mast{border-bottom:1px solid #101b3e;padding-bottom:22px}.sequence{font-size:11px;color:#304ce5;font-weight:600;letter-spacing:0}.record-context{font-size:12px;color:#686868;margin-top:14px}.record-context summary{cursor:pointer}.record-context p{max-width:70ch}.index{list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:0 28px}.index li{display:flex;flex-direction:column;gap:5px;padding:18px 0}.index a{font-size:13px;font-weight:600}.index span{font:11px ui-monospace,monospace}.document-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:44px;border-top:1px solid #dedbd8;padding-top:34px}.agreement-sheet{min-width:0;padding-right:36px;border-right:1px solid #dedbd8}.agreement-sheet h2{font-size:26px}.source{white-space:pre-wrap;overflow-wrap:anywhere;font:18px/1.9 Georgia,serif;margin-top:24px}.review-notes{min-width:0}.commitment{padding:0 0 30px;margin-bottom:30px;border-bottom:1px solid #dedbd8;break-inside:auto;scroll-margin-top:24px}.commitment header{border-top:2px solid #304ce5;padding-top:12px}.commitment h2{font:600 20px/1.3 Arial,sans-serif;margin:12px 0}.status{font:600 12px/1.6 Arial,sans-serif;color:#304ce5}dl{display:grid;grid-template-columns:1fr 1fr;gap:12px 20px;margin:20px 0}dt{font-size:11px;color:#686868}dd{margin:3px 0 0;font-size:13px;overflow-wrap:anywhere}blockquote{margin:12px 0;border-left:2px solid #304ce5;padding:8px 14px;background:#f3f5ff;font:16px/1.8 Georgia,serif;white-space:pre-wrap;overflow-wrap:anywhere}.evidence{border-top:1px solid #dedbd8;margin:18px 0;padding-top:16px;font-size:13px}.prerequisite-review{border-left:2px solid #304ce5;background:#f3f5ff;margin:18px 0;padding:10px 14px;font-size:13px}.prerequisite-review h3{margin:0 0 8px}.prerequisite-review ul{padding-left:18px}.history-section{border-top:1px solid #101b3e;margin-top:30px;padding-top:26px}.history{padding-left:22px;font-size:13px}.history li{padding:8px 0;break-inside:avoid}.history-section>summary{font:600 20px Georgia,serif;cursor:pointer}footer{border-top:1px solid #dedbd8;margin-top:32px;padding-top:16px;color:#686868;font-size:12px}@media(max-width:700px){body{padding:24px 18px}h1{font-size:29px}.document-grid{display:block;padding-top:24px}.agreement-sheet{border:0;padding:0 0 28px}.agreement-sheet h2{font-size:22px}.source{font-size:17px;line-height:1.85;margin-top:18px}.index{display:block}.index li{padding:12px 0;border-bottom:1px solid #dedbd8;gap:4px}.review-notes{border-top:1px solid #dedbd8;padding-top:24px}dl{gap:12px 16px}}@media print{body{max-width:none;padding:0;font-size:10pt}.document-grid{display:block}.agreement-sheet{border:0;padding:0 0 24px}.review-notes{border:0}a{color:inherit;text-decoration:none}h2,h3,h4{break-after:avoid}.index{display:none}.source{font-size:11pt}.record-context,.history-section{display:block}.history-section>summary{display:none}}.revision-wording-change{list-style:none;margin:22px 0 26px}.revision-wording-change>strong{display:block;font-size:14px}.revision-wording-change .revision-redline{font-size:15px;line-height:1.75;margin:12px 0;white-space:pre-wrap}.revision-key{font-size:11px;color:#52617a}.revision-key del,.revision-key ins{margin-right:12px}.revision-word-before{color:#9b2529;background:#fdecee;text-decoration:line-through;text-decoration-thickness:1px;box-decoration-break:clone;-webkit-box-decoration-break:clone}.revision-word-after{color:#183e9b;background:#eaf0ff;text-decoration:underline;text-underline-offset:3px;box-decoration-break:clone;-webkit-box-decoration-break:clone}.revision-redline del+ins{margin-left:.28em}.revision-redline :target{outline:2px solid #2455c6;outline-offset:3px;scroll-margin-block:120px}.revision-edits ol{list-style:none;padding:0;margin:10px 0;border-block:1px solid #dbe1ed}.revision-edits a{display:flex;gap:12px;padding:12px 0;min-height:44px;color:inherit;text-decoration:none;font-size:13px;overflow-wrap:anywhere}.revision-edits a:focus-visible{outline:2px solid #2455c6;outline-offset:2px}.revision-edit-number{color:#52617a;min-width:12px;font-variant-numeric:tabular-nums}.revision-record>ul{padding-left:0;list-style-position:inside}.agreement-sheet{position:sticky;top:24px;align-self:start;max-height:calc(100vh - 48px);overflow:auto}@media(max-width:700px){.agreement-sheet{position:static;max-height:none;overflow:visible}}@media print{.agreement-sheet{position:static;max-height:none;overflow:visible}.revision-edits,.revision-key{display:none}.revision-redline :target{outline:none}}.citation-excerpt{margin:0}.citation-location{display:block;margin:0 0 7px;font-size:11px;line-height:1.5;color:#686868;overflow-wrap:anywhere}.citation-excerpt blockquote{margin:0;white-space:normal}.source-anchor{scroll-margin-block:72px}.source [data-source-ranges]{box-decoration-break:clone;-webkit-box-decoration-break:clone}.citation-location a{text-underline-offset:3px}.citation-paragraph{display:block;white-space:normal}.citation-paragraph.citation-table-rows,.citation-paragraph.citation-rate-rows{white-space:pre-line}.citation-page-watermark{display:block;white-space:normal;text-align:right;font:10px/1.4 Arial,sans-serif;color:#657086;border-bottom:1px solid #e1e5eb;margin:3px 0}.citation-page-furniture{display:block;white-space:normal;font:12px/1.4 Arial,sans-serif;color:#657086;border-block:1px solid #e1e5eb;padding:4px 0;margin:6px 0}.citation-break{display:block;height:.7em;line-height:0;white-space:normal}.citation-gap{margin:8px 0;text-align:center;color:#686868;font-size:17px;line-height:1}.citation-excerpt+.citation-excerpt{margin-top:18px}.citation-table-rows .citation-table-markup{font-size:0;line-height:0}.citation-table-rows .citation-table-cell{white-space:normal;padding-right:.8em}.citation-table-rows .citation-table-break{display:block;height:0;white-space:normal;border-bottom:1px solid #e1e5eb;margin:.3em 0}.citation-table-rows .citation-table-cell:empty{display:none}' + sourceHighlightCss + '.citation-table-multiline:has(>.citation-table-cell){display:grid!important;grid-template-columns:minmax(7em,1fr) minmax(0,1.45fr);column-gap:1em;align-items:start}.citation-table-multiline>.citation-table-markup{display:none}.citation-table-multiline>.citation-table-cell{min-width:0;padding-right:0}.citation-table-multiline:has(>.citation-table-cell):not(:has(>.citation-table-cell~.citation-table-cell)){grid-template-columns:minmax(0,1fr)}.citation-cell-break{display:block;height:0;margin:.65rem 0;font-size:0;line-height:0}.completion-criterion{font:17px/1.8 Georgia,serif;overflow-wrap:anywhere;white-space:normal}.source-return{position:sticky;top:0;z-index:1;background:white;max-height:120px;overflow:auto}.source-return a{display:none;padding:10px 0;font:600 13px/1.6 Arial,sans-serif;min-height:44px}.source-anchor{scroll-margin-block:160px}@media print{.source-return{display:none}}' + sourceReturnCss + '</style></head><body>' +
    '<header class="mast"><p class="sequence">PACT · AGREEMENT REVIEW SNAPSHOT</p><h1>' + escape(project.title) + '</h1>' +
    paragraph(partyNames(view.project).map(p => p.name).join(" · ")) + '<p class="meta">Evaluated at ' + escape(asOf) + ' (UTC). ' + view.project.events.length + ' recorded events.</p>' +
    '</header>' +
    '<nav aria-label="Commitments"><ul class="index">' + summaries + '</ul></nav>' +
    '<div class="document-grid"><section class="agreement-sheet"><nav class="source-return" aria-label="Return to commitments">'+sourceReturns+'</nav><h2>Complete agreement source</h2><p class="meta">Source ' + escape(project.source.id) + ' · revision ' + project.source.revision + '</p><div class="source">' + sourceHtml + '</div></section><div class="review-notes">' +
    (commitments || '<section><h2>No commitments recorded</h2></section>') + '</div></div>' +
    '<details class="history-section"><summary>Recorded event history</summary><ol class="history">' + (audit || '<li>No events recorded.</li>') + '</ol></details>' +
    '</body></html>';
}
