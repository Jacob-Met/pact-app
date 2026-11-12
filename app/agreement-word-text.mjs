import { OfficeParser } from "./vendor/officeparser/officeparser.browser.slim.mjs";

// numId=0 explicitly turns numbering off in Word. The parser currently marks these
// paragraphs as lists; do not invent a new "1." before an existing clause number.
function prepareNode(node) {
  if (/<(?:[\w.-]+:)?(?:ins|del|moveFrom|moveTo)(?:\s|>)/.test(node.rawContent || "")) {
    throw Error("This Word file has unresolved tracked changes. Accept or reject them in Word, then import the saved agreement.");
  }
  if (node.type === "list" && node.metadata?.listId === "0") node.type = "paragraph";
  delete node.rawContent;
  for (const child of node.children || []) prepareNode(child);
  // The plain-text table renderer flattens ordinary newlines inside cells.
  // A Unicode paragraph separator retains the original cell's block boundary
  // without claiming that neighboring columns have matching paragraph pairs.
  if(node.type==="cell" && node.children?.length) {
    const children=[];let hadText=false;
    for(const child of node.children) {
      const hasText=Boolean(child.text?.trim());
      if(hasText && hadText)children.push({type:"text",text:"\u2029"});
      children.push(child);
      if(hasText)hadText=true;
    }
    node.children=children;
  }
}
// Bound normalization to actual simple tables, never pipe-shaped prose.
// The existing renderer still owns cell text, lists, notes and paragraph handling.
function markCompactTables(document) {
  const original=JSON.stringify(document.content);
  let prefix="PACT_TABLE_LAYOUT_";
  while(original.includes(prefix))prefix+="_";
  const markers=[];
  const safe=node=>!String(node.text??"").includes("|") &&
    !(node.children??[]).some(child=>child.type==="table"||!safe(child));
  const visit=nodes=>nodes.flatMap(node=>{
    if(node.type==="table") {
      if(!safe(node))return [node];
      const start=prefix+markers.length+"_START",end=prefix+markers.length+"_END";
      markers.push({start,end});
      return [{type:"text",text:start},node,{type:"text",text:end}];
    }
    if(node.children)node.children=visit(node.children);
    return [node];
  });
  document.content=visit(document.content);
  return text=>{
    for(const {start,end} of markers) {
      const a=text.indexOf(start),b=text.indexOf(end,a+start.length);
      if(a<0||b<0)throw Error("This Word table could not be read completely. Export it as a PDF.");
      const table=text.slice(a+start.length,b).replace(/^\| ([^\r\n]*) \|[ \t]*$/gm,(_,cells)=>
        "| "+cells.split("|").map(cell=>cell.replace(/^[ \t]+|[ \t]+$/g,"")).join(" | ")+" |");
      text=text.slice(0,a)+table+text.slice(b+end.length);
    }
    return text;
  };
}
export async function extractWordText(data) {
  let document;
  try {
    document = await OfficeParser.parseOffice(new Uint8Array(data), {
      fileType: "docx", allowRemoteAssets: false, ocr: false, extractAttachments: false,
      includeRawContent: true, includeBreakNodes: true,
      decompressionLimits: { maxUncompressedBytes: 32 * 1024 * 1024, maxZipEntries: 1500,
        maxXmlElements: 200000, maxRawContentLength: 8 * 1024 * 1024, maxTableCells: 20000 }
    });
  } catch {
    throw Error("This Word file could not be read. Choose an unlocked DOCX copy or export the agreement as a PDF.");
  }
  if (document.type !== "docx") throw Error("Choose a Word DOCX agreement.");
  if (document.warnings.some(issue => issue.type !== "info")) {
    throw Error("Some content in this Word file could not be read completely. Export it as a PDF or paste the complete agreement.");
  }
  for (const node of document.content) prepareNode(node);
  for (const nodes of Object.values(document.auxiliary || {})) {
    if (!Array.isArray(nodes)) continue;
    for (const node of nodes) {
      prepareNode(node);
      if (!node.metadata?.hidden && node.text?.trim()) document.content.push(node);
    }
  }
  const compactTables=markCompactTables(document);
  const result = await document.to("text", { textConfig: { preserveLayout: true, renderNotes: true } });
  if (result.messages.some(issue => issue.type !== "info")) {
    throw Error("Some content in this Word file could not be read completely. Export it as a PDF or paste the complete agreement.");
  }
  return compactTables(result.value);
}
