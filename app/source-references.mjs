import { sourceLineMarker, sourceSentencePassages } from "./source-passages.mjs";

const roman = /^(?=[IVXLCDM]+$)M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/;
const romanValue = value => {
  const values={I:1,V:5,X:10,L:50,C:100,D:500,M:1000};
  return [...value].reduce((sum,char,index)=>sum+(values[char]<values[value[index+1]]?-values[char]:values[char]),0);
};
const canonical = value => value.replace(/[()\s]/g, "").replace(/\.+$/, "").toUpperCase();
const pathParts = value => value.replace(/\(([A-Za-z0-9]+)\)/g, ".$1").split(".").filter(Boolean).map(canonical);
const exactRange = (source, start, end) => ({
  start, end: end - (source.slice(start, end).length - source.slice(start, end).trimEnd().length),
});
const sourceLines = source => {
  const lines = [...source.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)]
    .filter(match => match[0].length)
    .map(match => ({ start: match.index, text: match[0].replace(/[\r\n]+$/, "") }));
  const title = value => value.trim().replace(/[ \t]+/g, " ").toLocaleLowerCase("en");
  const attachment = /^(?:Appendix|Exhibit|Schedule)[ \t]+(?:[A-Z]|\d+(?:\.\d+)*|[IVXLCDM]+)[ \t]+[-–—][ \t]+\S.*$/i;
  const declared = new Set(lines.filter(line => attachment.test(line.text.trim())).map(line => title(line.text)));
  return lines.flatMap(line => {
    // Older Word extraction can join a body heading to the preceding full
    // stop. Recover only a complete attachment title independently present
    // elsewhere on its own line; ordinary references and unknown titles stay
    // prose. Virtual line offsets retain every original source character.
    const boundaries = [...line.text.matchAll(/[.!?](?=(?:Appendix|Exhibit|Schedule)[ \t]+)/gi)];
    const boundary = boundaries.findLast(match => declared.has(title(line.text.slice(match.index + 1))));
    if (!boundary) return [line];
    const at = boundary.index + 1;
    return [{start:line.start, text:line.text.slice(0, at)},
      {start:line.start + at, text:line.text.slice(at)}];
  });
};
const keyFor = (kind, path) => kind + ":" + path.join(".");
const headline = value => value && !/^(?:of|above|below|hereof|shall|applies|must|and|or)\b/i.test(value)
  && /^(?:[\p{Lu}[(]|[“"]\p{Lu})/u.test(value);

// Index source boundaries only. A target's whole section is not a claim that
// every sentence in it governs an obligation.
export function sourceSectionIndex(source) {
  if (typeof source !== "string") throw new TypeError("Source must be text.");
  const lines = sourceLines(source);
  const possibleRoman = lines.flatMap(line => {
    const marker = sourceLineMarker(line.text);
    const match = line.text.match(/^[ \t]*([IVXLCDM]+)[.)][ \t]+(.*)$/);
    return marker && match && roman.test(match[1]) && headline(match[2])
      && (match[1] === "I" || match[1].length > 1 || match[2] === match[2].toUpperCase())
      ? [{ indent: marker.indent, token: match[1] }] : [];
  });
  const romanIndent = possibleRoman.length ? Math.min(...possibleRoman.map(item => item.indent)) : Infinity;
  const possibleNumber = lines.flatMap(line => {
    const marker = sourceLineMarker(line.text);
    const match = line.text.match(/^[ \t]*(\d+)[.)][ \t]+(.*)$/);
    return marker && match && headline(match[2]) ? [marker.indent] : [];
  });
  const numberIndent = possibleNumber.length ? Math.min(...possibleNumber) : Infinity;
  const entries = [], stack = [], romanRoots = new Set();
  const nextParenthetical = new Map();
  let followingMarker = null;
  for (const line of [...lines].reverse()) {
    nextParenthetical.set(line.start, followingMarker);
    const match = line.text.match(/^[ \t]*\(([a-z0-9]+)\)[ \t]+/i);
    if (match) followingMarker = match[1];
  }
  let currentRoot = null;
  const finish = (entry, end) => {
    entry.end = exactRange(source, entry.start, end).end;
  };
  for (const line of lines) {
    // A standalone Part heading closes the preceding provisions. It is not
    // part of the last duty merely because it has no numbered child marker.
    if (/^[ \t]*Part[ \t]+(?:[A-Z]|[IVXLCDM]+|\d+)[ \t]*[-–—][ \t]+\S.*$/i.test(line.text)) {
      while (stack.length) finish(stack.pop(), line.start);
      currentRoot = null;
      continue;
    }
    const indent = line.text.match(/^[ \t]*/)[0].replace(/\t/g, "    ").length;
    const marker = sourceLineMarker(line.text);
    const named = line.text.match(/^[ \t]*(Section|Article|Exhibit|Appendix|Schedule)[ \t]+([IVXLCDM]+|\d+(?:\.\d+)*|[A-Z])(?:[.:)](?=[ \t]|$))?[ \t]*(.*)$/i);
    const alphanumeric = line.text.match(/^[ \t]*([A-Z]\d+(?:\.\d+)*)(?:[.)](?=[ \t]))?[ \t]+(.+)$/);
    const dotted = line.text.match(/^[ \t]*(\d+(?:\.\d+)+)(?:[.)](?=[ \t]))?[ \t]+(.*)$/);
    const topRoman = line.text.match(/^[ \t]*([IVXLCDM]+)[.)](?:[ \t]+(.*))?$/);
    const topNumber = line.text.match(/^[ \t]*(\d+)[.)][ \t]+(.*)$/);
    let kind, path, isRoot = false, isRomanRoot = false, title, rootPath, paragraphLevel;
    const parenthetical = line.text.match(/^[ \t]*\(([a-z0-9]+)\)[ \t]+/i);
    const attachment = named && /^(?:Exhibit|Appendix|Schedule)$/i.test(named[1]);
    const attachmentHeading = !attachment || !named[3] || named[1] === named[1].toUpperCase()
      || /^[-–—][ \t]+\p{Lu}/u.test(named[3]);
    const numericRoot = currentRoot && /^\d+$/.test(currentRoot.path[0]);
    if (alphanumeric) {
      kind = "section"; path = pathParts(alphanumeric[1]); isRoot = true; title = alphanumeric[2];
    } else if (named && attachmentHeading && (!named[3] || headline(named[3].replace(/^[-–—][ \t]+/, "")))) {
      kind = named[1].toLowerCase(); path = pathParts(named[2]); isRoot = true; title = named[3];
    } else if (topRoman && indent === romanIndent && roman.test(topRoman[1]) && (!topRoman[2] || headline(topRoman[2]))
        && (topRoman[1].length>1 || !currentRoot || !topRoman[2] || topRoman[2]===topRoman[2].toUpperCase()
          || romanRoots.has(currentRoot) && romanValue(topRoman[1])===romanValue(currentRoot.path[0])+1)) {
      kind = "section"; path = [topRoman[1]]; isRoot = true; isRomanRoot = true; title = topRoman[2];
    } else if (dotted && headline(dotted[2]) && numericRoot && dotted[1].split(".")[0] === currentRoot.path[0]) {
      kind = currentRoot?.kind === "article" ? "article" : "section";
      path = pathParts(dotted[1]); isRoot = true; title = dotted[2];
    } else if (topNumber && romanIndent === Infinity && indent === numberIndent
      && !["exhibit","appendix","schedule"].includes(currentRoot?.kind) && headline(topNumber[2])) {
      kind = "section"; path = [topNumber[1]]; isRoot = true; title = topNumber[2];
    } else if (parenthetical && currentRoot?.kind === "paragraph"
        && indent === currentRoot.indent) {
      // The retained FAR HTML has no visual indentation. Its parenthetical
      // sequence still distinguishes (e)(4)(i)(B), per FAR 1.105-2(b)(2).
      const token = parenthetical[1];
      const numberParent = stack.findLast(item => item.paragraphLevel === 1);
      if (/^\d+$/.test(token)) paragraphLevel = 1;
      else if (/^[A-Z]$/.test(token)) paragraphLevel = 3;
      else if (/^[a-z]$/.test(token) && !roman.test(token.toUpperCase())) paragraphLevel = 0;
      else if (/^[ivxlcdm]+$/.test(token) && numberParent) {
        const next = nextParenthetical.get(line.start);
        const nextRoot = token.length === 1 && token.charCodeAt(0) === currentRoot.markerToken.charCodeAt(0) + 1;
        paragraphLevel = nextRoot && (next === "1" || next && /^[a-z]$/.test(next) && !roman.test(next.toUpperCase()))
          ? 0 : 2;
      } else if (/^[a-z]$/.test(token)) paragraphLevel = 0;
      else continue;
      const parent = paragraphLevel > 0
        ? stack.findLast(item => item.paragraphLevel === paragraphLevel - 1) : null;
      if (paragraphLevel > 0 && !parent) continue;
      kind = "paragraph"; path = [...(parent?.path ?? []), canonical(token)];
      isRoot = true; title = line.text.trim();
    } else if (marker && marker.family !== "bullet") {
      if (marker.token.includes(".") && !numericRoot) continue;
      if (!currentRoot) {
        if (!/^[ \t]*\([a-z]\)[ \t]+/i.test(line.text)) continue;
        kind = "paragraph"; path = [canonical(marker.token)]; isRoot = true; paragraphLevel = 0;
      } else {
        kind = currentRoot.kind;
        // PDF text extraction can put Roman chapters, lettered clauses and
        // numbered grounds at the same indentation. Their marker families
        // still identify the source hierarchy without inventing source text.
        if (romanRoots.has(currentRoot) && indent===currentRoot.indent && /^[A-Z]$/.test(marker.token)) {
          while(stack.length>1)finish(stack.pop(),line.start);
          path=[...currentRoot.path,marker.token];rootPath=currentRoot.rootPath;
        } else if (romanRoots.has(currentRoot) && indent===currentRoot.indent && /^\d+$/.test(marker.token)) {
          const letter=stack.findLast(item=>item.parent===currentRoot.key && /^[A-Z]$/.test(item.markerToken??""));
          const parent=letter??currentRoot;
          while(stack.at(-1)!==parent)finish(stack.pop(),line.start);
          path=[...parent.path,marker.token];rootPath=currentRoot.rootPath;
        } else {
        // An unindented extracted list item is not a new indexed heading.
        // Reject it before closing explicit ancestors; later F2.4.4 must
        // still belong to F2.4 even after unindented A./B./C./D. text.
        if (indent <= currentRoot.indent) continue;
        // PDF page changes can shift indentation between successive lettered
        // siblings. A continuing alphabetic sequence keeps the same parent.
        const priorLetter = /^[A-Z]$/.test(marker.token)
          ? stack.findLastIndex(item => /^[A-Z]$/.test(item.markerToken ?? "")
            && marker.token.charCodeAt(0) === item.markerToken.charCodeAt(0) + 1)
          : -1;
        if (priorLetter > 0)
          while (stack.length > priorLetter) finish(stack.pop(), line.start);
        while (stack.length > 1 && indent <= stack.at(-1).indent) finish(stack.pop(), line.start);
        const parent = stack.at(-1);
        path = [...parent.path, canonical(marker.token)];
        rootPath = currentRoot.rootPath;
        }
      }
      title = line.text.trim();
    } else continue;
    if (isRoot) {
      const prefix = path.slice(0, -1);
      const parent = prefix.length ? [...stack].reverse().find(item =>
        item.kind === kind && item.path.join(".") === prefix.join(".")) : null;
      while (stack.length && stack.at(-1) !== parent) finish(stack.pop(), line.start);
      rootPath = parent?.rootPath ?? [path[0]];
      currentRoot = parent ? stack[0] : null;
    }
    const parent = stack.at(-1);
    const start = line.start + line.text.search(/\S/);
    const entry = {
      key: keyFor(kind, path), kind, label: path.join("."), path,
      start, end: source.length, leadEnd: source.length,
      indent, markerToken: marker?.token ?? null, parent: parent?.key ?? null, rootPath: rootPath ?? path,
      title: title || "",
      ...(paragraphLevel === undefined ? {} : {paragraphLevel}),
    };
    if (parent && parent.leadEnd === source.length)
      parent.leadEnd = exactRange(source, parent.start, line.start).end;
    entries.push(entry); stack.push(entry);
    if(isRomanRoot)romanRoots.add(entry);
    if (!currentRoot) currentRoot = entry;
  }
  while (stack.length) finish(stack.pop(), source.length);
  // A labelled contents list can include Part headings between its entries.
  // Bound that list at the first repeated, substantive letter-number heading;
  // only remove listed labels which also exist beyond that boundary.
  const contents = lines.find(line => /^(?:table of )?contents$/i.test(line.text.trim()));
  const parents = new Set(entries.filter(entry => entries.some(child => child.parent === entry.key
    && child.start > entry.start && child.end <= entry.end)));
  const hasChildren = entry => parents.has(entry);
  const firstBody = contents && entries.find(entry => entry.start > contents.start
    && /^[A-Z]\d+$/.test(entry.label) && hasChildren(entry)
    && entries.some(prior => prior.key === entry.key && prior.start > contents.start
      && prior.start < entry.start && !hasChildren(prior)));
  const contentsLabels = firstBody ? new Set(entries.filter(entry =>
    entry.start > contents.start && entry.start < firstBody.start && !hasChildren(entry)
    && entries.some(body => body.key === entry.key && body.start >= firstBody.start))
    .map(entry => entry.key)) : new Set();
  const indexed = entries.filter(entry => {
    if (contentsLabels.size >= 3 && entry.start > contents.start
      && entry.start < firstBody.start && contentsLabels.has(entry.key) && !hasChildren(entry)) return false;
    if (!/^[A-Z]\d+$/.test(entry.label)) return true;
    const headingOnly = !/[\r\n]/.test(source.slice(entry.start,entry.end));
    return !headingOnly || !entries.some(other => other.key === entry.key && other !== entry
      && entries.some(child => child.parent === other.key && child.start > other.start && child.end <= other.end));
  });
  const withInline=indexed.flatMap(entry=>[entry,...inlineSectionChildren(source,entry)]);
  return withInline.map(entry => ({
    ...entry, leadEnd: Math.min(entry.leadEnd, entry.end),
    quote: source.slice(entry.start, entry.end),
  }));
}

