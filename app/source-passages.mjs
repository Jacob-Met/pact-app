import { setCitationQuote, sourceTextSegments } from "./citation-view.mjs";
import { MAX_CITATION_CHARACTERS } from "./source-citations.mjs";

// Exact source ranges for an explicit authoring choice; no clause interpretation.
export function sourcePassages(text) {
  return [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(text)]
    .map(({ segment, index }) => {
      const start = index + segment.length - segment.trimStart().length;
      const end = index + segment.trimEnd().length;
      return { start, end, quote: text.slice(start, end) };
    }).filter(passage => passage.end > passage.start);
}

// Recognize the numbered-line forms used by the bounded-context selector.
export function sourceLineMarker(text) {
  const clause=text.match(/^([ \t]*)([A-Z]\d+(?:\.\d+)*)(?:[.)](?=[ \t]))?[ \t]+/);
  if(clause)return {indent:clause[1].replace(/\t/g,"    ").length,family:"alphanumeric",token:clause[2]};

  const match = text.match(/^([ \t]*)(?:(\d+(?:\.\d+)*)[.)]|\(([a-z0-9]+)\)|([a-z]|[ivxlcdm]+)[.)]|([-*•]))[ \t]+/i);
  if (!match) return null;
  const token = match[2] || match[3] || match[4] || match[5];
  const family = match[5] ? "bullet" : /^\d/.test(token) ? "number" : token.length > 1 ? "roman" : "letter";
  return { indent: match[1].replace(/\t/g, "    ").length, family, token };
}

// Join only wrapped lines for sentence recognition; every UTF-16 position stays
// aligned with the unchanged source. Paragraph and list boundaries stay visible.
export function sourceSentencePassages(text) {
  const lines = [...text.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)]
    .filter(match => match[0].length)
    .map(match => ({ raw: match[0], text: match[0].replace(/(?:\r\n|\r|\n)$/, "") }));
  const pageNumber = line => /^\s*(?:page\s+)?\d+\s+of\s+\d+\s*$/i.test(line);
  const proxy = lines.map((line, index) => {
    const next = lines[index + 1];
    const joins = next && line.text.trim() && next.text.trim() &&
      !sourceLineMarker(next.text) && !pageNumber(line.text) && !pageNumber(next.text);
    return joins ? line.raw.replace(/[\r\n]/g, " ") : line.raw;
  }).join("");
  const ranges = [];
  const bracketBalance = value => {
    const open = [];
    for (const bracket of value.match(/[()[\]]/g) || []) {
      if (bracket === "(" || bracket === "[") open.push(bracket);
      else if (open.at(-1) === (bracket === ")" ? "(" : "[")) open.pop();
    }
    return open.length;
  };
  for (const {segment,index} of new Intl.Segmenter("en", {granularity:"sentence"}).segment(proxy)) {
    const start = index + segment.length - segment.trimStart().length;
    const end = index + segment.trimEnd().length;
    if (end <= start) continue;
    const previous = ranges.at(-1);
    // A period inside a still-open citation such as "(41 U.S.C. 6305)"
    // does not finish the displayed sentence. Never cross a retained line break.
    if (previous && bracketBalance(proxy.slice(previous.start,previous.end)) > 0 &&
        !/[\r\n]/.test(proxy.slice(previous.end,start))) previous.end = end;
    else ranges.push({start,end});
  }
  return ranges.map(({start,end}) => ({start,end,quote:text.slice(start,end)}));
}

// Search expands only its preview. Existing passage IDs and saved choices are
// unchanged, and capture/inclusion remains an explicit author action.
export function sourceSearchPassage(text, match, {
  passages = sourcePassages(text), sentences = sourceSentencePassages(text)
} = {}) {
  if (!match || !Number.isSafeInteger(match.start) || !Number.isSafeInteger(match.end) ||
      match.start < 0 || match.end <= match.start || match.end > text.length) return null;
  const touched = sentences.filter(part => part.end > match.start && part.start < match.end);
  const start = touched[0]?.start ?? match.start, end = touched.at(-1)?.end ?? match.end;
  const first = passages.findIndex(part => part.end > start);
  if (first < 0) return null;
  let last = first;
  while (last + 1 < passages.length && passages[last + 1].start < end) last++;
  const rangeStart = passages[first].start, rangeEnd = passages[last].end;
  return {first,last,start:rangeStart,end:rangeEnd,quote:text.slice(rangeStart,rangeEnd),
    sentenceCount:touched.length};
}

