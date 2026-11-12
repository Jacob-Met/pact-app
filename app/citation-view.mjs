const escape = value => String(value).replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));

export function citationLocation(citation, passage, index, count) {
  return (count > 1 ? "Passage " + (index + 1) + " · " : "") +
    "Source revision " + citation.sourceRevision + " · characters " + passage.start + "–" + passage.end;
}

// Reflow soft PDF lines while keeping every source character in the text nodes.
// Runs of blank lines are one visual paragraph gap, not several empty screens.
const quoteParts = text => text.split(/((?:\r\n|\r(?!\n)|\n)[\t ]*(?:\r\n|\r(?!\n)|\n)(?:[\t ]*(?:\r\n|\r(?!\n)|\n))*|(?:\r\n|\r(?!\n)|\n)(?=[\t ]*(?:[A-Z]\d+(?:\.\d+)*|\d+[.)])[\t ]+\S))/);
const paragraphClass = text => {
  const lines=text.split(/\r\n|\r|\n/);
  if(lines.some(line=>/^[ \t]*\|[^|\r\n]+\|[^\r\n]*\S/.test(line)) || lines.filter(line=>/^[ \t]*\|.*\|[ \t]*$/.test(line)).length>=2 || /^[ \t]*\|[^\r\n]*\|[ \t]*$/.test(text))
    return "citation-paragraph citation-table-rows"+(text.includes("\u2029")?" citation-table-multiline":"");
  return lines.filter(line => /[ \t]{2,}[$€£]\s*\d/.test(line)).length >= 2
    ? "citation-paragraph citation-rate-rows" : "citation-paragraph";
};
// Preserve the observed PDF template's page furniture as distinct source text.
const pageFurniture = /(?:^|\r\n|\r|\n)(?:SAMPLE[\t ]*(?:\r\n|\r|\n)+)?Project Name[\t ]*(?:\r\n|\r|\n)Consultant[’']s Agreement[\t ]*(?:\r\n|\r|\n)Contract Number[\t ]*(?:\r\n|\r|\n)Page \d+ of \d+[\t ]*(?:\r\n|\r|\n|$)/g;
const pageWatermark = /(?:[ \t]*\r?\n){2,}[ \t]{20,}[A-Z]{1,2}[ \t]*(?:\r?\n)+[ \t]*/g;
export function sourceTextSegments(text, {before = ""} = {}) {
  const context = before + text;
  const result=[];let cursor=0;
  const prose=value=>quoteParts(value).forEach((part,index)=>{
    if(!part)return;
    if(index%2===0 && part.includes("\u2029")){
      for(const line of part.split(/(\r\n|\r|\n)/).filter(Boolean))
        result.push({text:line,className:/^[\r\n]+$/.test(line)?"citation-break":paragraphClass(line)});
    }else result.push({text:part,className:index%2?"citation-break":paragraphClass(part)});
  });
  const furniture=[...context.matchAll(pageFurniture)].map(match=>({match,className:"citation-page-furniture"}));
  furniture.push(...[...context.matchAll(pageWatermark)].map(match=>({match,className:"citation-page-watermark"})));
  if(furniture.some(part=>part.className==="citation-page-furniture")){
    const templateWatermark=/^(?:[\t ]*SA|[\t ]{20,}(?:M|PL|E))[\t ]*(?:\r\n|\r|\n|$)/gm;
    furniture.push(...[...context.matchAll(templateWatermark)].map(match=>({match,className:"citation-page-watermark"})));
  }
  for(const {match,className} of furniture.sort((a,b)=>a.match.index-b.match.index)){
    const start=Math.max(0,match.index-before.length);
    const end=Math.min(text.length,match.index+match[0].length-before.length);
    if(end<=cursor||start<cursor)continue;
    prose(text.slice(cursor,start));
    result.push({text:text.slice(start,end),className});
    cursor=end;
  }
  prose(text.slice(cursor));return result;
}
// Keep extracted table punctuation and padding in the source text nodes while
// presenting each row as readable fields. Offsets remain valid for highlights.
export function sourceTablePieces(text) {
  return text.split(/(\r\n|\r|\n|[ \t]*\|[ \t]*)/).filter(Boolean).map(text=>({
    text, className:/^[\r\n]+$/.test(text)?"citation-table-break"
      :text.includes("|")?"citation-table-markup":"citation-table-cell"
  }));
}
export function appendSourceText(document,node,text,{table=false}={}) {
  if(!table){node.append(document.createTextNode(text));return;}
  for(const part of sourceTablePieces(text)){
    const span=document.createElement("span");span.className=part.className;
    if(part.className==="citation-table-cell" && part.text.includes("\u2029")){
      for(const text of part.text.split(/(\u2029)/)){
        const child=document.createElement("span");child.textContent=text;
        if(text==="\u2029")child.className="citation-cell-break";
        span.append(child);
      }
    }else span.textContent=part.text;
    if(part.className==="citation-table-markup")span.setAttribute("aria-hidden","true");
    node.append(span);
  }
}
export function setCitationQuote(document, node, text, highlights = [], context = {}) {
  node.replaceChildren(...sourceTextSegments(text,context).map(part=>{
    const span=document.createElement("span");
    span.className=part.className;
    if(part.className.includes("citation-table-rows"))appendSourceText(document,span,part.text,{table:true});
    else span.textContent=part.text;
    return span;
  }));
  if(highlights.length){
    const ranges=[...highlights].sort((a,b)=>a.start-b.start),walker=document.createTreeWalker(node,4),nodes=[];
    let offset=0,textNode;
    while((textNode=walker.nextNode())){nodes.push({node:textNode,start:offset,end:offset+textNode.textContent.length});offset+=textNode.textContent.length;}
    for(const item of nodes){
      const value=item.node.textContent,pieces=[];let cursor=0;
      for(const range of ranges){
        const start=Math.max(cursor,range.start-item.start,0),end=Math.min(value.length,range.end-item.start);
        if(end<=start)continue;
        const mark=document.createElement("mark");mark.textContent=value.slice(start,end);
        pieces.push(document.createTextNode(value.slice(cursor,start)),mark);cursor=end;
      }
      if(pieces.length){pieces.push(document.createTextNode(value.slice(cursor)));item.node.replaceWith(...pieces);}
    }
  }
  return node;
}
export function sourceTextHtml(text, render=escape, context={}) {
  let offset=0;
  return sourceTextSegments(text,context).map(part=>{
    let content;
    if(part.className.includes("citation-table-rows")){
      content=sourceTablePieces(part.text).map(piece=>{
        const value=piece.text.split(/(\u2029)/).map(text=>{
          const rendered=render(text,offset);offset+=text.length;
          return text==="\u2029"?'<span class="citation-cell-break">'+rendered+'</span>':rendered;
        }).join("");
        return '<span class="'+piece.className+'"'+(piece.className==="citation-table-markup"?' aria-hidden="true"':"")+'>'+value+'</span>';
      }).join("");
    }else{content=render(part.text,offset);offset+=part.text.length;}
    return '<span class="'+part.className+'">'+content+'</span>';
  }).join("");
}

// The caller supplies normalized exact passages from the core citation reader.
// Ellipses and locations are presentation, never part of a quoted source span.
export function renderCitationExcerpts(document, citation, passages) {
  const root=document.createElement("div");root.className="citation-excerpts";
  const quotes=[];
  passages.forEach((passage,index)=>{
    if(index&&passage.start>passages[index-1].end){
      const gap=document.createElement("p");gap.className="citation-gap";
      gap.textContent="…";gap.setAttribute("aria-label","Unquoted agreement text between these passages");
      root.append(gap);
    }
    const part=document.createElement("div");part.className="citation-excerpt";
    part.dataset.citationStart=String(passage.start);part.dataset.citationEnd=String(passage.end);
    const quote=setCitationQuote(document,document.createElement("blockquote"),passage.quote);
    const location=document.createElement("small");location.className="citation-location";
    location.textContent=citationLocation(citation,passage,index,passages.length);
    part.append(location,quote);root.append(part);quotes.push(quote);
  });
  return {root,quotes};
}

export function citationExcerptsHtml(citation, passages, {linkToSource=false}={}) {
  return '<div class="citation-excerpts">' + passages.map((passage,index)=>
    (index&&passage.start>passages[index-1].end?'<p class="citation-gap" aria-label="Unquoted agreement text between these passages">…</p>':'')+
    '<div class="citation-excerpt" data-citation-start="'+passage.start+'" data-citation-end="'+passage.end+'">'+
    '<small class="citation-location">'+(linkToSource?'<a href="#source-passage-'+passage.start+'-'+passage.end+'" title="Locate this passage in the agreement">':'')+
    escape(citationLocation(citation,passage,index,passages.length))+(linkToSource?'</a>':'')+'</small>'+
    '<blockquote>'+sourceTextHtml(passage.quote)+'</blockquote></div>'
  ).join("")+'</div>';
}

/** Reading groups use existing source headings; they never change citation membership. */
export function capturedSourceSections(source, passages, sections) {
  const headings = sections.filter(section => !section.parent).sort((a,b) => a.start-b.start);
  const groups = new Map();
  for (const [index, passage] of passages.entries()) {
    if (source.slice(passage.start, passage.end) !== passage.quote) throw new RangeError("Captured wording no longer matches this agreement.");
    const boundaries = [passage.start, ...headings.filter(h => h.start > passage.start && h.start < passage.end).map(h => h.start), passage.end];
    for (let at=0;at<boundaries.length-1;at++) {
      const start=boundaries[at],end=boundaries[at+1];
      const heading=headings.findLast(h=>h.start<=start);
      const key=heading ? "section-"+heading.start : "opening";
      if (!groups.has(key)) groups.set(key,{key,label:heading?.label??"",title:heading?.title?.replace(/\s+/g," ").trim()||"Captured wording",definitions:/\b(?:definitions|defined terms)\b/i.test(heading?.title??""),ranges:[],indices:[]});
      const group=groups.get(key),last=group.ranges.at(-1);
      if(last?.end===start){last.end=end;last.quote=source.slice(last.start,end);}
      else group.ranges.push({start,end,quote:source.slice(start,end)});
      if(!group.indices.includes(index))group.indices.push(index);
    }
  }
  return [...groups.values()];
}

/** Remove only the displayed, already captured intervals, retaining every other character. */
export function subtractCapturedPassages(passages, removed) {
  return passages.flatMap(passage=>{
    let pieces=[{...passage}];
    for(const cut of removed) pieces=pieces.flatMap(piece=>{
      if(cut.end<=piece.start||cut.start>=piece.end)return [piece];
      const kept=[];
      if(cut.start>piece.start)kept.push({start:piece.start,end:cut.start,quote:piece.quote.slice(0,cut.start-piece.start)});
      if(cut.end<piece.end)kept.push({start:cut.end,end:piece.end,quote:piece.quote.slice(cut.end-piece.start)});
      return kept;
    });
    return pieces;
  });
}