// Recognize declared inline list locations without changing parent ranges.
// Parent text and existing completion boundaries remain unchanged.
function inlineSectionChildren(source, entry) {
  const text = source.slice(entry.start, entry.end);
  if (/[\r\n]/.test(text) || !/^(?:section|article)$/.test(entry.kind)) return [];
  const markers = [...text.matchAll(/[:;][ \t]+(?:(?:and|or)[ \t]+)?\(([a-z])\)[ \t]+/g)];
  if (markers.length < 2 || markers.some((m,i) => m[1] !== String.fromCharCode(97+i))) return [];
  if (markers[0][0][0] !== ":" || markers.slice(1).some(marker=>marker[0][0]!==";")) return [];
  const starts = markers.map(m => entry.start + m.index + m[0].indexOf("("));
  return markers.map((marker,i) => {
    const path = [...entry.path, marker[1].toUpperCase()];
    const {start,end}=exactRange(source,starts[i],i+1<markers.length?entry.start+markers[i+1].index+1:entry.end);
    return {...entry,key:keyFor(entry.kind,path),label:path.join("."),path,start,end,leadEnd:end,
      indent:entry.indent+4,markerToken:marker[1].toUpperCase(),parent:entry.key,
      title:source.slice(start,end),quote:source.slice(start,end)};
  });
}