// Reading can show the complete section; explicit capture keeps its own bound.
export function canReadWholeSection(source, scope) {
  return Boolean(scope && scope.kind !== "definition" &&
    Number.isSafeInteger(scope.start) && Number.isSafeInteger(scope.end) &&
    scope.start >= 0 && scope.end > scope.start && scope.end <= source.length);
}

// The scoped reader keeps the source's own page-watermark interruption visible.
// This expands a human preview only; the model selection and draft stay unchanged.
export function sourceReferencePreview(source, match, scope, options = {}) {
  const passages = options.passages ?? sourcePassages(source);
  const sentences = options.sentences ?? sourceSentencePassages(source);
  if (scope?.kind === "definition" || (scope?.readWhole && canReadWholeSection(source,scope))) {
    const whole = sourceSearchPassage(source, {start:scope.start,end:scope.end}, {passages,sentences});
    return whole && {...whole,start:scope.start,end:scope.end,quote:source.slice(scope.start,scope.end)};
  }
  let range = sourceSearchPassage(source, match, {passages,sentences});
  if (!range || !scope) return range;
  const start = Math.max(scope.start,range.start), end = Math.min(scope.end,range.end);
  if (end <= start) return null;
  range = {...range,start,end,quote:source.slice(start,end),
    first:passages.findIndex(part=>part.end>start),
    last:passages.findLastIndex(part=>part.start<end)};
  const sentenceEnd = /[.!?][\s\u201d\u2019"')\]]*$/;
  const pageWatermark = /^(?:[ \t]*\r?\n){2,}[ \t]{20,}[A-Z]{1,2}[ \t]*(?:\r?\n)+[ \t]*/;
  const previous = sentences.findLast(part => part.end <= range.start);
  if (previous && previous.start >= scope.start && range.end <= scope.end &&
      range.end - previous.start <= MAX_CITATION_CHARACTERS && !sentenceEnd.test(previous.quote)) {
    const leadingBreak = source.slice(previous.end, range.end).match(pageWatermark);
    const continuationStart = leadingBreak && previous.end + leadingBreak[0].length;
    if (leadingBreak && match.end > continuationStart &&
        (range.start <= continuationStart || !source.slice(continuationStart, range.start).trim()))
      range = sourceSearchPassage(source, {start:previous.start,end:range.end}, {passages,sentences});
  }
  if (sentenceEnd.test(range.quote)) return range;
  const tail = source.slice(range.end, scope.end);
  const pageBreak = tail.match(pageWatermark);
  if (!pageBreak) return range;
  const continuationStart = range.end + pageBreak[0].length;
  const continuation = sentences.find(part => part.end > continuationStart);
  if (!continuation || continuation.end > scope.end || continuation.end - range.start > MAX_CITATION_CHARACTERS) return range;
  return sourceSearchPassage(source, {start:range.start,end:continuation.end}, {passages,sentences});
}

// Both source readers browse the same exact section boundaries and source units.
// Ordinary text search uses the same source-preserving watermark continuation
// as referenced reading. It does not select additional governing provisions.
export function sourceSearchPreview(source, match, options = {}) {
  return sourceReferencePreview(source, match, {start:0,end:source.length}, options);
}

export function sourceScopedMatches(source, query, scope, {sentences=sourceSentencePassages(source)} = {}) {
  const needle=query.trim();
  let matches=needle?findSourceText(source,needle):(scope?.kind==="definition" || (scope?.readWhole && canReadWholeSection(source,scope)))
    ?[{start:scope.start,end:scope.end}]:scope
    ?sentences.filter(part=>part.start<scope.end&&part.end>scope.start)
      .map(part=>({start:Math.max(part.start,scope.start),end:Math.min(part.end,scope.end)}))
      .filter(part=>!/^(?:[ivxlcdm]+|[a-z]|\d+(?:\.\d+)*)[.)]$/i.test(source.slice(part.start,part.end).trim()))
    :[];
  return scope?matches.filter(part=>part.start>=scope.start&&part.end<=scope.end):matches;
}

