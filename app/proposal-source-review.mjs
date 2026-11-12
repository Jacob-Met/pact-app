import { sourceEnclosingSection } from "./source-references.mjs";
import { setCitationQuote } from "./citation-view.mjs";
import { mountSourceReferences } from "./source-references-ui.mjs";
import { LIMITS } from "./core.mjs";
import { citationPassages, citationText, sourceCitation, captureSourceCitation, MAX_CITATION_PASSAGES, MAX_CAPTURE_TOTAL_CHARACTERS } from "./source-citations.mjs";
import { sourceSearchHighlights, findSourceText, sourcePassages, sourcePassageRange, sourceSentencePassages, sourceSearchPassage, sourceSearchPreview, sourceDisplayText, sourceReferencePreview, sourceScopedMatches, canReadWholeSection } from "./source-passages.mjs";

export const MAX_REVIEW_QUOTE = 4000;

// Every edit is one contiguous slice of the original UTF-16 source.
export function proposalSourceContext(source, selection) {
  const { start, end, quote } = selection;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
      start < 0 || end <= start || end > source.length ||
      source.slice(start, end) !== quote || quote.length > MAX_REVIEW_QUOTE) {
    throw new RangeError("The selected passage no longer matches this agreement.");
  }
  const passages = sourcePassages(source);
  const first = passages.findIndex(p => p.end > start);
  let last = first;
  while (last + 1 < passages.length && passages[last + 1].start < end) last++;
  const sentences = sourceSentencePassages(source);
  const previous = sentences.findLast(passage => passage.start < start) ?? null;
  const next = sentences.find(passage => passage.end > end) ?? null;
  const contextStart = previous?.start ?? start;
  const contextEnd = next?.end ?? end;
  return {
    before: source.slice(contextStart, start), quote, after: source.slice(end, contextEnd),
    previous: previous && end - previous.start <= MAX_REVIEW_QUOTE
      ? { start: previous.start, end, quote: source.slice(previous.start, end) } : null,
    next: next && next.end - start <= MAX_REVIEW_QUOTE
      ? { start, end: next.end, quote: source.slice(start, next.end) } : null,
    first: first + 1, last: last + 1, total: passages.length,
    hasPrevious: Boolean(previous), hasNext: Boolean(next),
    clippedBefore: contextStart > 0, clippedAfter: contextEnd < source.length
  };
}

export { sourceReferencePreview as proposalReferencePreview } from "./source-passages.mjs";

export function sourceSelectionForDraft(proposal, selection, criterionLimit) {
  const changed = JSON.stringify(citationPassages(proposal)) !== JSON.stringify(citationPassages(selection));
  const wording = citationText(selection);
  const {related: previousRelated, ...originalFields} = proposal;
  return {
    ...originalFields, ...selection,
    criterion: changed ? (wording.length <= criterionLimit ? wording : "") : proposal.criterion,
    sourceSelectionEdited: changed
  };
}

