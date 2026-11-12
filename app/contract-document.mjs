import { mountSourceReferences } from "./source-references-ui.mjs";
import { createSourceSelectionMap } from "./source-dom-selection.mjs";
import { renderSourceFile } from "./source-file-review.mjs";
import { sourceDisplayText, findSourceText } from "./source-passages.mjs";
import { sourceTextSegments, appendSourceText } from "./citation-view.mjs";
import { partyNames } from "./core.mjs";
import { citationPassages } from "./source-citations.mjs";
import { formatUsdMinor } from "./ui-utils.mjs";
// The full original agreement remains beside its recorded obligations.
// Text nodes and exact offsets preserve source text, including uncited conditions.
export function mountContractDocument(root, onSelect, {onCapture = null, hasCitation = () => false, getDraftCitation = () => null} = {}) {
  const doc = root.ownerDocument;
  const article = doc.createElement("article");
  article.className = "contract-document";
  article.setAttribute("aria-label", "Complete agreement with cited obligations");
  const header = doc.createElement("header");
  const caption = doc.createElement("p"); caption.className = "contract-document__caption"; caption.textContent = "Agreement";
  const title = doc.createElement("h2");
  const parties = doc.createElement("p"); parties.className = "contract-document__parties";
  const sourceFile = doc.createElement("div"); sourceFile.className = "contract-source-file";
  header.append(caption, title, parties, sourceFile);
  let fileIdentity = "";
  const body = doc.createElement("div"); body.className = "contract-document__body";
  const searchBar = doc.createElement("form"); searchBar.className = "contract-reader-search"; searchBar.setAttribute("role","search");
  const search = doc.createElement("input"); search.type = "search"; search.placeholder = "Find in this agreement"; search.setAttribute("aria-label","Find in complete agreement"); search.id = "contract-reader-find";
  const searchCount = doc.createElement("span"); searchCount.setAttribute("role","status");
  const searchPrevious = doc.createElement("button"); searchPrevious.type="button";searchPrevious.textContent="Previous";searchPrevious.setAttribute("aria-label","Previous agreement match");
  const searchNext = doc.createElement("button");searchNext.type="submit";searchNext.textContent="Next";searchNext.setAttribute("aria-label","Next agreement match");
  searchBar.append(search,searchCount,searchPrevious,searchNext);article.append(header,searchBar,body);
  const returnDraft = doc.createElement("button");
  returnDraft.type = "button"; returnDraft.textContent = "Return to captured passages";
  returnDraft.className = "contract-reader-return"; returnDraft.hidden = true;
  let returnAction = null;
  returnDraft.addEventListener("click", () => {const action = returnAction; returnAction = null; returnDraft.hidden = true; action?.();});
  searchBar.append(returnDraft);
  const draftKey = doc.createElement("span"); draftKey.className = "contract-draft-key";
  draftKey.textContent = "Captured in this draft"; draftKey.hidden = true; searchBar.append(draftKey);
  const canvas=root.querySelector(".network-canvas");
  if(canvas)canvas.after(article);else root.append(article);
  let source = "", obligations = [], selectedId = null, project = null;
  let links = [], sourceRange = null, sourceMarks = [];
  let selectionMap = createSourceSelectionMap(doc, body), selectedSource = null;
  let searchMatches = [], searchIndex = -1;
  const highlightName = "pact-reader-search";
  function showSearch(scroll = true) {
    const match = searchMatches[searchIndex];
    const range = match && selectionMap.range(match.start,match.end);
    const css = doc.defaultView.CSS;
    css?.highlights?.delete(highlightName);
    body.querySelector(".contract-search-paragraph")?.classList.remove("contract-search-paragraph");
    searchCount.textContent = search.value.trim() ? (match ? `${searchIndex+1} of ${searchMatches.length}` : "No matches") : "";
    searchPrevious.disabled = searchNext.disabled = searchMatches.length < 2;
    if (!range) return;
    if(css?.highlights && doc.defaultView.Highlight) css.highlights.set(highlightName,new doc.defaultView.Highlight(range));
    const paragraph = range.startContainer.parentElement.closest(".contract-clause");
    paragraph?.classList.add("contract-search-paragraph");
    if (scroll) {
      // A source paragraph can span many screens. Center the matched text,
      // without inserting marker nodes into the exact-source selection map.
      const view = doc.defaultView;
      const matchRect = () => [...range.getClientRects()].find(rect => rect.height && rect.width);
      for (let container = range.startContainer.parentElement; container && container !== doc.scrollingElement; container = container.parentElement) {
        const style = view.getComputedStyle(container);
        if (!/(auto|scroll)/.test(style.overflowY) || container.scrollHeight <= container.clientHeight) continue;
        const rect = matchRect();
        if (!rect) return;
        const bounds = container.getBoundingClientRect();
        container.scrollBy({top: rect.top + rect.height / 2 - (bounds.top + container.clientTop + container.clientHeight / 2), behavior: "instant"});
      }
      const rect = matchRect();
      if (rect) view.scrollBy({top: rect.top + rect.height / 2 - view.innerHeight / 2, behavior: "instant"});
    }
  }
  function refreshSearch() {searchMatches=findSourceText(source,search.value);searchIndex=searchMatches.length?0:-1;showSearch();}
  function moveSearch(step) {if(searchMatches.length){searchIndex=(searchIndex+step+searchMatches.length)%searchMatches.length;showSearch();}}
  search.addEventListener("input",refreshSearch);
  searchBar.addEventListener("submit",event=>{event.preventDefault();moveSearch(1);});
  searchPrevious.addEventListener("click",()=>moveSearch(-1));
  search.addEventListener("keydown",event=>{if(event.key==="Enter"&&event.shiftKey){event.preventDefault();moveSearch(-1);}if(event.key==="Escape"){event.preventDefault();search.value="";refreshSearch();}});
  const captureBar = doc.createElement("div"); captureBar.className = "contract-source-selection"; captureBar.hidden = true;
  captureBar.setAttribute("role", "region"); captureBar.setAttribute("aria-label", "Selected agreement wording");
  const selectionCount = doc.createElement("span"); selectionCount.setAttribute("role", "status");
  const useSelection = doc.createElement("button"); useSelection.type = "button"; useSelection.textContent = "Use selected text"; useSelection.dataset.readerCapture = "replace";
  const addSelection = doc.createElement("button"); addSelection.type = "button"; addSelection.textContent = "Add to captured passages"; addSelection.dataset.readerCapture = "append";
  const clearSelection = doc.createElement("button"); clearSelection.type = "button"; clearSelection.textContent = "Clear selection";
  const readRelated = doc.createElement("button"); readRelated.type = "button"; readRelated.textContent = "Read related wording";
  readRelated.dataset.readerRelated = "open";
  captureBar.append(selectionCount, useSelection, addSelection, readRelated, clearSelection); article.append(captureBar);
  const relatedPanel = doc.createElement("aside"); relatedPanel.className = "contract-reader-related";
  relatedPanel.setAttribute("aria-label", "Related source wording");
  const relatedHeading = doc.createElement("p"); relatedHeading.textContent = "Related wording";
  const relatedHost = doc.createElement("div");
  const closeRelated = doc.createElement("button"); closeRelated.type = "button"; closeRelated.textContent = "Close related wording";
  const captureRelated = doc.createElement("button"); captureRelated.type = "button";
  captureRelated.dataset.readerCapture = "provision"; captureRelated.hidden = !onCapture;
  relatedPanel.append(captureRelated, relatedHeading, relatedHost, closeRelated);
  const backRelated = doc.createElement("button"); backRelated.type = "button"; backRelated.textContent = "Back to previous passage";
  backRelated.hidden = true; backRelated.dataset.readerRelated = "back"; searchBar.append(backRelated);
  let relatedRange = null, relatedHistory = [];
  const related = mountSourceReferences({document:doc, host:relatedHost, onTarget(target) {
    if (relatedRange) relatedHistory.push({...relatedRange});
    if (relatedHistory.length > 20) relatedHistory.shift();
    openRelated(target);
  }});
  function placeRelated() {
    if (!relatedRange) return;
    const range = selectionMap.range(relatedRange.start, relatedRange.end);
    const paragraph = range?.endContainer.parentElement.closest(".contract-clause");
    if (paragraph) paragraph.after(relatedPanel);
    related.update(source, [relatedRange], {scope:relatedRange});
    const captureLabel = relatedRange.label || "this passage";
    captureRelated.textContent = hasCitation() ? "Add " + captureLabel + " to draft" : "Use " + captureLabel;
    backRelated.hidden = !relatedHistory.length;
  }
  function openRelated(target) {
    if (target.quote !== source.slice(target.start,target.end)) return;
    relatedRange = {...target}; sourceRange = {start:target.start,end:target.end};
    paint();
    sourceMarks[0]?.scrollIntoView({block:"center",behavior:"instant"});
    sourceMarks[0]?.focus({preventScroll:true});
  }
  readRelated.addEventListener("click", () => {
    if (!selectedSource) return;
    relatedHistory = []; openRelated({...selectedSource});
  });
  backRelated.addEventListener("click", () => {
    const previous = relatedHistory.pop();
    if (previous) openRelated(previous);
  });
  closeRelated.addEventListener("click", () => {
    relatedPanel.remove(); relatedRange = null; relatedHistory = [];
    backRelated.hidden = true;
    sourceMarks[0]?.focus({preventScroll:true});
  });
  const clearSourceSelection = () => { selectedSource = null; captureBar.hidden = true; };
  const readSelection = () => {
    if (!onCapture || !project || !article.getClientRects().length) { clearSourceSelection(); return; }
    const selected = selectionMap.read(doc.getSelection(), source);
    if (!selected && captureBar.contains(doc.activeElement)) return;
    selectedSource = selected; captureBar.hidden = !selected;
    if (selected) { selectionCount.textContent = selected.quote.length.toLocaleString() + " characters selected"; addSelection.hidden = !hasCitation(); useSelection.textContent = hasCitation() ? "Replace captured passages" : "Use selected text"; }
  };
  doc.addEventListener("selectionchange", readSelection);
  captureBar.addEventListener("pointerdown", event => { if (event.target.closest("button")) event.preventDefault(); });
  const captureRange = (selected, append) => {
    if (!selected || !project || !onCapture) return;
    if (onCapture({...selected, sourceId:project.source.id, sourceRevision:project.source.revision}, {append}) === true) {
      clearSourceSelection(); doc.getSelection()?.removeAllRanges();
    }
  };
  useSelection.addEventListener("click", () => captureRange(selectedSource, false));
  addSelection.addEventListener("click", () => captureRange(selectedSource, true));
  captureRelated.addEventListener("click", () => captureRange(relatedRange, true));
  clearSelection.addEventListener("click", () => { clearSourceSelection(); doc.getSelection()?.removeAllRanges(); article.focus({preventScroll:true}); });
  function appendMappedText(target, original, sourceStart, table) {
    const fragment = doc.createDocumentFragment();
    appendSourceText(doc, fragment, sourceDisplayText(original), {table});
    selectionMap.register(fragment, original, sourceStart);
    target.append(fragment);
  }
  const choices = doc.createElement("div");
  choices.id = "contract-obligation-choices";
  choices.className = "contract-obligation-choices";
  choices.setAttribute("role", "dialog");
  choices.setAttribute("aria-modal", "false");
  choices.setAttribute("aria-label", "Choose an obligation for this passage");
  let choiceOrigin = null;
  function closeChoices(restoreFocus = false) {
    const origin = choiceOrigin;
    origin?.setAttribute("aria-expanded", "false");
    choices.remove();
    choices.replaceChildren();
    choiceOrigin = null;
    if (restoreFocus) origin?.focus({preventScroll:true});
  }
  function openChoices(link, citing) {
    if (choiceOrigin === link) { closeChoices(true); return; }
    closeChoices();
    choiceOrigin = link;
    link.setAttribute("aria-expanded", "true");
    const heading = doc.createElement("p");
    heading.className = "contract-obligation-choices__heading";
    heading.textContent = "Choose an obligation";
    const list = doc.createElement("ul");
    for (const item of citing) {
      const row = doc.createElement("li");
      const button = doc.createElement("button");
      button.type = "button";
      button.dataset.contractChoice = item.id;
      button.setAttribute("aria-pressed", String(item.id === selectedId));
      const label = doc.createElement("span"); label.textContent = item.title;
      const amount = doc.createElement("span");
      amount.className = "contract-obligation-choices__amount";
      amount.textContent = formatUsdMinor(item.amountMinor) + " USD";
      button.append(label, amount);
      button.addEventListener("click", () => {
        closeChoices();
        onSelect(item.id);
        link.focus({preventScroll:true});
      });
      row.append(button);
      list.append(row);
    }
    const close = doc.createElement("button");
    close.type = "button";
    close.className = "contract-obligation-choices__close";
    close.textContent = "Close";
    close.addEventListener("click", () => closeChoices(true));
    choices.append(heading, list, close);
    link.closest(".contract-clause").after(choices);
    list.querySelector("button")?.focus({preventScroll:true});
    choices.scrollIntoView({block:"nearest"});
  }
  choices.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); closeChoices(true); return; }
    const options = [...choices.querySelectorAll("[data-contract-choice]")];
    const current = options.indexOf(doc.activeElement);
    let next = null;
    if (event.key === "ArrowDown") next = Math.min(options.length - 1, current + 1);
    if (event.key === "ArrowUp") next = Math.max(0, current - 1);
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = options.length - 1;
    if (next !== null) { event.preventDefault(); options[next]?.focus(); }
  });
  const outsideChoices = event => {
    if (choiceOrigin && !choices.contains(event.target) && !choiceOrigin.contains(event.target)) closeChoices();
  };
  doc.addEventListener("pointerdown",outsideChoices);
  function labelCitation(link, citing, text, chosen) {
    link.dataset.contractObligation = chosen.id;
    link.dataset.contractObligationCount = String(citing.length);
    link.setAttribute("aria-label", text.trim() + (citing.length > 1
      ? " — Choose from " + citing.length + " obligations"
      : " — Open " + chosen.title));
    if (citing.length > 1) {
      link.setAttribute("aria-haspopup", "dialog");
      link.setAttribute("aria-controls", choices.id);
      link.setAttribute("aria-expanded", "false");
    }
  }
  function paint() {
    closeChoices();
    body.replaceChildren();
    selectionMap = createSourceSelectionMap(doc, body); clearSourceSelection();
    links = []; sourceMarks = [];
    if (!project) return;
    const identity = JSON.stringify([project.source.file ?? null, project.source.text]);
    if (identity !== fileIdentity) {
      fileIdentity = identity; sourceFile.replaceChildren();
      if (project.source.file) {
        const label = doc.createElement("p"); label.className = "muted";
        label.textContent = project.source.file.textEdited ? "Agreement text was edited after extraction." : "Agreement text was extracted from this file.";
        sourceFile.append(label, renderSourceFile(project.source));
      }
    }
    title.textContent = project.title;
    parties.textContent = partyNames(project).map(p => p.name).join(" / ");
    const draftCitation = getDraftCitation();
    const draftPassages = draftCitation?.sourceId === project.source.id && draftCitation?.sourceRevision === project.source.revision
      ? citationPassages(draftCitation).filter(p => Number.isInteger(p.start) && Number.isInteger(p.end)
        && p.start >= 0 && p.end <= source.length && p.end > p.start && p.quote === source.slice(p.start,p.end)) : [];
    draftKey.hidden = !draftPassages.length;
    const citedPassages=obligations.flatMap(item => citationPassages(item.citation).map(passage => ({item,...passage})));
    let offset=0, paragraphNumber=0;
    for (const part of sourceTextSegments(source)) {
      const start = offset, end = start + part.text.length;offset=end;
      const paragraph = doc.createElement(part.className==="citation-break"?"span":"p");
      paragraph.className = part.className==="citation-break"?"contract-source-break":"contract-clause "+part.className;
      paragraph.dataset.clauseStart = start;
      if(part.className!=="citation-break"){
        const number = doc.createElement("span");
        number.className = "contract-clause__number"; number.textContent = String(++paragraphNumber).padStart(2, "0");
        number.setAttribute("aria-hidden", "true");paragraph.append(number);
      }
      const related = citedPassages.filter(passage => passage.start < end && passage.end > start);
      const draftRelated = draftPassages.filter(passage => passage.start < end && passage.end > start);
      const rangeBounds = sourceRange && sourceRange.start < end && sourceRange.end > start
        ? [Math.max(start,sourceRange.start),Math.min(end,sourceRange.end)] : [];
      const boundaries = [...new Set([start, end, ...rangeBounds, ...draftRelated.flatMap(p => [Math.max(start,p.start),Math.min(end,p.end)]), ...related.flatMap(passage => [Math.max(start,passage.start),Math.min(end,passage.end)])])].sort((a,b)=>a-b);
      for(let i=0;i<boundaries.length-1;i++){
        const a=boundaries[i], b=boundaries[i+1], text=source.slice(a,b);
        let target = paragraph;
        if(sourceRange && a >= sourceRange.start && b <= sourceRange.end){
          const mark=doc.createElement("mark");mark.className="contract-reference-focus";
          mark.dataset.sourceStart=String(a);mark.dataset.sourceEnd=String(b);
          mark.tabIndex=-1;paragraph.append(mark);sourceMarks.push(mark);target=mark;
        }
        if (draftRelated.some(p => p.start <= a && p.end >= b)) {
          const captured = doc.createElement("span"); captured.className = "contract-draft-capture";
          captured.title = "Captured in this draft"; captured.dataset.draftStart = String(a); captured.dataset.draftEnd = String(b);
          target.append(captured); target = captured;
        }
        const citing=[...new Set(related.filter(passage=>passage.start<=a && passage.end>=b).map(passage=>passage.item))];
        if(!citing.length){appendMappedText(target,text,a,part.className.includes("citation-table-rows"));continue;}
        const chosen=citing.find(item=>item.id===selectedId)??citing[0];
        const link=doc.createElement("button");link.type="button";link.className="contract-citation";
        appendMappedText(link,text,a,part.className.includes("citation-table-rows"));
        link.setAttribute("aria-pressed",String(citing.some(item=>item.id===selectedId)));
        labelCitation(link,citing,text,chosen);
        links.push({link,citing,text,start:a,end:b});
        link.addEventListener("click",()=>citing.length > 1 ? openChoices(link,citing) : onSelect(link.dataset.contractObligation));
        target.append(link);
      }
      body.append(paragraph);
    }
    showSearch(false);
    placeRelated();
  }
  return {
    refreshDraft() {if(project)paint();},
    setReturnAction(action, label = "Return to captured passages") {returnAction = action; returnDraft.textContent = label; returnDraft.hidden = !action;},
    destroy() {doc.defaultView.CSS?.highlights?.delete(highlightName);closeChoices();doc.removeEventListener("pointerdown",outsideChoices);doc.removeEventListener("selectionchange",readSelection);article.remove();},
    scrollSourceRange(passage, { behavior = "smooth", block = "center", showRelated = false } = {}) {
      if(!Number.isInteger(passage?.start)||!Number.isInteger(passage?.end)
        ||passage.start<0||passage.end<=passage.start||passage.end>source.length
        ||(passage.quote!==undefined&&passage.quote!==source.slice(passage.start,passage.end)))return false;
      relatedRange = showRelated ? {...passage} : null; relatedHistory = [];
      relatedPanel.remove(); backRelated.hidden = true;
      sourceRange={start:passage.start,end:passage.end};paint();
      sourceMarks[0]?.scrollIntoView({block,behavior});
      sourceMarks[0]?.focus({preventScroll:true});
      return true;
    },
    clearSourceRange() {if(sourceRange || relatedRange){sourceRange=null;relatedRange=null;relatedHistory=[];relatedPanel.remove();backRelated.hidden=true;paint();}},
    scrollPassage(passage, { behavior = "smooth", block = "center" } = {}) {
      const target=links.find(item=>item.end>passage.start && item.start<passage.end);
      target?.link.scrollIntoView({block,behavior});
      target?.link.focus({preventScroll:true});
    },
    scrollSelected({ behavior = "smooth" } = {}) { body.querySelector('[aria-pressed="true"]')?.scrollIntoView({block:"center",behavior}); },
    selectedParagraph() { return body.querySelector('[aria-pressed="true"]')?.closest(".contract-clause"); },
    update(view, items) {relatedRange=null;relatedHistory=[];relatedPanel.remove();backRelated.hidden=true;returnAction=null;returnDraft.hidden=true;project=view.project;source=project.source.text;obligations=items;sourceRange=null;search.value="";searchMatches=[];searchIndex=-1;paint();showSearch(false);},
    select(id, scroll=false) {
      closeChoices();
      selectedId=id;
      for (const {link,citing,text} of links) {
        const chosen = citing.find(item=>item.id===id)??citing[0];
        labelCitation(link,citing,text,chosen);
        link.setAttribute("aria-pressed",String(citing.some(item=>item.id===id)));
      }
      if(scroll) body.querySelector('[aria-pressed="true"]')?.scrollIntoView({block:"center",behavior:"smooth"});
    }
  };
}
