import { renderEvidenceFile } from "./evidence-file.mjs";
import { extractAgreement } from "./agreement-file.mjs";
import { sourceFileDifferenceContexts, findSourceFileDifferences, sourceWhitespaceDescription } from "./source-file-diff.mjs";

export function renderSourceFile(source) {
  const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
  let selected=null,controller=null,generation=0,worker=null,workerReject=null;
  const tools=el("div",undefined,"source-wording-tools");
  const compare=el("button","Compare agreement text");compare.type="button";compare.disabled=true;
  const cancel=el("button","Cancel comparison");cancel.type="button";cancel.hidden=true;
  const status=el("p","Match the original file to compare its wording.","muted");status.setAttribute("role","status");
  const result=el("section",undefined,"source-wording-result");
  const stop=()=>{
    generation++;controller?.abort();controller=null;
    worker?.terminate();worker=null;workerReject?.(new DOMException("Comparison cancelled.","AbortError"));workerReject=null;
    cancel.hidden=true;compare.disabled=!selected;compare.textContent="Compare agreement text";
  };
  const reset=file=>{stop();selected=file;result.replaceChildren();compare.disabled=!file;status.textContent=file?"":"Match the original file to compare its wording.";};
  const box=renderEvidenceFile({fileFingerprint:source.file.fingerprint},{compact:true,preview:true,source:true,onMatch:reset});
  tools.append(compare,cancel);box.append(tools,status,result);
  cancel.addEventListener("click",()=>{stop();status.textContent="Comparison cancelled.";compare.focus();});
  const observer=new MutationObserver(()=>{if(!box.isConnected){stop();selected=null;observer.disconnect();}});
  observer.observe(document.body,{childList:true,subtree:true});
  function paint(parts){
    result.replaceChildren();
    const edits=parts.filter(part=>part.changed&&part.before!==part.after);
    if(!edits.length){status.textContent="The extracted wording matches the retained agreement text.";return;}
    const spacingOnly=edits.every(part=>/^\s*$/u.test(part.before)&&/^\s*$/u.test(part.after));
    status.textContent=spacingOnly?"Only spacing differs between the extracted and retained text.":"Original extraction and retained text differ.";
    const nav=el("nav",undefined,"source-wording-nav");nav.setAttribute("aria-label","Review source wording differences");
    const previous=el("button","Previous"),next=el("button","Next"),count=el("output",edits.length+" changed "+(edits.length===1?"region":"regions"));
    previous.type=next.type="button";previous.disabled=true;
    const changes=el("ol",undefined,"source-wording-changes");
    const columns=el("div",undefined,"source-wording-columns"),left=el("div"),right=el("div");
    const before=el("div",undefined,"source-wording-text"),after=el("div",undefined,"source-wording-text");
    left.append(el("h3","Original file · extracted text"),before);right.append(el("h3","Retained agreement text"),after);columns.append(left,right);
    const marks=[];let position=-1;
    const entries=sourceFileDifferenceContexts(parts);
    const contexts=new Map(entries.map(entry=>[entry.partIndex,entry]));
    for(const [index,part]of parts.entries()){
      if(part.changed){
        const item=el("li",undefined,"source-wording-change");item.tabIndex=-1;
        item.setAttribute("aria-label","Wording difference "+(marks.length+1));
        const {lead,follow}=contexts.get(index);
        for(const [text,parent,tag,label]of [[part.before,before,"del","Original file"],[part.after,after,"ins","Retained text"]]){
          if(text)parent.append(el(tag,text));
          const cell=el("div"),passage=el("p",undefined,"source-wording-excerpt");
          cell.append(el("h3",label));
          const whitespace=sourceWhitespaceDescription(text);
          if(whitespace)cell.append(el("p",whitespace,"source-wording-whitespace"));
          passage.append(document.createTextNode(lead));
          if(text)passage.append(el(tag,text));else passage.append(el("em",tag==="del"?"[No wording here]":"[Removed]"));
          passage.append(document.createTextNode(follow));cell.append(passage);item.append(cell);
        }
        changes.append(item);marks.push(item);
      }else{before.append(document.createTextNode(part.before));after.append(document.createTextNode(part.after));}
    }
    let visible=marks;
    const choose=index=>{
      if(!visible.length)return;
      position=Math.max(0,Math.min(visible.length-1,index));
      for(const mark of marks)mark.classList.toggle("source-wording-active",mark===visible[position]);
      count.textContent=(position+1)+" / "+visible.length+(visible.length===marks.length?"":" matching differences");
      previous.disabled=position===0;next.disabled=position===visible.length-1;
      visible[position].focus({preventScroll:true});visible[position].scrollIntoView({block:"center",behavior:"instant"});
    };
    const search=el("div",undefined,"source-wording-search");
    search.setAttribute("role","search");
    const label=el("label","Find in differences"),input=el("input"),find=el("button","Find"),clear=el("button","Show all");
    input.type="search";input.maxLength=200;input.placeholder="For example, Sub-processor";
    label.append(input);find.type="button";clear.type="button";clear.hidden=true;
    const searchStatus=el("p","","muted");searchStatus.setAttribute("role","status");
    const show=query=>{
      const found=findSourceFileDifferences(entries,query);
      const selected=new Set(found.map(entry=>entry.partIndex));
      visible=marks.filter((mark,index)=>selected.has(entries[index].partIndex));
      for(const mark of marks){mark.hidden=!visible.includes(mark);mark.classList.remove("source-wording-active");}
      position=-1;previous.disabled=true;next.disabled=!visible.length;
      count.textContent=visible.length+" / "+marks.length+" changed regions";
      searchStatus.textContent=query.trim()?(visible.length?visible.length+" matching differences.":"No matching differences."):"";
      clear.hidden=!query.trim();
    };
    const findMatches=()=>{show(input.value);if(visible.length)choose(0);};
    find.addEventListener("click",findMatches);
    input.addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();event.stopPropagation();findMatches();}});
    input.addEventListener("search",()=>{if(!input.value)show("");});
    clear.addEventListener("click",()=>{input.value="";show("");input.focus();});
    search.append(label,find,clear);
    previous.addEventListener("click",()=>choose(position-1));next.addEventListener("click",()=>choose(position+1));
    nav.append(el("strong",spacingOnly?"Spacing differences":"Wording differences"),count,previous,next);
    const details=el("details"),summary=el("summary","Read both complete texts");details.append(summary,columns);
    result.append(search,searchStatus,nav,changes,details);
  }
  compare.addEventListener("click",async()=>{
    if(!selected)return;
    stop();const token=generation,active=new AbortController();controller=active;
    compare.disabled=true;cancel.hidden=false;result.replaceChildren();status.textContent="Reading the matched original file…";
    try{
      // A renamed matching copy still uses the recorded document format.
      const original=new File([selected],source.file.fingerprint.name,{type:selected.type});
      const extracted=await extractAgreement(original,{signal:active.signal,progress:(page,total)=>{if(token===generation)status.textContent="Reading original page "+page+" of "+total+"…";}});
      if(token!==generation||!box.isConnected)return;
      status.textContent="Comparing original wording…";
      const parts=await new Promise((resolve,reject)=>{
        const job=new Worker(new URL("./source-file-diff.worker.mjs",import.meta.url),{type:"module"});worker=job;workerReject=reject;
        const finish=()=>{job.terminate();if(worker===job){worker=null;workerReject=null;}};
        job.onmessage=({data})=>{finish();data.error?reject(Error(data.error)):resolve(data.parts);};
        job.onerror=()=>{finish();reject(Error("The wording comparison could not finish."));};
        job.postMessage({before:extracted.text,after:source.text});
      });
      if(token!==generation||!box.isConnected)return;
      paint(parts);
    }catch(error){if(token===generation&&box.isConnected)status.textContent=error.name==="AbortError"?"Comparison cancelled.":error.message;}
    finally{if(token===generation){controller=null;cancel.hidden=true;compare.disabled=!selected;}}
  });
  return box;
}