export function sourcePassageRange(text, first, last) {
  const passages = sourcePassages(text);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) ||
      first < 0 || last < first || last >= passages.length) return null;
  const start = passages[first].start, end = passages[last].end;
  return { start, end, quote: text.slice(start, end) };
}


// Render every original line boundary, including lone CR, without altering citation data.
export const sourceDisplayText = text => text.replace(/\r\n?/g, "\n");

// Textareas normalize CRLF and CR to LF. Citations retain the original source.
export function sourceViewRange(text, start, end) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
      start < 0 || end <= start || end > text.length) return null;
  const offset = value => text.slice(0, value).replace(/\r\n?/g, "\n").length;
  return { start: offset(start), end: offset(end) };
}

export function sourceSelection(text, start, end) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) return null;
  let source = 0, view = 0, sourceStart;
  while (source <= text.length) {
    if (view === start) sourceStart = source;
    if (view === end) {
      const splitsPair = offset => offset > 0 && offset < text.length &&
        /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset]);
      if (sourceStart === undefined || splitsPair(sourceStart) || splitsPair(source)) return null;
      return { start: sourceStart, end: source, quote: text.slice(sourceStart, source) };
    }
    if (source === text.length) break;
    source += text[source] === "\r" && text[source + 1] === "\n" ? 2 : 1;
    view += 1;
  }
  return null;
}

function literalSourceMatches(text, needle, omitted = null) {
  let normalized = "", starts = [], ends = [];
  for (let offset = 0; offset < text.length;) {
    if (omitted?.has(offset)) { offset = omitted.get(offset); continue; }
    const start = offset;
    let value;
    if (/\s/.test(text[offset])) {
      while (offset < text.length && /\s/.test(text[offset])) offset++;
      value = " ";
    } else {
      const point = String.fromCodePoint(text.codePointAt(offset));
      offset += point.length; value = point.toLowerCase();
    }
    normalized += value;
    for (let i = 0; i < value.length; i++) { starts.push(start); ends.push(offset); }
  }
  const matches = [];
  for (let from = 0;;) {
    const index = normalized.indexOf(needle, from);
    if (index < 0) break;
    matches.push({ start: starts[index], end: ends[index + needle.length - 1] });
    from = index + needle.length;
  }
  return matches;
}


// PDF extraction can split a word after a hyphen. Search both its retained
// hyphen and joined spelling, keeping every result in original source positions.
// A blank line, list break or numeric range is not a wrapped word.
function wrappedSourceMatches(text, needle) {
  const joined = new Map(), hyphenated = new Map();
  for (const match of text.matchAll(/(\p{L})-[\t ]*(?:\r\n|\r|\n)[\t ]*(?=\p{L})/gu)) {
    const hyphen = match.index + match[1].length, end = match.index + match[0].length;
    joined.set(hyphen,end); hyphenated.set(hyphen+1,end);
  }
  return joined.size
    ? [...literalSourceMatches(text,needle,joined),...literalSourceMatches(text,needle,hyphenated)]
    : [];
}

// Search keeps literal matches and also follows prose across the same PDF page
// furniture the reader displays separately. Neither source nor citation changes.
export function findSourceText(text, query) {
  const needle=query.trim().replace(/\s+/g," ").toLowerCase();
  if(!needle)return [];
  const unique=new Map();
  const collect = source => {
    for(const match of [...literalSourceMatches(source,needle),...wrappedSourceMatches(source,needle)])
      unique.set(match.start+":"+match.end,match);
  };
  collect(text);
  if(needle.includes(" ")){
    const parts=sourceTextSegments(text);
    if(parts.some(part=>part.className==="citation-page-furniture")){
      const prose=parts.map(part=>/^citation-page-(?:furniture|watermark)$/.test(part.className)
        ? " ".repeat(part.text.length) : part.text).join("");
      if(prose!==text)collect(prose);
    }
  }
  return [...unique.values()].sort((a,b)=>a.start-b.start||a.end-b.end);
}

// A phrase found across page furniture highlights its prose words only.
// Literal searches for the furniture itself still highlight the original text.
export function sourceSearchHighlights(source, match, query) {
  const normalized=value=>value.trim().replace(/\s+/g," ").toLowerCase();
  if(normalized(source.slice(match.start,match.end))===normalized(query))return [match];
  const ranges=[];let offset=0;
  for(const part of sourceTextSegments(source)){
    const start=Math.max(offset,match.start),end=Math.min(offset+part.text.length,match.end);
    if(end>start&&!/^citation-page-(?:furniture|watermark)$/.test(part.className))ranges.push({start,end});
    offset+=part.text.length;
    if(offset>=match.end)break;
  }
  return ranges;
}

