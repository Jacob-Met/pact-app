// Feed style-inherited properties into OfficeParser's existing DOCX numbering engine.
// Private XML stays outside the returned AST and is scoped to one parse.
const WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const definitions = new WeakMap();
const child = (node, name) => Array.from(node?.childNodes || []).find(
  item => item.nodeType === 1 && item.namespaceURI === WORD && item.localName === name);
const value = node => node?.getAttributeNS(WORD, "val") || undefined;
const properties = node => {
  const result = {};
  for (const name of ["numId", "ilvl"]) {
    const element = child(node, name);
    if (element) result[name] = element;
  }
  return result;
};
export function rememberWordNumberingStyle(styles, id, node) {
  if (node.getAttributeNS(WORD, "type") !== "paragraph") return;
  let state = definitions.get(styles);
  if (!state) definitions.set(styles, state = { entries: new Map(), resolved: new Map() });
  state.entries.set(id, {
    basedOn: value(child(node, "basedOn")),
    properties: properties(child(child(node, "pPr"), "numPr"))
  });
  state.resolved.clear();
}
function inherited(state, id) {
  if (!state || !id) return {};
  const chain = [], seen = new Set();
  while (id && state.entries.has(id) && !state.resolved.has(id)) {
    if (seen.has(id)) throw Error("This Word file has cyclic paragraph styles. Export a resolved copy as PDF.");
    seen.add(id);
    const entry = state.entries.get(id);
    chain.push([id, entry]); id = entry.basedOn;
  }
  let result = state.resolved.get(id) || {};
  for (let index = chain.length - 1; index >= 0; index--) {
    const [key, entry] = chain[index];
    result = { ...result, ...entry.properties };
    state.resolved.set(key, result);
  }
  return result;
}
export function wordParagraphNumbering(styles, paragraphProperties, defaultStyle) {
  const direct = child(paragraphProperties, "numPr");
  // A content-free section-break carrier is not a displayed list paragraph.
  // Do not give it an inherited label or advance the following section's count.
  if (!direct && child(paragraphProperties, "sectPr") &&
      Array.from(paragraphProperties.parentNode.childNodes).every(node =>
        node.nodeType !== 1 || node === paragraphProperties)) return undefined;
  const style = value(child(paragraphProperties, "pStyle")) || defaultStyle;
  const fromStyle = inherited(definitions.get(styles), style);
  if (!Object.keys(fromStyle).length) return direct;
  const merged = { ...fromStyle, ...properties(direct) };
  if (!merged.numId) return direct;
  const result = merged.numId.ownerDocument.createElementNS(WORD, "w:numPr");
  // Explicit numId=0 is retained for PACT's existing numbering suppression.
  for (const name of ["ilvl", "numId"])
    if (merged[name]) result.appendChild(merged[name].cloneNode(true));
  return result;
}
