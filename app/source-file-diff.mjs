import { amendmentTextChanges } from "./amendment-terms.mjs";

// Line anchors constrain work on long documents without discarding any source
// character. Normalized keys locate candidates only: every anchor is compared
// using its exact text, so spacing and paragraph changes remain visible.
export function sourceFileTextChanges(before, after, { maxCells = 2000000 } = {}) {
  if (typeof before !== "string" || typeof after !== "string" || before.length > 100000 || after.length > 100000) throw Error("Source wording is too large to compare.");
  const lines = value => value.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const left = lines(before), right = lines(after);
  const key = value => value.replace(/\s+/gu, " ").trim();
  const unique = rows => {
    const index = new Map();
    rows.forEach((row, i) => { const k = key(row); if (k) index.set(k, index.has(k) ? -1 : i); });
    return index;
  };
  const a = unique(left), b = unique(right);
  const candidates = [];
  for (const [k, i] of a) if (i >= 0 && b.get(k) >= 0) candidates.push([i, b.get(k)]);
  candidates.sort((x, y) => x[0] - y[0]);
  // Longest increasing subsequence avoids crossed/reordered source anchors.
  const tails = [], previous = [];
  candidates.forEach((pair, i) => {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (candidates[tails[mid]][1] < pair[1]) lo = mid + 1; else hi = mid; }
    previous[i] = lo ? tails[lo - 1] : -1; tails[lo] = i;
  });
  const anchors = [];
  for (let i = tails.at(-1); i !== undefined && i >= 0; i = previous[i]) anchors.push(candidates[i]);
  anchors.reverse();
  const segments = new Intl.Segmenter("en", {granularity:"word"});
  const count = text => {let n=0; for (const _ of segments.segment(text)) n++; return n;};
  const parts = [];
  let remaining = maxCells;
  const append = part => {
    if (!part.before && !part.after) return;
    const last = parts.at(-1);
    if (last && !last.changed && !part.changed) { last.before += part.before; last.after += part.after; }
    else parts.push(part);
  };
  const compare = (x, y) => {
    if (x === y) { append({before:x, after:y, changed:false}); return; }
    // Budget is shared across all word-segment comparisons.
    const cost = count(x) * count(y);
    if (cost > remaining) { append({before:x, after:y, changed:true}); return; }
    remaining -= cost;
    for (const part of amendmentTextChanges(x, y, {maxCells:cost})) append(part);
  };
  let i = 0, j = 0;
  for (const [nextI, nextJ] of anchors) {
    compare(left.slice(i, nextI).join(""), right.slice(j, nextJ).join(""));
    compare(left[nextI], right[nextJ]); i = nextI + 1; j = nextJ + 1;
  }
  compare(left.slice(i).join(""), right.slice(j).join(""));
  return parts;
}

/** Exact changed spans with the same bounded surrounding wording shown to a reader. */
export function sourceFileDifferenceContexts(parts) {
  const context = (value, tail) => {
    const letters = Array.from(value);
    let excerpt = (tail ? letters.slice(-100) : letters.slice(0, 100)).join("");
    if (letters.length > 100) {
      if (tail && /\s/u.test(excerpt)) excerpt = excerpt.replace(/^\S*\s/u, "");
      if (!tail && /\s/u.test(excerpt)) excerpt = excerpt.replace(/\s\S*$/u, "");
    }
    return (tail && letters.length > 100 ? "…" : "") + excerpt + (!tail && letters.length > 100 ? "…" : "");
  };
  return parts.flatMap((part, index) => part.changed ? [{
    partIndex:index, before:part.before, after:part.after,
    lead:context(parts[index-1]?.changed ? "" : parts[index-1]?.before ?? "", true),
    follow:context(parts[index+1]?.changed ? "" : parts[index+1]?.before ?? "", false)
  }] : []);
}

// Search affects navigation only. Returned entries retain their original spans;
// whitespace folding lets an author find a term across a changed paragraph break.
export function findSourceFileDifferences(entries, query) {
  const key = value => value.replace(/\s+/gu, " ").trim().toLocaleLowerCase("en");
  const needle = key(query);
  return entries.filter(entry => !needle ||
    key(entry.lead + entry.before + entry.follow).includes(needle) ||
    key(entry.lead + entry.after + entry.follow).includes(needle));
}

/** Describe otherwise invisible changed whitespace without replacing source text. */
export function sourceWhitespaceDescription(value) {
  if (!value || !/^\s+$/u.test(value)) return "";
  const names=new Map(),add=name=>names.set(name,(names.get(name)??0)+1);
  for(const token of value.match(/\r\n|[\s]/gu)) {
    add(token==="\u2029"?"paragraph break":token==="\u2028"?"line separator":
      token==="\r\n"||token==="\n"||token==="\r"?"line break":
      token==="\t"?"tab":token===" "?"space":token==="\u00a0"?"nonbreaking space":"whitespace character");
  }
  return [...names].map(([name,count])=>count===1?name:count+" "+name+"s").join(" + ");
}
