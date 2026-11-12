import { sourceDisplayText, sourceSelection } from "./source-passages.mjs";

// Bind rendered text nodes to the exact original slice, including hidden table
// punctuation. Generated line numbers and action labels are never registered.
export function createSourceSelectionMap(document, root) {
  const nodes = new WeakMap(), ordered = [];
  function register(fragment, original, sourceStart) {
    const walker = document.createTreeWalker(fragment, 4);
    let node, offset = 0, rendered = "";
    while ((node = walker.nextNode())) {
      nodes.set(node, { original, sourceStart, offset }); ordered.push(node);
      offset += node.data.length; rendered += node.data;
    }
    if (rendered !== sourceDisplayText(original)) throw Error("Rendered source text does not match its original slice.");
  }
  function edge(node, last) {
    if (node.nodeType === 3 && nodes.has(node)) return point(node, last ? node.data.length : 0);
    const children = [...node.childNodes];
    if (last) children.reverse();
    for (const child of children) { const value = edge(child, last); if (value !== null) return value; }
    return null;
  }
  function point(node, offset) {
    if (!root.contains(node) || !Number.isInteger(offset) || offset < 0) return null;
    if (node.nodeType === 3) {
      const mapped = nodes.get(node);
      if (!mapped || offset > node.data.length) return null;
      const view = mapped.offset + offset;
      if (view === 0) return mapped.sourceStart;
      const range = sourceSelection(mapped.original, 0, view);
      return range ? mapped.sourceStart + range.end : null;
    }
    if (offset > node.childNodes.length) return null;
    for (let i = offset; i < node.childNodes.length; i++) { const value = edge(node.childNodes[i], false); if (value !== null) return value; }
    for (let i = offset - 1; i >= 0; i--) { const value = edge(node.childNodes[i], true); if (value !== null) return value; }
    return null;
  }
  return {
    register,
    range(start, end) {
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) return null;
      let first = null, last = null;
      for (const node of ordered) {
        const mapped = nodes.get(node);
        const relativeStart = Math.max(0, start - mapped.sourceStart);
        const relativeEnd = Math.min(mapped.original.length, end - mapped.sourceStart);
        if (relativeStart >= relativeEnd) continue;
        const a = sourceDisplayText(mapped.original.slice(0, relativeStart)).length - mapped.offset;
        const b = sourceDisplayText(mapped.original.slice(0, relativeEnd)).length - mapped.offset;
        if (b <= 0 || a >= node.data.length) continue;
        first ??= {node, offset:Math.max(0,a)};
        last = {node, offset:Math.min(node.data.length,b)};
      }
      if (!first || !last) return null;
      const range = document.createRange();
      range.setStart(first.node, first.offset); range.setEnd(last.node, last.offset);
      return range;
    },
    read(selection, source) {
      if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
      const range = selection.getRangeAt(0);
      const start = point(range.startContainer, range.startOffset);
      const end = point(range.endContainer, range.endOffset);
      if (start === null || end === null || end <= start || end > source.length) return null;
      const quote = source.slice(start, end);
      return quote.trim() ? { start, end, quote } : null;
    }
  };
}