// Expose the nearest larger source provision for an explicit reading action.
// The original referenced range and captured wording remain unchanged.
export function sourceEnclosingSection(source, target) {
  validSelections(source, [target]);
  const enclosing = sourceSectionIndex(source).filter(entry =>
    entry.start <= target.start && entry.end >= target.end &&
    (entry.start < target.start || entry.end > target.end))
    .sort((a,b) => (a.end-a.start)-(b.end-b.start));
  if (!enclosing.length) return null;
  const {kind,label,start,end,leadEnd,quote} = enclosing[0];
  return {kind,label,start,end,leadEnd,quote};
}

function tokenAt(text, start) {
  const match = text.slice(start).match(/^(?:\(([A-Za-z]|\d+(?:\.\d+)*)\)|([A-Za-z]\d+(?:\.\d+)*|[IVXLCDM]+|\d+(?:\.\d+)*|[A-Za-z]))(?=$|[^A-Za-z0-9])((?:\.(?:[A-Za-z]|\d+)(?=$|[^A-Za-z0-9])|\((?:[A-Za-z]|\d+)\))*)/i);
  if (!match) return null;
  const raw = (match[1] ?? match[2]) + match[3];
  return { path: pathParts(raw), end: start + match[0].length };
}
function expandBetween(first, last) {
  const a = first.path, b = last.path;
  if (a.length !== b.length || a.slice(0, -1).join(".") !== b.slice(0, -1).join(".")) return null;
  const from = a.at(-1), through = b.at(-1), prefix = a.slice(0, -1);
  if (/^[A-Z]$/.test(from) && /^[A-Z]$/.test(through) && from <= through)
    return Array.from({length: through.charCodeAt(0) - from.charCodeAt(0) + 1},
      (_, index) => [...prefix, String.fromCharCode(from.charCodeAt(0) + index)]);
  if (/^\d+$/.test(from) && /^\d+$/.test(through) && +through >= +from && +through - +from < 100)
    return Array.from({length: +through - +from + 1}, (_, index) => [...prefix, String(+from + index)]);
  return null;
}
function validSelections(source, selections) {
  if (typeof source !== "string") throw new TypeError("Source must be text.");
  if (!Array.isArray(selections)) throw new TypeError("Selected source ranges must be an array.");
  for (const range of selections)
    if (!range || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end)
      || range.start < 0 || range.end <= range.start || range.end > source.length
      || range.quote !== undefined && range.quote !== source.slice(range.start, range.end))
      throw new RangeError("Invalid exact source selection.");
  return selections;
}

