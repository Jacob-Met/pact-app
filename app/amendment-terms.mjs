import { citationPassages } from "./source-citations.mjs";
import {formatUsdMinor} from "./ui-utils.mjs";
import {renderCitationExcerpts} from "./citation-view.mjs";
export const AMENDMENT_TERM_FIELDS = [["title","Commitment"],["criterion","Completion criterion"],["amountMinor","Amount"],
  ["performerId","Performer"],["reviewerId","Reviewer"],["dueAt","Deadline (UTC)"],["dependsOn","Prerequisites"],["citation","Exact source passage"]];
let comparisonNumber=0;
const previewSegments=new Intl.Segmenter("en",{granularity:"grapheme"});
export function amendmentEditPreview(text){
  const compact=text.replace(/\s+/g," ").trim(),letters=[...previewSegments.segment(compact)].map(item=>item.segment);
  return letters.length>150?letters.slice(0,147).join("")+"…":compact;
}
export function renderAmendmentComparison({document,previous,candidate,parties,obligations,controls=null,shownFields=AMENDMENT_TERM_FIELDS,labels=["Current","Proposed"]}) {
  const el=(tag,cls="",text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const value=(o,field)=>{
    if(field==="amountMinor")return formatUsdMinor(o.amountMinor)+" USD";
    if(field==="performerId"||field==="reviewerId")return parties.find(p=>p.id===o[field])?.name??o[field];
    if(field==="dependsOn")return o.dependsOn.map(id=>obligations.find(o=>o.id===id)?.title??id).join("; ")||"None";
    if(field==="dueAt")return o.dueAt||"No deadline";
    return o[field];
  };
  const group=el("div","amendment-comparison-group"),table=el("table","amendment-comparison"),edits=[];
  const groupId="amendment-wording-"+(++comparisonNumber);
  table.append(el("caption","",labels[0]+" and "+labels[1]+" commitment terms"));
  const head=el("thead"),headingRow=el("tr");
  for(const text of ["Term",labels[0]+" · revision "+previous.revision,labels[1]+" · revision "+candidate.revision])headingRow.append(el("th","",text));
  head.append(headingRow);table.append(head);
  const body=el("tbody");
  for(const [field,label]of shownFields){
    const row=el("tr");row.dataset.term=field;
    if(JSON.stringify(previous[field])!==JSON.stringify(candidate[field]))row.classList.add("amendment-changed");
    const heading=el("th","",label);heading.scope="row";
    const before=el("td","amendment-before"),after=el("td","amendment-after");
    before.dataset.label=labels[0]+" · revision "+previous.revision;
    after.dataset.label=labels[1]+" · revision "+candidate.revision;
    const appendWording=(beforeText,afterText,beforeCell,afterCell,editLabel)=>{
      const initialEdits=edits.length;
      for(const part of amendmentTextChanges(beforeText,afterText)){
        if(part.changed&&/\S/.test(part.before+part.after)){
          const marks=[],index=edits.length+1;
          for(const [text,cell,tag,version]of [[part.before,beforeCell,"del","before"],[part.after,afterCell,"ins","after"]]){
            if(!text)continue;
            const leading=text.match(/^\s*/u)[0],words=text.trim(),trailing=text.slice(leading.length+words.length);
            if(!words){cell.append(document.createTextNode(text));continue;}
            const mark=el(tag,"amendment-word-"+version,words);
            mark.id=groupId+"-"+index+"-"+version;mark.dataset.wordingChange=String(index);mark.tabIndex=-1;
            cell.append(document.createTextNode(leading),mark,document.createTextNode(trailing));marks.push(mark);
          }
          edits.push({...part,label:editLabel,index,marks,target:marks.at(-1)});
        }else{
          beforeCell.append(document.createTextNode(part.before));afterCell.append(document.createTextNode(part.after));
        }
      }
      if(edits.length>initialEdits)row.classList.add("amendment-worded");
    };
    if(field==="citation"){
      const beforePassages=citationPassages(previous.citation),afterPassages=citationPassages(candidate.citation);
      const left=renderCitationExcerpts(document,previous.citation,beforePassages);
      if(controls){before.append(left.root);after.append(controls(field));}
      else{
        const right=renderCitationExcerpts(document,candidate.citation,afterPassages);
        const leftParts=[...left.root.querySelectorAll(".citation-excerpt")],rightParts=[...right.root.querySelectorAll(".citation-excerpt")];
        const comparison=el("td","amendment-citation-comparison");comparison.colSpan=2;
        for(const {beforeIndex,afterIndex} of amendmentCitationPairs(beforePassages,afterPassages)){
          const old=beforePassages[beforeIndex],next=afterPassages[afterIndex];
          if((old?.quote??"")!==(next?.quote??"")){
            const leftQuote=left.quotes[beforeIndex]??el("span"),rightQuote=right.quotes[afterIndex]??el("span");
            leftQuote.replaceChildren();rightQuote.replaceChildren();
            appendWording((old?.quote??"").replace(/\r\n?/g,"\n"),(next?.quote??"").replace(/\r\n?/g,"\n"),
              leftQuote,rightQuote,label+(Math.max(beforePassages.length,afterPassages.length)>1?" "+((afterIndex??beforeIndex)+1):""));
          }
          const pair=el("div","amendment-citation-pair");
          pair.dataset.beforeStart=old?String(old.start):"";pair.dataset.afterStart=next?String(next.start):"";
          for(const [part,version,index,revision] of [[leftParts[beforeIndex],"before",0,previous.revision],[rightParts[afterIndex],"after",1,candidate.revision]]){
            const cell=el("div","amendment-"+version+" amendment-citation-version");
            cell.dataset.label=labels[index]+" · revision "+revision;
            if(part)cell.append(part);
            else{cell.classList.add("amendment-citation-empty");cell.setAttribute("aria-label","No source passage in "+labels[index].toLowerCase()+" revision");}
            pair.append(cell);
          }
          comparison.append(pair);
        }
        row.append(heading,comparison);body.append(row);continue;
      }
    }else{
      const beforeText=value(previous,field).replace(/\r\n?/g,"\n"),afterText=value(candidate,field).replace(/\r\n?/g,"\n");
      if(controls){before.textContent=beforeText;after.append(controls(field));}
      else if(["title","criterion"].includes(field)&&beforeText!==afterText)appendWording(beforeText,afterText,before,after,label);
      else{before.textContent=beforeText;after.textContent=afterText;}
    }
    row.append(heading,before,after);body.append(row);
  }
  table.append(body);
  if(edits.length){
    group.classList.add("amendment-has-wording");
    const title=el("nav","amendment-wording-heading");title.setAttribute("aria-label","Move between wording edits");
    const count=el("span","amendment-wording-count",String(edits.length));
    count.setAttribute("aria-live","polite");
    title.append(el("strong","","Wording edits"),count);
    const steps=el("div","amendment-wording-steps");
    const previousEdit=el("button","amendment-wording-step amendment-wording-previous","Previous"),nextEdit=el("button","amendment-wording-step amendment-wording-next","Next");
    previousEdit.type=nextEdit.type="button";previousEdit.disabled=true;
    previousEdit.setAttribute("aria-label","Previous wording edit");nextEdit.setAttribute("aria-label","Next wording edit");
    steps.append(previousEdit,nextEdit);title.append(steps);
    const nav=el("nav","amendment-wording-nav");nav.setAttribute("aria-label","Choose a wording edit");
    const list=el("ol","amendment-wording-list");
    let active=-1;
    const choose=edit=>{
      active=edit.index-1;count.textContent=edit.index+" / "+edits.length;
      previousEdit.disabled=active===0;nextEdit.disabled=active===edits.length-1;
      for(const other of edits){
        other.button.toggleAttribute("data-active",other===edit);
        for(const mark of other.marks)mark.classList.toggle("amendment-word-focus",other===edit);
      }
      edit.target.focus({preventScroll:true});
      edit.target.scrollIntoView({block:"center",behavior:"instant"});
    };
    previousEdit.addEventListener("click",()=>choose(edits[Math.max(0,active-1)]));
    nextEdit.addEventListener("click",()=>choose(edits[Math.min(edits.length-1,active+1)]));
    for(const edit of edits){
      const item=el("li"),button=el("button","amendment-wording-jump");button.type="button";
      button.dataset.wordingJump=String(edit.index);button.setAttribute("aria-controls",edit.target.id);
      button.setAttribute("aria-label","Review "+edit.label+" edit "+edit.index+". "+(edit.before?"Removed "+amendmentEditPreview(edit.before)+". ":"")+(edit.after?"Added "+amendmentEditPreview(edit.after):""));
      button.append(el("span","amendment-wording-field",edit.label+" · "+edit.index));
      const words=el("span","amendment-wording-snippet");
      if(edit.before)words.append(el("del","amendment-word-before",amendmentEditPreview(edit.before)));
      if(edit.before&&edit.after){const arrow=el("span","amendment-wording-arrow"," → ");arrow.setAttribute("aria-hidden","true");words.append(arrow);}
      if(edit.after)words.append(el("ins","amendment-word-after",amendmentEditPreview(edit.after)));
      button.append(words);item.append(button);list.append(item);edit.button=button;
      button.addEventListener("click",()=>choose(edit));
    }
    nav.append(list);group.append(title,nav);
  }
  group.append(table);return group;
}

const wordSegments=new Intl.Segmenter("en",{granularity:"word"});
export function amendmentTextChanges(before,after,{maxCells=Infinity}={}){
  if(before===after)return before?[{before,after,changed:false}]:[];
  const left=[...wordSegments.segment(before)].map(item=>item.segment);
  const right=[...wordSegments.segment(after)].map(item=>item.segment);
  // Long original documents can be compared without unbounded quadratic work.
  // Keep every byte; if a broad changed region remains, show that whole region.
  if(left.length*right.length>maxCells){
    let first=0,last=0;
    while(first<left.length&&first<right.length&&left[first]===right[first])first++;
    while(last<left.length-first&&last<right.length-first&&left[left.length-1-last]===right[right.length-1-last])last++;
    const a=left.slice(first,left.length-last),b=right.slice(first,right.length-last),parts=[];
    const prefix=left.slice(0,first).join(""),suffix=last?left.slice(left.length-last).join(""):"";
    if(prefix)parts.push({before:prefix,after:prefix,changed:false});
    if(a.length*b.length>maxCells)parts.push({before:a.join(""),after:b.join(""),changed:true});
    else parts.push(...amendmentTextChanges(a.join(""),b.join(""),{maxCells}));
    if(suffix)parts.push({before:suffix,after:suffix,changed:false});
    return parts;
  }
  // Match word segments without allocating a full quadratic-size matrix.
  const scores=(a0,a1,b0,b1,reverse=false)=>{
    const width=b1-b0,row=new Uint16Array(width+1);
    for(let a=0;a<a1-a0;a++){
      const token=left[reverse?a1-a-1:a0+a];let diagonal=0;
      for(let b=1;b<=width;b++){
        const previous=row[b];
        row[b]=token===right[reverse?b1-b:b0+b-1]?diagonal+1:Math.max(row[b],row[b-1]);
        diagonal=previous;
      }
    }
    return row;
  };
  const matches=[];
  const collect=(a0,a1,b0,b1)=>{
    while(a0<a1&&b0<b1&&left[a0]===right[b0])matches.push([a0++,b0++]);
    if(a0<a1&&b0<b1){
      if(a1-a0===1){
        for(let b=b0;b<b1;b++)if(left[a0]===right[b]){matches.push([a0,b]);break;}
      }else{
        const mid=Math.floor((a0+a1)/2),forward=scores(a0,mid,b0,b1),backward=scores(mid,a1,b0,b1,true);
        let best=-1,split=0;
        for(let b=0;b<=b1-b0;b++){
          const score=forward[b]+backward[b1-b0-b];
          if(score>best){best=score;split=b;}
        }
        collect(a0,mid,b0,b0+split);collect(mid,a1,b0+split,b1);
      }
    }
  };
  collect(0,left.length,0,right.length);
  const parts=[];
  const append=(before,after,changed)=>{
    if(!before&&!after)return;
    const last=parts.at(-1);
    if(last?.changed===changed){last.before+=before;last.after+=after;}
    else parts.push({before,after,changed});
  };
  let a=0,b=0;
  for(const [nextA,nextB]of matches){
    append(left.slice(a,nextA).join(""),right.slice(b,nextB).join(""),true);
    append(left[nextA],right[nextB],false);a=nextA+1;b=nextB+1;
  }
  append(left.slice(a).join(""),right.slice(b).join(""),true);
  return parts;
}

// Anchor unchanged exact excerpts before comparing added, removed or revised spans.
// A newly included earlier definition must not make the retained payment clause
// appear to have been rewritten.
export function amendmentCitationPairs(before,after){
  const same=(a,b)=>a.start===b.start&&a.end===b.end&&a.quote===b.quote;
  const rows=Array.from({length:before.length+1},()=>new Uint8Array(after.length+1));
  for(let a=before.length-1;a>=0;a--)for(let b=after.length-1;b>=0;b--)
    rows[a][b]=same(before[a],after[b])?1+rows[a+1][b+1]:Math.max(rows[a+1][b],rows[a][b+1]);
  const anchors=[];let a=0,b=0;
  while(a<before.length&&b<after.length){
    if(same(before[a],after[b]))anchors.push([a++,b++]);
    else if(rows[a+1][b]>=rows[a][b+1])a++;else b++;
  }
  anchors.push([before.length,after.length]);
  const pairs=[];a=0;b=0;
  for(const [nextA,nextB] of anchors){
    const count=Math.max(nextA-a,nextB-b);
    for(let index=0;index<count;index++)pairs.push({beforeIndex:a+index<nextA?a+index:null,afterIndex:b+index<nextB?b+index:null});
    if(nextA<before.length)pairs.push({beforeIndex:nextA,afterIndex:nextB});
    a=nextA+1;b=nextB+1;
  }
  return pairs;
}