export function mountSourcePassages({ document, mountReferences, searchScope, sourceView, onCapture, hasCitation = () => false }) {
  const choice = document.querySelector("#source-passage");
  const through = document.querySelector("#source-passage-end");
  const preview = document.querySelector("#source-passage-preview");
  const count = document.querySelector("#source-passage-count");
  const use = document.querySelector("#use-source-passage");
  const add = document.querySelector("#add-source-passage");
  const includePrevious = document.querySelector("#source-include-previous");
  const includeNext = document.querySelector("#source-include-next");
  const search = document.querySelector("#source-find");
  const previous = document.querySelector("#source-find-previous");
  const next = document.querySelector("#source-find-next");
  const searchStatus = document.querySelector("#source-find-status");
  const rangePicker = document.querySelector("#source-range-picker");
  let text = null, passages = [], sentences = [], matches = [], matchIndex = -1, referenceScope = null, searchSelection = null;
  const referenceHost=document.createElement("nav");referenceHost.id="source-references";preview.after(referenceHost);
  const references=mountReferences({document,host:referenceHost,onTarget:browseReference});
  const scopeBar=document.createElement("div");scopeBar.className="source-reference-scope";scopeBar.hidden=true;
  const scopeLabel=document.createElement("strong"),leaveScope=document.createElement("button");
  const history=[],back=document.createElement("button");back.type="button";back.id="source-reference-back";back.hidden=true;
  leaveScope.type="button";leaveScope.id="source-whole-agreement";leaveScope.textContent="Search whole agreement";
  const scopeContext=document.createElement("span");
  const readWhole=document.createElement("button");readWhole.type="button";readWhole.id="source-read-full-section";
  readWhole.textContent="Read full section";readWhole.hidden=true;
  scopeBar.append(back,scopeLabel,scopeContext,readWhole,leaveScope);search.parentElement.before(scopeBar);preview.tabIndex=-1;
  const useLabel=use.textContent,addLabel=add?.textContent;
  function refreshMatches(){
    matches=sourceScopedMatches(text??"",search.value,referenceScope,{sentences});matchIndex=-1;
    previous.disabled=next.disabled=matches.length<2;
    const browsing=Boolean(referenceScope&&!search.value.trim());
    const readingDefinition=browsing&&referenceScope.kind==="definition";
    search.closest("label").hidden=readingDefinition;
    previous.parentElement.hidden=readingDefinition||Boolean(browsing&&referenceScope.readWhole);
    previous.textContent=browsing?"Previous passage":"Previous match";next.textContent=browsing?"Next passage":"Next match";
    searchStatus.textContent=search.value.trim()&&!matches.length?"No matching text. Your chosen passage is unchanged.":"";
    if(matches.length)found(0);else paint();
  }
  const referenceLabel = target => target.kind==="definition"
    ?"“"+target.label+"”"+(target.location?" · "+target.location:"")
    :target.kind[0].toUpperCase()+target.kind.slice(1)+" "+target.label;
  function paintScope(){
    back.hidden=!history.length;
    back.textContent=history.length?"Back to "+(history.at(-1).scope?referenceLabel(history.at(-1).scope):"passage"):"Back to passage";
    scopeBar.hidden=!referenceScope;
    readWhole.hidden=!referenceScope||!canReadWholeSection(text,referenceScope);
    readWhole.textContent=referenceScope?.readWhole?"Read by passage":"Read full section";
    if(referenceScope){scopeLabel.textContent=referenceLabel(referenceScope);references.showEnclosing(text,referenceScope,scopeContext);}
    else {scopeLabel.textContent="";scopeContext.replaceChildren();}
  }
  function browseReference(target){
    if(range()){
      history.push({scope:referenceScope?{...referenceScope}:null,query:search.value,index:matchIndex,
        first:choice.value,last:through.value,selection:searchSelection?{...searchSelection}:null,rangeOpen:rangePicker.open});
      if(history.length>20)history.shift();
    }
    referenceScope={...target,readWhole:false};paintScope();
    search.value="";refreshMatches();preview.scrollIntoView({block:"center",behavior:"instant"});preview.focus({preventScroll:true});
  }
  back.addEventListener("click",()=>{
    const prior=history.pop();if(!prior)return;
    referenceScope=prior.scope;search.value=prior.query;paintScope();refreshMatches();
    if(prior.index>=0&&prior.index<matches.length)found(prior.index);
    choice.value=prior.first;through.value=prior.last;searchSelection=prior.selection;rangePicker.open=prior.rangeOpen;paint();
    preview.scrollIntoView({block:"center",behavior:"instant"});preview.focus({preventScroll:true});
  });
  function readSection(whole){referenceScope={...referenceScope,readWhole:whole};readWhole.textContent=whole?"Read by passage":"Read full section";search.value="";refreshMatches();preview.scrollIntoView({block:"start",behavior:"instant"});preview.focus({preventScroll:true});}
  readWhole.addEventListener("click",()=>readSection(!referenceScope.readWhole));
  leaveScope.addEventListener("click",()=>{referenceScope=null;history.length=0;paintScope();refreshMatches();search.focus({preventScroll:true});});
  function matchPreview(match) {
    const scope = referenceScope ?? searchScope?.(text, match);
    return scope ? sourceReferencePreview(text, match, scope, {passages,sentences}) : sourceSearchPreview(text, match, {passages,sentences});
  }
  function found(index) {
    if (!matches.length) return;
    matchIndex = (index + matches.length) % matches.length;
    const match = matches[matchIndex];
    const selected = matchPreview(match);
    searchSelection = referenceScope ? null : selected;
    rangePicker.open = false;
    choice.value = String(selected.first); through.value = String(selected.last); paint();
    searchStatus.textContent = (referenceScope?scopeLabel.textContent+" · ":"")+(referenceScope&&!search.value.trim()?"Passage ":"Match ") + (matchIndex + 1) + " of " + matches.length;
  }
  search.addEventListener("input", ()=>{if(referenceScope){referenceScope={...referenceScope,readWhole:false};readWhole.textContent="Read full section";}refreshMatches();});
  search.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); found(matchIndex + (event.shiftKey ? -1 : 1)); }
    if (event.key === "Escape") { event.preventDefault(); search.value = ""; search.dispatchEvent(new Event("input")); }
  });
  previous.addEventListener("click", () => found(matchIndex - 1));
  next.addEventListener("click", () => found(matchIndex + 1));
  const range = () => {
    if(choice.value===""||through.value==="")return null;
    // Search may stop within a source passage; retain its exact bounds for capture.
    // Explicit range controls clear this selection and expand the original passages.
    if (searchSelection && !referenceScope) return {start:searchSelection.start,end:searchSelection.end,quote:searchSelection.quote};
    const selected=sourcePassageRange(text,Number(choice.value),Number(through.value));
    if(!selected||!referenceScope)return selected;
    const start=Math.max(selected.start,referenceScope.start),end=Math.min(selected.end,referenceScope.end);
    return end>start?{start,end,quote:text.slice(start,end)}:null;
  };
  function reset() {
    searchSelection = null;
    choice.value = ""; through.value = ""; through.disabled = true;
    preview.hidden = true; preview.textContent = ""; count.textContent = ""; use.disabled = true; use.hidden = true;
    if (add) { add.disabled = true; add.hidden = true; }
    for (const option of [...choice.options,...through.options]) option.disabled = false;
    references.clear();
    includePrevious.disabled = includeNext.disabled = true;
  }
  function paint() {
    const first = choice.value === "" ? null : Number(choice.value);
    through.disabled = first === null;
    const outsideScope=option=>referenceScope&&option.value!==""&&(passages[Number(option.value)].end<=referenceScope.start||passages[Number(option.value)].start>=referenceScope.end);
    for(const option of choice.options)option.disabled=Boolean(outsideScope(option));
    for (const option of through.options) option.disabled = Boolean(outsideScope(option)) || (option.value !== "" && first !== null && Number(option.value) < first);
    const selected = range();
    const browsing=Boolean(referenceScope&&!search.value.trim());
    const readingDefinition=browsing&&referenceScope.kind==="definition";
    const readingFullSection=browsing&&referenceScope.readWhole;
    preview.classList.toggle("is-reference",browsing);
    use.textContent=readingFullSection?"Use full section":readingDefinition?"Use definition":useLabel;
    if(add)add.textContent=readingFullSection?"Add full section":readingDefinition?"Add definition":addLabel;
    preview.replaceChildren();
    if(selected){
      const highlights=browsing?[]:matches.filter(m=>m.start>=selected.start&&m.end<=selected.end).flatMap(match=>sourceSearchHighlights(text,match,search.value)).map(match=>({
        start:sourceDisplayText(text.slice(selected.start,match.start)).length,
        end:sourceDisplayText(text.slice(selected.start,match.end)).length
      }));
      setCitationQuote(document,preview,sourceDisplayText(selected.quote),highlights,{before:sourceDisplayText(text.slice(0,selected.start))});
    }
    const foundRange = matches[matchIndex] ? matchPreview(matches[matchIndex]) : null;
    references.update(text??"",selected?[selected]:[],{scope:referenceScope});
    preview.classList.toggle("is-sentence",Boolean(selected && foundRange?.sentenceCount === 1 && selected.start === foundRange.start && selected.end === foundRange.end));
    preview.hidden = !selected; use.disabled = !selected; use.hidden = !selected;
    if (add) { add.disabled = !selected || !hasCitation(); add.hidden = add.disabled; }
    includePrevious.disabled = !selected || first === 0 || Boolean(referenceScope&&passages[first-1]?.end<=referenceScope.start);
    includeNext.disabled = !selected || Number(through.value) === passages.length - 1 || Boolean(referenceScope&&passages[Number(through.value)+1]?.start>=referenceScope.end);
    const size = selected ? Number(through.value) - first + 1 : 0;
    count.textContent = selected ? (size === 1 ? "1 passage" : size + " passages") + " · " + selected.quote.length.toLocaleString() + " characters" : "";
  }
  choice.addEventListener("change", () => {
    searchSelection = null;
    if (choice.value === "") { reset(); return; }
    if (through.value === "" || Number(through.value) < Number(choice.value)) through.value = choice.value;
    paint();
  });
  through.addEventListener("change", () => { searchSelection = null; paint(); });
  includePrevious.addEventListener("click", () => { searchSelection = null; choice.value = String(Number(choice.value) - 1); paint(); });
  includeNext.addEventListener("click", () => { searchSelection = null; through.value = String(Number(through.value) + 1); paint(); });
  function capture(append) {
    const selected = range();
    if (!selected) return;
    const view = sourceViewRange(text, selected.start, selected.end);
    sourceView.setSelectionRange(view.start, view.end);
    onCapture(selected, { append });
  }
  use.addEventListener("click", () => capture(false));
  add?.addEventListener("click", () => capture(true));
  return {
    reset,
    refresh: paint,
    openReference: browseReference,
    selection: () => [choice.value, through.value],
    selectRange(start, end) {
      searchSelection = null;
      const first = passages.findIndex(passage => passage.start === start);
      const last = passages.findIndex(passage => passage.end === end);
      if (first < 0 || last < first) { reset(); return false; }
      choice.value = String(first); through.value = String(last); paint(); return true;
    },
    update(source) {
      if (source === text) return;
      text = source; referenceScope=null;history.length=0;paintScope();passages = sourcePassages(source); sentences = sourceSentencePassages(source);
      search.closest("label").hidden=false;previous.parentElement.hidden=false;
      previous.textContent="Previous match";next.textContent="Next match";
      preview.classList.remove("is-reference");
      use.textContent=useLabel;if(add)add.textContent=addLabel;
      rangePicker.open = false;
      search.value = ""; matches = []; matchIndex = -1;
      searchStatus.textContent = ""; previous.disabled = next.disabled = true;
      for (const [select, placeholderText] of [[choice, "Choose a starting passage"], [through, "Choose the last passage"]]) {
        const placeholder = document.createElement("option");
        placeholder.value = ""; placeholder.textContent = placeholderText;
        select.replaceChildren(placeholder);
        passages.forEach((passage, index) => {
          const option = document.createElement("option");
          option.value = String(index);
          const compact = passage.quote.replace(/\s+/g, " ");
          option.textContent = String(index + 1) + ". " + compact.slice(0, 90) + (compact.length > 90 ? "…" : "");
          select.append(option);
        });
      }
      reset();
    }
  };
}