// Missing, ambiguous and external targets remain visible to the caller.
// Resolution never adds target text to a promise or follows it recursively.
export function resolveSourceReferences(source, selections) {
  const selected = validSelections(source, selections);
  const index = sourceSectionIndex(source);
  const byKey = new Map();
  for (const entry of index) {
    if (!byKey.has(entry.key)) byKey.set(entry.key, []);
    byKey.get(entry.key).push(entry);
  }
  const result = [], pattern = /\b(sub[- \t]?sections?|sections?|clauses?|paragraphs?|articles?|exhibits?|appendix|appendices|schedules?)[ \t\r\n]+/gi;
  for (const match of source.matchAll(pattern)) {
    if (result.some(item => match.index < item.end)) continue;
    const first = tokenAt(source, match.index + match[0].length);
    if (!first) continue;
    const rawKind = match[1].toLowerCase().replace(/[- \t]/g, "");
    const relative = rawKind.startsWith("subsection") || rawKind.startsWith("paragraph");
    const kind = rawKind.startsWith("article") ? "article" : rawKind.startsWith("exhibit") ? "exhibit"
      : rawKind.startsWith("appendi") ? "appendix" : rawKind.startsWith("schedule") ? "schedule"
      : rawKind.startsWith("paragraph") ? "paragraph" : "section";
    let paths = [first.path], end = first.end, unsupported = false, anchor = null;
    let external = /\b(?:Code|Act|Constitution|Statutes?|Regulations?)(?:\s+of)?(?:\s+\d{4})?\s*$/i
      .test(source.slice(Math.max(0, match.index - 160), match.index));
    const commaChild = !relative && /^section$/i.test(rawKind) && first.path.length === 1
      ? source.slice(end).match(/^,[ \t\r\n]+([A-Z])\.(\d+(?:\.\d+)*)(?![\w]|\.\d)/)
      : null;
    if (commaChild) {
      paths = [[...first.path, commaChild[1], ...commaChild[2].split(".")]];
      end += commaChild[0].length;
    } else {
      for (;;) {
        const connector = source.slice(end).match(/^(?:\.(?=\s))?[ \t\r\n]*(?:(,)[ \t\r\n]*(?:(?:and|or)[ \t\r\n]+)?|((?:and|or|through|to))[ \t\r\n]+)/i);
        if (!connector || connector[1] && !rawKind.endsWith("s")) break;
        const next = tokenAt(source, end + connector[0].length);
        if (!next) break;
        if (/^(?:through|to)$/i.test(connector[2] ?? "")) {
          const expansion = expandBetween({path: paths.at(-1)}, next);
          if (!expansion) unsupported = true;
          else paths.splice(paths.length - 1, 1, ...expansion);
        } else paths.push(next.path);
        end = next.end;
      }
    }

    // Some agreements enumerate labels together with their titles. Keep all
    // explicit labels instead of quietly stopping after the first heading.
    if (rawKind === "sections" && first.path.length === 1) {
      const stop = source.indexOf(".", first.end);
      const sentenceEnd = stop < 0 ? source.length : stop;
      const rest = source.slice(first.end, sentenceEnd);
      const heading = byKey.get(keyFor("section", first.path))?.[0]?.title ?? "";
      const word = value => (value.match(/[\p{L}]+(?:['’][\p{L}]+)?/u)?.[0] ?? "").toUpperCase().replace(/’/g,"'");
      if (/^\s*[-–—]/.test(rest) || word(rest) && word(rest) === word(heading)) {
        const later = [...rest.matchAll(/(?:,\s*(?:and\s+)?|\s+and\s+)([IVXLCDM]+|\d+(?:\.\d+)*)(?=\s*[-–—]|\s+\p{Lu})/gu)];
        if (later.length) {
          paths = [first.path, ...later.map(item => pathParts(item[1]))];
          end = sentenceEnd;
        }
      }
    }
    const tail = source.slice(end);
    const externalPair = kind === "article" && tail.match(/^[ \t\r\n]*,[ \t\r\n]*Section[ \t\r\n]+[\dIVXLCDM]+[ \t\r\n]+of[ \t\r\n]+(?!this[ \t\r\n]+(?:Agreement|Contract)\b)[^.;|\n\u2029]+/i);
    const qualified = tail.match(/^(?:\.(?=\s))?[ \t\r\n]+of[ \t\r\n]+(?:this[ \t\r\n]+)?(Section|Article)[ \t\r\n]+/i);
    const local = tail.match(/^(?:\.(?=\s))?[ \t\r\n]+of[ \t\r\n]+(?:this|the)[ \t\r\n]+(Agreement|Contract|Section|Clause)\b/i);
    const outside = tail.match(/^(?:\.(?=\s))?[ \t\r\n]+of[ \t\r\n]+(?!this[ \t\r\n]+(?:Agreement|Contract|Section|Clause)\b|the[ \t\r\n]+(?:Agreement|Contract)\b)[^.;|\n\u2029]+/i);
    if (externalPair) { external = true; end += externalPair[0].length; }
    else if (qualified) {
      const parent = tokenAt(source, end + qualified[0].length);
      if (parent) { anchor = {kind: qualified[1].toLowerCase(), path: parent.path}; end = parent.end; }
      else unsupported = true;
    } else if (local) end += local[0].length;
    else if (outside) { external = true; end += outside[0].trimEnd().length; }
    const direction = source.slice(end).match(/^(?:\.(?=\s))?[ \t\r\n]+(above|below|hereof)\b/i);
    if (direction) end += direction[0].length;
    if (!selected.some(range => match.index >= range.start && end <= range.end)) continue;
    const containers = index.filter(entry => entry.start <= match.index && entry.end >= end)
      .sort((a, b) => b.path.length - a.path.length || b.start - a.start);
    const container = containers[0];
    // Named headings are locations, not outgoing references to themselves.
    if (paths.length === 1 && index.some(entry => entry.start === match.index
      && entry.kind === kind && entry.path.join(".") === paths[0].join("."))) continue;
    const targets = [], missing = [], ambiguous = [];
    const resolvedPaths = paths.map(path => {
      if (anchor) return {kind: anchor.kind, path: [...anchor.path, ...path]};
      // Letter-number labels identify whole document paths, even when the
      // author calls them paragraphs or subsections (for example F4.1).
      if (relative && /^[A-Z]\d+$/.test(path[0])) return {kind: "section", path};
      if (kind === "paragraph" && container?.kind === "paragraph" && /^[A-Z]+$/.test(path[0]))
        return {kind, path};
      if (!relative || path.length > 1 && path.every(part => /^\d+$/.test(part))) return {kind, path};
      if (!container) return {kind: kind === "paragraph" ? "paragraph" : "section", path};
      return {kind: container.kind, path: [...container.rootPath, ...path]};
    });
    if (!external && !unsupported) for (const target of resolvedPaths) {
      const key = keyFor(target.kind, target.path);
      const candidates = byKey.get(key) ?? [];
      const directional = candidates.filter(entry =>
        !direction || direction[1].toLowerCase() === "hereof"
        || direction[1].toLowerCase() === "above" && entry.end <= match.index
        || direction[1].toLowerCase() === "below" && entry.start >= end);
      if (!directional.length) missing.push(target.path.join("."));
      else if (directional.length > 1) ambiguous.push({
        label: target.path.join("."), candidates: directional.map(({start,end}) => ({start,end})),
      });
      else {
        const entry = directional[0];
        targets.push({kind: entry.kind, label: entry.label, start: entry.start, end: entry.end,
          leadEnd: entry.leadEnd, quote: entry.quote});
      }
    }
    const status = external ? "external" : unsupported ? "unsupported" : ambiguous.length ? "ambiguous"
      : missing.length ? (targets.length ? "partial" : "missing") : "resolved";
    result.push({
      start: match.index, end, quote: source.slice(match.index, end), kind,
      labels: resolvedPaths.map(target => target.path.join(".")), status,
      targets, missing, ambiguous,
    });
  }
  return result;
}

// Explicit manual access to an included copy leaves external resolution intact.
// A named copy declaration and one later exact heading are both required.
export function sourceAttachedReferenceCandidates(source, reference) {
  if(reference.status!=="external")return [];
  const qualifier=reference.quote.match(/\bof\s+(?:the\s+)?([^.;|\n\u2029]+)$/i);
  if(!qualifier)return [];
  const name=qualifier[1].trim().replace(/\s+/g," ").toLocaleLowerCase("en");
  const declarations=[...source.matchAll(/\bA[ \t]+copy[ \t]+of[ \t]+(?:the[ \t]+)?([^.;|\n\u2029]{1,100}?)[ \t]+is[ \t]+attached\b/gi)]
    .filter(match=>match[1].trim().replace(/\s+/g," ").toLocaleLowerCase("en")===name);
  if(declarations.length!==1)return [];
  const after=declarations[0].index+declarations[0][0].length;
  const index=sourceSectionIndex(source);
  return reference.labels.flatMap(label=>{
    const candidates=index.filter(entry=>entry.kind===reference.kind&&entry.label===label&&entry.start>after);
    if(candidates.length!==1)return [];
    const {kind,label:targetLabel,start,end,leadEnd,quote}=candidates[0];
    return [{kind,label:targetLabel,start,end,leadEnd,quote}];
  });
}

const definitionTerm = value => value.replace(/\s+/g, " ").trim();
// Explicit quotation marks survive some older flattened Word term cells.
// Each named term still targets the entire row; never pair separate meanings.
function definitionCellTerms(value, sharedMeaning = false) {
  const cell=value.trim();
  const quoted=[...cell.matchAll(/(?<!\S)[‘’“"']([^‘’“”"']{1,100})[‘’”"'](?=\s|[.,;]?$)/gu)];
  if(quoted.length)return quoted.map(match=>definitionTerm(match[1]));
  // An explicit shared-meaning declaration supports a list of named terms.
  // Keep the whole original row as each target; do not pair or rewrite meanings.
  const listed=cell.split(",").map(definitionTerm);
  if(sharedMeaning && listed.length>1 && listed.every(term=>/^\p{Lu}[\p{L}\p{N} \t-]{0,99}$/u.test(term)))return listed;
  const term=definitionTerm(cell.replace(/^[‘’“"'](?=\p{Lu})|[‘’”"']$/gu,""));
  return /^\p{Lu}[\p{L}\p{N} \t-]{0,99}$/u.test(term)?[term]:[];
}
const definitionPattern = /^[ \t]*(?:(?:\d+(?:\.\d+)+(?:[.)])?|\d+[.)]|[a-z][.)])[ \t]+)?[“"]([^”"\r\n]{1,100})[”"][ \t]+(?:means?\b|shall[ \t]+mean\b|is[ \t]+defined[ \t]+as\b|refers?[ \t]+to\b|are\b|is\b)/i;
const termPattern = term => new RegExp("(?<![\\p{L}\\p{N}\\p{Pd}\\p{Pc}])" +
  term.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+") +
  "(?![\\p{L}\\p{N}\\p{Pd}\\p{Pc}])", "giu");

// Source locations for human navigation, not inferred governing conditions.
export function sourceDefinitionIndex(source) {
  if (typeof source !== "string") throw new TypeError("Source must be text.");
  const sections = sourceSectionIndex(source);
  const containersAt = position => sections.filter(item => item.start <= position && item.end > position)
    .sort((a,b) => b.path.length-a.path.length || b.start-a.start);
  const locationAt = position => {
    const section=containersAt(position)[0];
    return section ? section.kind[0].toUpperCase()+section.kind.slice(1)+" "+section.label : "";
  };
  const nearby = (start,end) => {
    const root=containersAt(start).at(-1);
    return root ? {start:root.start,end:root.end} : {start,end};
  };
  const heads=sourceLines(source).flatMap(line=>{
    const match=line.text.match(definitionPattern);
    return match ? [{term:definitionTerm(match[1]),start:line.start+line.text.search(/\S/)}] : [];
  });
  const namedCopies=[...source.matchAll(/\bA\s+copy\s+of\s+(?:the\s+)?([^.;|\n\u2029]{1,100}?)\s+is\s+attached\b/gi)]
    .map(match=>({name:definitionTerm(match[1]).toLocaleLowerCase("en"),end:match.index+match[0].length}));
  const capitalizedDeclarations=[...source.matchAll(/\bAll\s+(?:other\s+)?capitalized\s+(?:words|terms)\s+have\s+the\s+meanings\s+given\s+in\s+(?:these|the)\s+([^.;|\n\u2029]{1,100})/gi)]
    .map(match=>({name:definitionTerm(match[1]).toLocaleLowerCase("en"),end:match.index+match[0].length}));
  const result=heads.map((head,index)=>{
    const ancestors=containersAt(head.start),container=ancestors[0];
    const definitionBlock=ancestors.find(item=>item.start<head.start&&/\b(?:defined\s+terms|definitions)\b/i.test(item.title));
    let end=Math.min(heads[index+1]?.start??source.length,container?.end??source.length);
    const prefix=source.slice(definitionBlock?.start??container?.start??0,head.start);
    const block=/\b(?:defined\s+terms|definitions)\b/i.test(prefix);
    if(!block)for(const gap of source.slice(head.start,end).matchAll(/\r?\n[ \t]*\r?\n/g)){
      const at=head.start+gap.index;
      if(/[.!?][\s”"')\]]*$/.test(source.slice(head.start,at))){end=at;break;}
    }
    const range=exactRange(source,head.start,end);
    const includedGlobal=definitionBlock&&!definitionBlock.parent&&/^(?:definitions|defined\s+terms)$/i.test(definitionBlock.title.trim())
      && capitalizedDeclarations.some(declaration=>declaration.end<definitionBlock.start
        && namedCopies.some(copy=>copy.name===declaration.name&&copy.end<definitionBlock.start));
    const global=block && (includedGlobal || /\b(?:throughout|for\s+(?:the\s+)?purposes\s+of|as\s+used\s+in)\s+(?:this|the)\s+(?:agreement|contract)\b/i.test(prefix))
      && !/\b(?:only|solely|for\s+purposes\s+of)\b[\s\S]{0,80}\b(?:this|the)\s+(?:section|subsection|paragraph)\b/i.test(prefix);
    return {...head,...range,kind:"definition",introduction:"defined",label:head.term,
      location:locationAt(head.start),quote:source.slice(range.start,range.end),
      navigationScope:global?{start:0,end:source.length}:nearby(range.start,range.end)};
  });

  // Word definition tables have a term cell and its exact meaning cell.
  // Require a definition introduction; ordinary schedules and form fields are
  // not declarations. Original paragraph or explicit quote boundaries separate names; all
  // names in a combined row retain the entire row, without guessed meaning pairs.
  for (const line of sourceLines(source)) {
    const row=line.text.match(/^[ \t]*\|([^|]+)\|([^|]+)\|[ \t]*$/);
    if(!row || !row[2].trim())continue;
    const container=containersAt(line.start)[0];
    const prefix=source.slice(container?.start??0,line.start);
    if(!/\b(?:definitions|defined\s+terms)\b/i.test(prefix))continue;
    const sharedMeaning=/\b(?:take|have)\s+the\s+meanings?\s+(?:given|set\s+out|assigned)\b/i.test(row[2]);
    for(const term of row[1].split("\u2029").flatMap(cell=>definitionCellTerms(cell,sharedMeaning))) {
    const range=exactRange(source,line.start,line.start+line.text.length);
    const restricted=/\b(?:only|solely|for\s+purposes\s+of)\b[\s\S]{0,80}\b(?:this|the)\s+(?:section|subsection|paragraph)\b/i.test(prefix);
    const global=!restricted && (
      /\b(?:throughout|for\s+(?:the\s+)?purposes\s+of|as\s+used\s+in)\s+(?:this|the)\s+(?:agreement|contract)\b/i.test(prefix)
      || /\bterms\s+and\s+expressions\s+used\s+in\s+these\s+Standard\s+Terms\s+and\s+Conditions\s+shall\s+have\s+the\s+meanings\s+set\s+out\s+below\b/i.test(prefix));
    result.push({kind:"definition",introduction:"defined",term,label:term,
      ...range,quote:source.slice(range.start,range.end),location:locationAt(range.start),
      navigationScope:global?{start:0,end:source.length}:nearby(range.start,range.end)});
    }
  }


  // An explicit Cover Page meaning declaration identifies the following table
  // as source vocabulary. Preserve complete rows, including unfilled options;
  // a reading target never chooses a value or establishes an operative term.
  const coverLines=sourceLines(source);
  const declaresCoverMeanings=line=>/^[ \t]*\|/.test(line.text)
    && /\bCapitalized\s+and\s+highlighted\s+words\s+have\s+the\s+meanings\s+given\s+on\s+the\s+Cover\s+Page\b/i.test(line.text)
    && !containersAt(line.start).length;
  const hasCoverMeanings=coverLines.some(declaresCoverMeanings);
  let coverRows=false;
  for(const [index,line] of coverLines.entries()){
    if(!line.text.trim())continue;
    if(declaresCoverMeanings(line)){coverRows="Cover Page";continue;}
    // The original SOW table identifies itself as a Cover Page in its
    // immediately following signing sentence. Require both that relationship
    // and the document's explicit meaning declaration, never just form labels.
    if(hasCoverMeanings && !containersAt(line.start).length
      && /^[ \t]*\|[ \t]*SOW[ \t]*\u2029[ \t]*The key business terms of this SOW are as follows:[ \t]*\|[ \t]*$/i.test(line.text)){
      const after=coverLines.slice(index+1).find(next=>next.text.trim()&&!/^[ \t]*\|/.test(next.text));
      if(after && /^By signing this Cover Page, each party agrees to enter into this SOW\b/i.test(after.text.trim())){
        coverRows="SOW Cover Page";continue;
      }
    }
    if(!/^[ \t]*\|/.test(line.text)){coverRows=false;continue;}
    if(!coverRows)continue;
    const row=line.text.match(/^[ \t]*\|([^|]+)\|([\s\S]+)\|[ \t]*$/);
    if(!row||!row[2].trim())continue;
    const term=definitionTerm(row[1].split("\u2029")[0]);
    if(!/^\p{Lu}[\p{L}\p{N} \t-]{0,99}$/u.test(term))continue;
    const range=exactRange(source,line.start,line.start+line.text.length);
    result.push({kind:"definition",introduction:"defined",term,label:term,
      ...range,quote:source.slice(range.start,range.end),location:coverRows,
      navigationScope:{start:0,end:source.length}});
  }

  const sentences=sourceSentencePassages(source);
  // Parenthetical capitalized names introduce aliases. Quoted vocabulary alone
  // ("claims made", "tail", or an external statute's wording) does not.
  for(const match of source.matchAll(/\(\s*(?:(?:the|collectively)\s+)?[“"]([^”"]{2,100})[”"]\s*\)/g)){
    const term=definitionTerm(match[1]);
    if(!/^\p{Lu}/u.test(term))continue;
    const enclosing=result.find(item=>item.start<=match.index&&item.end>=match.index+match[0].length);
    const sentence=sentences.find(item=>item.start<=match.index&&item.end>=match.index+match[0].length);
    const range=enclosing??sentence;
    if(!range)continue;
    // Nearby aliases avoid linking insurance Liability to an indemnity alias.
    result.push({kind:"definition",introduction:"introduced",term,label:term,
      start:range.start,end:range.end,quote:source.slice(range.start,range.end),
      location:locationAt(range.start),navigationScope:enclosing && !/Cover Page$/.test(enclosing.location) ? enclosing.navigationScope : nearby(range.start,range.end)});
  }
  const seen=new Set();
  return result.filter(item=>{
    const key=item.term.toLocaleLowerCase("en")+":"+item.start+":"+item.end;
    if(seen.has(key))return false;
    seen.add(key);return item.end>item.start;
  }).sort((a,b)=>a.start-b.start);
}

export function resolveSourceDefinitions(source,selections) {
  const selected=validSelections(source,selections),grouped=new Map();
  for(const target of sourceDefinitionIndex(source)){
    const key=target.term.toLocaleLowerCase("en");
    if(!grouped.has(key))grouped.set(key,{term:target.term,targets:[]});
    if(!selected.some(range=>range.start<=target.start&&range.end>=target.end))
      grouped.get(key).targets.push(target);
  }
  const result=[];
  for(const {term,targets:possible} of grouped.values()){
    if(!possible.length)continue;
    // Regular plural spelling is a manual reading aid, not another defined term.
    // An explicitly defined plural keeps its own identity.
    const plural=/[a-z]$/i.test(term)&&!/(?:s|x|z|y|ch|sh)$/i.test(term)?term+"s":null;
    const spellings=plural&&!grouped.has(plural.toLocaleLowerCase("en"))?[term,plural]:[term];
    const matches=spellings.flatMap(spelling=>[...source.matchAll(termPattern(spelling))]).filter(match=>
      selected.some(range=>match.index>=range.start&&match.index+match[0].length<=range.end));
    const represented=new Set();
    for(const match of matches){
      const targets=possible.filter(target=>
        match.index>=target.navigationScope.start&&match.index+match[0].length<=target.navigationScope.end);
      if(!targets.length)continue;
      const key=targets.map(target=>target.start+":"+target.end).join("|");
      if(represented.has(key))continue;
      represented.add(key);
      result.push({kind:"definition",start:match.index,end:match.index+match[0].length,
        quote:match[0],labels:[term],status:targets.length===1?"resolved":"ambiguous",
        targets,missing:[],ambiguous:targets.length>1?[{label:term,candidates:targets.map(({start,end})=>({start,end}))}]:[]});
    }
  }
  return result;
}

/** Build exact reverse links once per loaded source. These are reading locations,
 * not a statement that the referring wording governs the selected passage. */
export function sourceIncomingReferenceIndex(source) {
  const sections = sourceSectionIndex(source);
  return resolveSourceReferences(source, [{start:0,end:source.length}])
    .filter(reference => reference.status === "resolved")
    .flatMap(reference => {
      const origin = sections.filter(section => section.start <= reference.start && section.end >= reference.end)
        .sort((a,b) => (a.end-a.start)-(b.end-b.start))[0];
      if (!origin) return [];
      const {kind,label,start,end,leadEnd,quote} = origin;
      return reference.targets.filter(target => target.start !== start || target.end !== end)
        .map(target => ({target, origin:{kind,label,start,end,leadEnd,quote},
          reference:{start:reference.start,end:reference.end,quote:reference.quote}}));
    });
}

export function resolveIncomingSourceReferences(source, selections, index = sourceIncomingReferenceIndex(source)) {
  const selected = validSelections(source, selections), seen = new Set();
  const sections = sourceSectionIndex(source);
  const scopes = selected.flatMap(range => {
    const nearest = sections.filter(section => section.start <= range.start && section.end >= range.end)
      .sort((a,b) => (a.end-a.start)-(b.end-b.start))[0];
    return nearest ? [nearest] : [];
  });
  return index.flatMap(edge => {
    // A reference to a whole section is also a reading location for its child.
    // Keep the named target so the UI distinguishes it from a direct reference.
    const matching = scopes.filter(scope => edge.target.start <= scope.start && edge.target.end >= scope.end);
    if (!matching.length
      || selected.some(range => range.start <= edge.reference.start && range.end >= edge.reference.end)) return [];
    const key = edge.origin.start + ":" + edge.origin.end;
    if (seen.has(key)) return [];
    seen.add(key);
    const direct = matching.some(scope => scope.start === edge.target.start && scope.end === edge.target.end);
    return [direct ? edge : {...edge, viaContainingSection:true}];
  });
}