// Presentation order never changes the canonical source-order citation.
export function proposalReviewGroups(source, proposal, ranges = citationPassages(proposal)) {
  const coverage = proposal?.conditionCoverage;
  const names = ["answer_clauses", "qualifying_clauses", "definition_clauses"];
  const units = sourceSentencePassages(source);
  if (!coverage || names.some(name => !Array.isArray(coverage[name]))) return null;
  const ids = names.flatMap(name => coverage[name]);
  if (!coverage.answer_clauses.length || new Set(ids).size !== ids.length ||
      ids.some(id => !Number.isSafeInteger(id) || id < 1 || id > units.length)) return null;
  const roles = names.map(name => coverage[name].map(id => units[id - 1]));
  const keys = ["answer", "conditions", "definitions"];
  const groups = [
    {key:"answer", label:"Answer", passages:[]},
    {key:"conditions", label:"Conditions", passages:[]},
    {key:"added", label:"Added passages", passages:[]},
    {key:"definitions", label:"Definitions", passages:[]}
  ];
  ranges.forEach((range,index) => {
    const role = roles.findIndex(parts => parts.some(part => part.start < range.end && part.end > range.start));
    groups.find(item => item.key === (role < 0 ? "added" : keys[role])).passages.push({index, range});
  });
  // Question overlap chooses a reading starting point, never evidence membership.
  const stop = new Set("a an and are as at be by can do does for from how if in is it may must of on or shall should that the their them then these this those to under was what when where whether which who will with would".split(" "));
  const words = value => (value.toLocaleLowerCase("en").match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter(word => word.length > 2 && !stop.has(word))
    .map(word => word.length > 4 && word.endsWith("s") ? word.slice(0,-1) : word);
  const query = [...new Set(words(typeof proposal.reviewQuestion === "string" ? proposal.reviewQuestion : ""))];
  const score = part => {
    const text = new Set(words(part.quote));
    return query.reduce((total,word) => total + (text.has(word) ? 1 : 0), 0);
  };
  for (const item of groups[0].passages) {
    item.focus = roles[0].filter(part => part.start >= item.range.start && part.end <= item.range.end)
      .sort((a,b) => score(b)-score(a) || a.start-b.start)[0] ?? null;
  }
  if (query.length) {
    groups[0].passages.sort((a,b) => score(b.range)-score(a.range) || a.index-b.index);
  }
  return groups.filter(group => group.passages.length);
}

export function mountProposalSourceReview({ document }) {
  const find = id => document.getElementById(id);
  const panel = document.querySelector(".source-panel");
  const sourceInput = document.querySelector(".citation-source");
  const sheet = document.querySelector(".proposal-sheet");
  const reader = document.createElement("div");
  reader.className = "source-reader";
  const originalSource = document.createElement("details");
  originalSource.className = "source-original";
  originalSource.open = true;
  const sourceHeading = document.createElement("summary");
  sourceHeading.textContent = "Full agreement";
  originalSource.append(sourceHeading);
  sourceInput.before(reader);
  originalSource.append(sourceInput);
  reader.append(originalSource, sheet);
  panel.classList.add("source-review-layout");
  const before = find("ai-context-before"), quote = find("ai-review-quote"), after = find("ai-context-after");
  const previous = find("ai-include-previous"), next = find("ai-include-next"), reset = find("ai-reset-selection");
  const position = find("ai-review-position"), frame = find("ai-review-context");
  const rangePicker = find("ai-range-picker"), from = find("ai-range-from"), through = find("ai-range-through");
  const rangeNotice = find("ai-range-notice");
  const search = find("ai-source-find"), found = find("ai-source-found");
  const findPrevious = find("ai-source-find-previous"), findNext = find("ai-source-find-next");
  const findStatus = find("ai-source-find-status"), includeFound = find("ai-source-include-found");
  const addSeparate=document.createElement("button");addSeparate.type="button";
  addSeparate.id="ai-source-add-separate";addSeparate.textContent="Add separate passage";
  includeFound.textContent="Extend current passage";includeFound.after(addSeparate);
  const referencesHost = document.createElement("nav");
  referencesHost.id = "ai-source-references"; frame.after(referencesHost);
  const references = mountSourceReferences({ document, host: referencesHost, onTarget: browseReference });
  const foundReferencesHost = document.createElement("nav");
  foundReferencesHost.id = "ai-found-references"; found.after(foundReferencesHost);
  const foundReferences = mountSourceReferences({ document, host: foundReferencesHost, onTarget: browseReference });
  const scopeBar = document.createElement("div"); scopeBar.className = "source-reference-scope"; scopeBar.hidden = true;
  const scopeLabel = document.createElement("strong");
  const leaveScope = document.createElement("button"); leaveScope.type = "button";
  leaveScope.id = "ai-source-whole-agreement"; leaveScope.textContent = "Search whole agreement";
  const scopeContext = document.createElement("span");
  const readWhole=document.createElement("button");readWhole.type="button";readWhole.id="ai-source-read-full-section";
  readWhole.textContent="Read full section";readWhole.hidden=true;
  scopeBar.append(scopeLabel, scopeContext, readWhole, leaveScope); search.parentElement.before(scopeBar);
  found.tabIndex = -1;
  const returnReference = document.createElement("button");
  returnReference.type = "button"; returnReference.id = "ai-source-reference-back";
  returnReference.className = "quiet"; returnReference.hidden = true;
  scopeBar.before(returnReference);
  let referenceScope = null, referenceHistory = [];
  function updateReturn() {
    const previous = referenceHistory.at(-1);
    returnReference.hidden = !previous;
    returnReference.textContent = !previous ? "" : previous.scope
      ? "Back to " + (previous.scope.kind === "definition" ? "“"+previous.scope.label+"”" : previous.scope.kind+" "+previous.scope.label)
      : previous.query ? "Back to search results" : "Back to selected passage";
  }
  function rememberReference() {
    referenceHistory.push({scope:referenceScope ? {...referenceScope} : null,query:search.value,index:matchIndex,scrollTop:found.scrollTop});
    if(referenceHistory.length>20)referenceHistory.shift();
    updateReturn();
  }
  function showScope() {
    scopeBar.hidden = !referenceScope;
    if (!referenceScope) return;
    readWhole.hidden=!canReadWholeSection(source,referenceScope);
    readWhole.textContent=referenceScope.readWhole ? "Read by passage" : "Read full section";
    references.showEnclosing(source,referenceScope,scopeContext);
    scopeLabel.textContent = referenceScope.kind === "definition"
      ? "“" + referenceScope.label + "”" + (referenceScope.location ? " · " + referenceScope.location : "")
      : referenceScope.kind[0].toUpperCase() + referenceScope.kind.slice(1) + " " + referenceScope.label;
  }
  returnReference.addEventListener("click",()=>{
    const previous=referenceHistory.pop();
    if(!previous)return;
    referenceScope=previous.scope;search.value=previous.query;
    showScope();refreshMatches(previous.index);updateReturn();found.scrollTop=previous.scrollTop;
    const destination=matches.length?found:frame;
    (returnReference.hidden?destination:returnReference).scrollIntoView({block:"start",behavior:"instant"});destination.focus({preventScroll:true});
  });
  const contextNodes = [...frame.childNodes];
  const remove = document.createElement("button");
  remove.type = "button"; remove.textContent = "Remove this passage";
  remove.id = "ai-remove-passage"; next.after(remove);
  let ranges = [], activeRange = 0;
  const openGroups = new Set();
  const firstAnswer = () => proposalReviewGroups(source, original, ranges)?.find(group => group.key === "answer")?.passages[0]?.index ?? 0;
  const canonical = parts => captureSourceCitation({id:"proposal-review",revision:1,text:source},parts);
  const selection = () => { const {sourceId,sourceRevision,...value}=canonical(ranges); return value; };
  const replaceActive = range => ranges.map((part,index)=>index===activeRange?range:part);
  const canReplace = range => { try {canonical(replaceActive(range));return true;}catch{return false;} };
  function chooseParts(parts, focusRange) {
    try {
      const nextRanges = citationPassages(canonical(parts));
      ranges = nextRanges;
      activeRange = Math.max(0,ranges.findIndex(part=>part.start<=focusRange.start&&part.end>focusRange.start));
      selected = ranges[activeRange]; render(); return true;
    } catch { rangeNotice.textContent="Keep up to "+MAX_CITATION_PASSAGES+" passages, each at most 4,000 characters and "+MAX_CAPTURE_TOTAL_CHARACTERS.toLocaleString("en-US")+" in total. Your selected passages were kept."; return false; }
  }
  remove.addEventListener("click",()=>{
    if(ranges.length<2)return;
    ranges=ranges.filter((_,index)=>index!==activeRange);
    activeRange=Math.min(activeRange,ranges.length-1);selected=ranges[activeRange];render();frame.focus({preventScroll:true});
  });
  let source = "", original = null, selected = null, matches = [], matchIndex = -1, matched = null, searchPassages = [], searchSentences = [];
  function refreshMatches(index = 0) {
    matches = sourceScopedMatches(source, search.value, referenceScope, {sentences:searchSentences});
    paintFind(index);
  }
  function browseReference(target) {
    rememberReference();
    referenceScope = {...target,readWhole:false};
    showScope();rangePicker.open = true; search.value = "";
    refreshMatches();
    found.focus({preventScroll:true}); rangePicker.scrollIntoView({block:"start",behavior:"instant"});
  }
  function readSection(whole){referenceScope={...referenceScope,readWhole:whole};readWhole.textContent=whole?"Read by passage":"Read full section";search.value="";refreshMatches();found.scrollIntoView({block:"start",behavior:"instant"});found.focus({preventScroll:true});}
  readWhole.addEventListener("click",()=>readSection(!referenceScope.readWhole));
  leaveScope.addEventListener("click", () => {
    rememberReference();referenceScope = null; scopeBar.hidden = true; refreshMatches(); search.focus({preventScroll:true});
  });
  function alreadyCaptured(range) {
    let through = range.start;
    for (const part of ranges) {
      if (part.end <= through) continue;
      if (part.start > through) return false;
      through = part.end;
      if (through >= range.end) return true;
    }
    return false;
  }
  function paintFind(index) {
    found.replaceChildren(); matched = null; foundReferences.clear();
    found.hidden = !matches.length;
    includeFound.disabled = true;addSeparate.disabled=true;
    findPrevious.disabled = findNext.disabled = matches.length < 2;
    const browsing = Boolean(referenceScope && !search.value.trim());
    const readingDefinition = browsing && referenceScope.kind === "definition";
    const readingLongSection=browsing&&referenceScope.readWhole&&referenceScope.end-referenceScope.start>MAX_REVIEW_QUOTE;
    found.classList.toggle("is-reference",browsing);
    includeFound.hidden = readingDefinition || readingLongSection;
    find("ai-apply").textContent=ranges.length>1?"Use selected passages":"Use selected passage";
    addSeparate.textContent = readingDefinition ? "Add definition" : browsing&&referenceScope.readWhole ? "Add full section" : "Add separate passage";
    search.closest("label").hidden = readingDefinition;
    findPrevious.parentElement.hidden = readingDefinition || Boolean(browsing&&referenceScope.readWhole);
    findPrevious.textContent = browsing ? "Previous passage" : "Previous match";
    findNext.textContent = browsing ? "Next passage" : "Next match";
    if (!matches.length) {
      findStatus.textContent = search.value.trim() ? "No matching text. Your selected passage is unchanged." : "";
      return;
    }
    matchIndex = (index + matches.length) % matches.length;
    const match = matches[matchIndex];
    const searchScope = referenceScope ?? sourceEnclosingSection(source, match);
    matched = searchScope
      ? sourceReferencePreview(source, match, searchScope, {passages:searchPassages,sentences:searchSentences})
      : sourceSearchPreview(source, match, {passages:searchPassages,sentences:searchSentences});
    if (referenceScope) {
      const start = Math.max(matched.start, referenceScope.start), end = Math.min(matched.end, referenceScope.end);
      matched = {...matched, start, end, quote:source.slice(start,end)};
    }
    foundReferences.update(source, [matched], {scope:referenceScope});
    const {first,last} = matched;
    found.classList.toggle("is-sentence",matched.sentenceCount === 1);
    setCitationQuote(document,found,sourceDisplayText(source.slice(matched.start,matched.end)),browsing ? [] : sourceSearchHighlights(source,match,search.value).map(range=>({
      start:sourceDisplayText(source.slice(matched.start,range.start)).length,
      end:sourceDisplayText(source.slice(matched.start,range.end)).length
    })),{before:sourceDisplayText(source.slice(0,matched.start))});
    findStatus.textContent = (referenceScope ? scopeLabel.textContent + " · " : "") +
      (browsing ? "Passage " : "Match ") + (matchIndex+1) + " of " + matches.length +
      " · " + (first===last ? "source passage "+(first+1) : "source passages "+(first+1)+"–"+(last+1));
    includeFound.disabled = matched.start>=selected.start&&matched.end<=selected.end;
    addSeparate.disabled=alreadyCaptured(matched);
  }
  function clearFind() {
    search.value = ""; matchIndex = -1; refreshMatches();
  }
  search.addEventListener("input",()=>{if(referenceScope){referenceScope={...referenceScope,readWhole:false};readWhole.textContent="Read full section";}refreshMatches();});
  search.addEventListener("keydown", event => {
    if(event.key==="Enter") {event.preventDefault();paintFind(matchIndex+(event.shiftKey?-1:1));}
    if(event.key==="Escape") {event.preventDefault();clearFind();}
  });
  findPrevious.addEventListener("click",()=>paintFind(matchIndex-1));
  findNext.addEventListener("click",()=>paintFind(matchIndex+1));
  includeFound.addEventListener("click",()=>{
    if(!matched || !selected)return;
    const start=Math.min(selected.start,matched.start),end=Math.max(selected.end,matched.end);
    if(end-start>MAX_REVIEW_QUOTE) {rangeNotice.textContent="Including this passage would exceed 4,000 characters. Your selected passage was kept. You can add it separately.";return;}
    if(!chooseParts(replaceActive({start,end,quote:source.slice(start,end)}),{start,end}))return;
    frame.focus({preventScroll:true});
  });
  addSeparate.addEventListener("click",()=>{
    if(!matched||!selected)return;
    const part={start:matched.start,end:matched.end,quote:source.slice(matched.start,matched.end)};
    if(chooseParts([...ranges,part],part)){frame.focus({preventScroll:true});quote.scrollIntoView({block:"start",behavior:"instant"});}
  });
  function populateRangeChoices() {
    const passages = sourcePassages(source);
    for (const select of [from, through]) {
      select.replaceChildren();
      passages.forEach((passage, index) => {
        const option = document.createElement("option");
        option.value = String(index);
        const text = passage.quote.replace(/\s+/g, " ");
        option.textContent = String(index + 1) + ". " + text.slice(0, 90) + (text.length > 90 ? "…" : "");
        select.append(option);
      });
    }
  }
  function render() {
    frame.replaceChildren();
    const groups = proposalReviewGroups(source, original, ranges);
    function addPart(host, part, index) {
      const section=document.createElement("section");section.className="proposal-source-part";
      section.dataset.proposalPassage=String(index);
      const button=document.createElement("button");button.type="button";
      button.textContent=(index===activeRange?"Editing":"Edit")+" passage "+(index+1)+" of "+ranges.length;
      button.disabled=index===activeRange;
      button.addEventListener("click",()=>{activeRange=index;selected=ranges[index];render();frame.querySelector('[data-proposal-passage="'+index+'"]')?.scrollIntoView({block:"nearest"});frame.focus({preventScroll:true});});
      section.append(button);
      if(index===activeRange)section.append(...contextNodes);
      else {const text=document.createElement("div");text.className="proposal-other-quote";setCitationQuote(document,text,sourceDisplayText(part.quote));section.append(text);}
      host.append(section);
    }
    if (groups && ranges.length > 1) {
      for (const group of groups) {
        const definitions = group.key === "definitions";
        const host = document.createElement(definitions ? "details" : "section");
        host.className = "proposal-source-group"; host.dataset.proposalGroup = group.key;
        const heading = document.createElement(definitions ? "summary" : "h4");
        heading.textContent = group.label + " · " + group.passages.length + (group.passages.length === 1 ? " passage" : " passages");
        host.append(heading);
        if (definitions) {
          host.open = openGroups.has(group.key) || group.passages.some(part => part.index === activeRange);
          host.addEventListener("toggle",()=>{if(host.open)openGroups.add(group.key);else openGroups.delete(group.key);});
        }
        for (const {range,index} of group.passages) addPart(host,range,index);
        frame.append(host);
      }
    } else if(ranges.length===1)frame.append(...contextNodes);
    else ranges.forEach((part,index)=>addPart(frame,part,index));
    remove.hidden=ranges.length<2;
    find("ai-apply").textContent=ranges.length>1?"Use selected passages":"Use selected passage";
    const context = proposalSourceContext(source, selected);
    references.update(source, [selected]);
    from.value = String(context.first - 1);
    through.value = String(context.last - 1);
    for (const option of through.options) option.disabled = Number(option.value) < context.first - 1;
    rangeNotice.textContent = "";
    if(matched){includeFound.disabled=matched.start>=selected.start&&matched.end<=selected.end;
      addSeparate.disabled=alreadyCaptured(matched);}
    before.textContent = sourceDisplayText(context.before);
    setCitationQuote(document,quote,sourceDisplayText(context.quote));
    const focus = groups?.find(group => group.key === "answer")?.passages.find(part => part.index === activeRange)?.focus;
    if (focus) {
      const focusOffset = sourceDisplayText(source.slice(selected.start,focus.start)).length;
      let offset = 0;
      for (const part of quote.children) {
        const end = offset + part.textContent.length;
        if (end > focusOffset) {
          if (part.classList.contains("citation-paragraph")) part.dataset.proposalAnswer = String(focus.start);
          break;
        }
        offset = end;
      }
    }
    quote.classList.toggle("complete-sentence", sourceSentencePassages(context.quote).length === 1);
    after.textContent = sourceDisplayText(context.after);
    before.classList.toggle("complete-sentence", sourceSentencePassages(context.before).length === 1);
    after.classList.toggle("complete-sentence", sourceSentencePassages(context.after).length === 1);
    find("ai-context-start").hidden = !context.clippedBefore;
    find("ai-context-end").hidden = !context.clippedAfter;
    previous.hidden = !context.hasPrevious;
    previous.disabled = !context.previous || !canReplace(context.previous);
    previous.title = context.hasPrevious && !context.previous ? "The passage is at its 4,000-character limit." : "";
    next.hidden = !context.hasNext;
    next.disabled = !context.next || !canReplace(context.next);
    next.title = context.hasNext && !context.next ? "The passage is at its 4,000-character limit." : "";
    reset.hidden = JSON.stringify(citationPassages(original)) === JSON.stringify(ranges);
    position.textContent = (context.first === context.last ? "Passage " + context.first : "Passages " + context.first + "–" + context.last) + " of " + context.total;
  }
  function include(direction) {
    if (!selected) return;
    const range = proposalSourceContext(source, selected)[direction];
    if (!range) return;
    if(!chooseParts(replaceActive(range),range))return;
    // A disappearing end-of-document button must not strand keyboard focus.
    const button = direction === "previous" ? previous : next;
    if (button.hidden || button.disabled) reset.focus({ preventScroll: true });
  }
  function chooseRange() {
    if (!selected) return;
    const first = Number(from.value), last = Math.max(first, Number(through.value));
    const range = sourcePassageRange(source, first, last);
    if (!range || range.quote.length > MAX_REVIEW_QUOTE) {
      render();
      rangeNotice.textContent = "Choose a range of at most 4,000 characters. Your current selection was kept.";
      return;
    }
    if(!chooseParts(replaceActive(range),range))return;
  }
  from.addEventListener("change", chooseRange);
  through.addEventListener("change", chooseRange);
  previous.addEventListener("click", () => include("previous"));
  next.addEventListener("click", () => include("next"));
  reset.addEventListener("click", () => {
    ranges=citationPassages(original);openGroups.clear();activeRange=firstAnswer();selected=ranges[activeRange];render();
    focusAnswer();
  });
  function focusAnswer() {
    frame.focus({ preventScroll: true });
    const answer = quote.querySelector("[data-proposal-answer]");
    (answer ?? frame).scrollIntoView({ block: "start", behavior: "instant" });
  }
  return {
    focusAnswer,
    show(text, proposal) {
      reader.classList.add("is-reviewing");
      originalSource.open = false;
      source = text; original = proposal; referenceScope = null; referenceHistory=[];updateReturn();scopeBar.hidden = true;
      searchPassages = sourcePassages(source); searchSentences = sourceSentencePassages(source);
      rangePicker.open = false;
      populateRangeChoices();
      ranges=citationPassages(sourceCitation({id:"proposal-review",revision:1,text:source},citationPassages(proposal)));
      openGroups.clear();activeRange=firstAnswer();selected=ranges[activeRange];
      clearFind();
      render();
    },
    proposal(criterionLimit = LIMITS.criterion) {
      proposalSourceContext(source, selected);
      return sourceSelectionForDraft(original, selection(), criterionLimit);
    },
    clear() {
      reader.classList.remove("is-reviewing");
      originalSource.open = true;
      source = ""; original = null; selected = null; ranges=[];activeRange=0;openGroups.clear();
      referenceScope = null; referenceHistory=[];updateReturn();scopeBar.hidden = true; references.clear();
      frame.replaceChildren(...contextNodes);remove.hidden=true;
      searchPassages = []; searchSentences = [];
      clearFind();
      rangePicker.open = false;
      rangeNotice.textContent = "";
      from.replaceChildren(); through.replaceChildren();
      before.textContent = quote.textContent = after.textContent = position.textContent = "";
    }
  };
}
