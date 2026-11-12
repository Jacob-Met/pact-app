import { sourceTextSegments } from "./app/citation-view.mjs";
import { resolveSourceReferences } from "./app/source-references.mjs";
import { Buffer } from "node:buffer";
import { sourceLineMarker as numberedLine } from "./app/source-passages.mjs";
export const SOURCE_REQUEST_BYTES = 9000;
const STOP = new Set(("a an and are as at be been being by can could did do does for from had has have how i if in into is it its may must my of on or our shall should that the their them there these they this those to under was were what when where whether which who whose why will with would you your").split(" "));
function terms(text) {
  return (text.normalize("NFKC").toLocaleLowerCase("en").match(/[\p{L}\p{N}]+/gu) || [])
    .filter(word => !STOP.has(word))
    .map(word => word.length > 5 && word.endsWith("ies") ? word.slice(0, -3) + "y"
      : word.length > 4 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word);
}
function sourceLines(source) {
  return [...source.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)]
    .filter(match => match[0].length)
    .map(match => ({ start: match.index, end: match.index + match[0].length,
      text: match[0].replace(/[\r\n]+$/, "") }));
}
function explicitSurvival(text) {
  return /\b(?:clauses?|provisions?|sections?)\b(?:(?!\b(?:not|never)\b)[^!?;\n]){0,240}\bsurviv(?:e|es)\b/i.test(text);
}
function listRanges(source, units, { merge = true } = {}) {
  const lines = sourceLines(source);
  const ranges = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/[:\-–—]\s*$/.test(lines[i].text)) continue;
    let next = i + 1;
    while (next < lines.length && !lines[next].text.trim()) next++;
    const first = next < lines.length ? numberedLine(lines[next].text) : null;
    if (!first) continue;
    let end = lines[next].end, siblings = 1;
    const itemStarts = [lines[next].start];
    for (let j = next + 1; j < lines.length; j++) {
      const line = lines[j], text = line.text.trim();
      if (!text) continue;
      const marker = numberedLine(line.text);
      const indent = line.text.match(/^[ \t]*/)[0].replace(/\t/g, "    ").length;
      let sameNumberedTree = false, numberedSibling = false;
      if (marker?.family === "alphanumeric" && first.family === "alphanumeric") {
        const firstParts = first.token.split("."), parts = marker.token.split(".");
        const parent = firstParts.slice(0, -1).join(".");
        if (parts.length < firstParts.length ||
            parts.slice(0, firstParts.length - 1).join(".") !== parent) break;
        // Word extraction may move a numbered sibling to the left margin.
        // Its explicit parent path is stronger evidence than that indentation.
        sameNumberedTree = firstParts.length > 1;
        numberedSibling = parts.length === firstParts.length;
      }
      if (marker && !sameNumberedTree && (marker.indent < first.indent ||
          marker.indent === first.indent && marker.family !== first.family)) break;
      if (!marker && indent < first.indent) break;
      if (!marker && indent <= first.indent && /[A-Z]/.test(text) && text === text.toUpperCase()) break;
      if (marker && (sameNumberedTree ? numberedSibling : marker.indent === first.indent)) {
        siblings++; itemStarts.push(line.start);
      }
      end = line.end;
    }
    if (siblings < 2) continue;
    let intro = i;
    while (intro > 0 && lines[intro - 1].text.trim() && !numberedLine(lines[intro].text)) intro--;
    const introStart = lines[intro].start + lines[intro].text.search(/\S/);
    const begin = units.findIndex(unit => unit.start <= introStart && unit.end > introStart);
    const last = units.findLastIndex(unit => unit.start < end && unit.end > lines[next].start);
    if (begin >= 0 && last >= begin) {
      const items = itemStarts.map((start,index) => ({
        begin: units.findIndex(unit => unit.end > start),
        last: units.findLastIndex(unit => unit.start < (itemStarts[index+1] ?? end))
      })).filter(item => item.begin >= 0 && item.last >= item.begin);
      const introduction = source.slice(introStart, lines[next].start).replace(/\s+/g," ");
      const mandatory = !/\b(?:any|either|one)\s+(?:of\s+)?(?:the\s+)?following\b/i.test(introduction) &&
        (/\ball\s+(?:of\s+)?(?:the\s+)?(?:following|requirements)\b/i.test(introduction) ||
         /\b(?:after|unless|if)\s*[:\-–—]\s*$/i.test(introduction) || /\bfollowing\s+(?:(?:provisions|conditions|requirements)\s+(?:shall|must|will)\s+apply|clauses\s+(?:shall|must|will)\s+survive)\b/i.test(introduction));
      if(items.length) ranges.push({ begin, last, items, mandatory, survival:explicitSurvival(introduction) });
    }
  }
  ranges.sort((a, b) => a.begin - b.begin || b.last - a.last);
  if (!merge) return ranges;
  const merged = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.begin <= previous.last) previous.last = Math.max(previous.last, range.last);
    else merged.push({ ...range });
  }
  return merged;
}

// Explicit quoted definitions remain complete across PDF page furniture. A
// referenced term adds its exact definition to model input; recording stays explicit.
function quotedDefinitions(source, units) {
  const lines = sourceLines(source);
  const definition = /^[ \t]*(?:(?:\d+(?:\.\d+)*|[a-z])[.)][ \t]+)?[“"]([^”"\r\n]{1,100})[”"][ \t]+(?:means?\b|shall[ \t]+mean\b|is[ \t]+defined[ \t]+as\b|refers?[ \t]+to\b|are\b|is\b)/i;
  const heads = lines.map((line, index) => {
    const match = line.text.match(definition);
    return match ? { index, term:match[1].replace(/\s+/g," ").trim(), start:line.start + line.text.search(/\S/),
      indent:line.text.match(/^[ \t]*/)[0].replace(/\t/g,"    ").length } : null;
  }).filter(Boolean);
  return heads.map(head => {
    let end = source.length;
    for (let index = head.index + 1; index < lines.length; index++) {
      const line = lines[index], marker = numberedLine(line.text);
      if (definition.test(line.text) || marker && marker.indent <= head.indent) {
        end = line.start; break;
      }
    }
    const selected = units.filter(unit => unit.end > head.start && unit.start < end);
    const escaped = head.term.replace(/[.*+?^$(){}|[\]\\]/g,"\\$&").replace(/\s+/g,"\\s+");
    return { ...head, units:selected,
      match:new RegExp("(?<![\\p{L}\\p{N}-])" + escaped + "(?![\\p{L}\\p{N}-])","iu") };
  }).filter(item => item.units.length);
}
// Page furniture and blank extraction lines can split an unfinished sentence.
// Keep those original units together instead of showing only its first half.
function sentenceContinuations(source, units) {
  let cursor = 0;
  const furnitureRanges = [];
  const prose = sourceTextSegments(source).map(part => {
    const start = cursor; cursor += part.text.length;
    if (!/^citation-page-/.test(part.className)) return part.text;
    furnitureRanges.push({start,end:cursor});
    return part.text.replace(/[^\r\n]/g, " ");
  }).join("");
  const bounds = units.map(unit => {
    const text = prose.slice(unit.start, unit.end);
    return text.trim() ? {
      start:unit.start + text.search(/\S/),
      end:unit.start + text.trimEnd().length,
      text:text.trim()
    } : null;
  });
  const markerOnly = text => /^(?:[ivxlcdm]+|[a-z]|\d+(?:\.\d+)*)[.)]$/i.test(text);
  const finished = text => /[.?!;:]["\u201d')\]]*\s*$/.test(text);
  return units.flatMap((unit,index) => {
    const content = bounds[index];
    if (!content) return [];
    if (markerOnly(content.text)) {
      const next = units[index+1], nextContent = bounds[index+1];
      if (!next || !nextContent || markerOnly(nextContent.text)) return [];
      const selected = [unit,next];
      const words = nextContent.text.replace(/[.:]$/, "").split(/\s+/);
      const heading = /[.:]$/.test(nextContent.text) &&
        words.every(word => /^\p{Lu}/u.test(word) || STOP.has(word.toLowerCase()));
      if (heading && units[index+2] && !markerOnly(bounds[index+2]?.text ?? "")) selected.push(units[index+2]);
      return [{units:selected}];
    }
    if (finished(content.text)) return [];
    const selected = [unit];
    let previousEnd = content.end;
    const pendingFurniture = [];
    for (let next = index + 1; next < units.length; next++) {
      const candidate = units[next], nextContent = bounds[next], value = nextContent?.text ?? "";
      if (!nextContent) { pendingFurniture.push(candidate); continue; }
      if (markerOnly(value) || numberedLine(value) || /^["\u201c"][^"\u201d"]+["\u201d"]\s+(?:means?|are|is)\b/i.test(value)) break;
      if (nextContent) {
        const gap = prose.slice(previousEnd, nextContent.start).replace(/\r\n?/g, "\n");
        // A blank paragraph is not evidence of sentence continuation. Only
        // existing, recognized page furniture may bridge that boundary.
        if (/\n\s*\n/.test(gap) && !furnitureRanges.some(range =>
          range.start < nextContent.start && range.end > previousEnd)) break;
      }
      selected.push(...pendingFurniture, candidate);
      pendingFurniture.length = 0;
      if (nextContent) previousEnd = nextContent.end;
      if (finished(value)) break;
    }
    return selected.length > 1 ? [{units:selected}] : [];
  });
}

// Explicit universal conditions also govern distant uses of their subject
// (for example, "No amendment ... unless ..." and a cap changed by amendment).
// This only makes the original wording available; the model must still select it.
function universalConditions(units) {
  return units.flatMap(unit => {
    const match = unit.text.match(/^\s*(?:\d+(?:\.\d+)*[.)]\s+|\([a-z0-9]+\)\s+|[a-z][.)]\s+)?(?:no|any|each|every|all)\s+(?:such\s+)?([\p{L}][\p{L}\p{N}-]*)\b/iu);
    if (!match || !/\b(?:unless|only|until|except|provided|subject\s+to|while)\b/i.test(unit.text)) return [];
    const key = terms(match[1])[0];
    if (!key || key.length < 4) return [];
    return [{ key, units:[unit] }];
  });
}

function referenceClosure(group, references, units) {
  const included = new Set(group.units.map(unit => unit.id));
  const seen = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    const text = units.filter(unit => included.has(unit.id)).map(unit => unit.text).join("\n");
    const words = new Set(terms(text));
    for (const definition of references) {
      if (seen.has(definition)) continue;
      const mentioned = definition.matches ? definition.matches(units.filter(unit => included.has(unit.id))) : definition.match ? definition.match.test(text) : words.has(definition.key);
      if (!mentioned && !(definition.triggerUnits ?? definition.units).some(unit => included.has(unit.id))) continue;
      seen.add(definition);
      for (const unit of definition.units) if (!included.has(unit.id)) {
        included.add(unit.id); changed = true;
      }
    }
  }
  return units.filter(unit => included.has(unit.id));
}

// Preserve coherent input paragraphs, including blank entries emitted by PDF
// sentence segmentation. These groups do not determine the returned quotation.
function contextGroups(source, units) {
  const lists = listRanges(source, units), starts = new Map(lists.map(range => [range.begin, range.last]));
  const groups = [];
  for (let index = 0; index < units.length; index++) {
    const unit = units[index], listEnd = starts.get(index);
    if (listEnd !== undefined) {
      groups.push({ start: unit.start, units: units.slice(index, listEnd + 1), list: true });
      index = listEnd;
      continue;
    }
    let group = groups.at(-1);
    if (!unit.text.trim()) {
      if (group) group.units.push(unit);
      else groups.push({ start: unit.start, units: [unit] });
      continue;
    }
    const prior = group?.units.findLast(item => item.text.trim());
    const gap = prior ? source.slice(prior.end, unit.start) : "";
    if (!group || !prior || group.list || /\n\s*\n/.test(gap.replace(/\r\n?/g, "\n"))) {
      group = { start: unit.start, units: [] }; groups.push(group);
    }
    group.units.push(unit);
  }
  return groups;
}

function boundedGroups(groups, maxBytes, measure) {
  const target = Math.max(Math.floor(maxBytes / 4), measure([]) + 1);
  return groups.flatMap(group => {
    if (group.list || measure(group.units) <= maxBytes) return [group];
    const windows = [];
    let current = [];
    for (const unit of group.units) {
      if (current.length && measure([...current, unit]) > target) {
        windows.push({ start: current[0].start, units: current });
        const overlap = current.findLast(item => item.text.trim());
        current = overlap && measure([overlap, unit]) <= target ? [overlap] : [];
      }
      current.push(unit);
    }
    if (current.length) windows.push({ start: current[0].start, units: current });
    return windows;
  });
}

export function selectSourceContext(source, objective, units, {
  maxBytes = SOURCE_REQUEST_BYTES,
  maxGroups = Infinity,
  includeReferences = false,
  measure = selected => Buffer.byteLength(JSON.stringify(selected.map(({ id, text }) => ({ id, text })))),
} = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError("Invalid source context budget.");
  if (!(maxGroups === Infinity || Number.isSafeInteger(maxGroups) && maxGroups > 0)) throw new RangeError("Invalid source group budget.");
  const allBytes = measure(units);
  if (allBytes <= maxBytes) return { units, ranked: false, bytes: allBytes, totalUnits: units.length };
  const groups = boundedGroups(contextGroups(source, units), maxBytes, measure);
  const query = [...new Set(terms(objective))].filter(word => !includeReferences || !["after","before","during","then","than","such","each","every","all","any","also"].includes(word));
  const documents = groups.map(group => {
    const words = terms(group.units.map(unit => unit.text).join(" "));
    const counts = new Map();
    for (const word of words) counts.set(word, (counts.get(word) || 0) + 1);
    return { counts, length: Math.max(1, words.length) };
  });
  const average = documents.reduce((sum, item) => sum + item.length, 0) / Math.max(1, documents.length);
  const frequencies = new Map(query.map(word => [word, documents.filter(item => item.counts.has(word)).length]));
  const scoreWord = (item, word) => {
    const count = item.counts.get(word) || 0;
    if (!count) return 0;
    const frequency = frequencies.get(word);
    const idf = Math.log(1 + (documents.length - frequency + .5) / (frequency + .5));
    return idf * count * 2.2 / (count + 1.2 * (.25 + .75 * item.length / average));
  };
  const scores = documents.map(item => query.reduce((score, word) => score + scoreWord(item, word), 0));
  const contextual = scores.map((score, index) => Math.max(score,
    (scores[index - 1] || 0) * .7, (scores[index + 1] || 0) * .7,
    (scores[index - 2] || 0) * .35, (scores[index + 2] || 0) * .35));
  const ranked = groups.map((group, index) => ({ ...group, index, score: contextual[index] }))
    .filter(group => group.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  const references = includeReferences ? [...quotedDefinitions(source, units), ...universalConditions(units), ...sentenceContinuations(source, units)] : [];
  // Keep incoming references as separate candidates: their size must not
  // prevent the target clause from entering the request.
  const incoming = includeReferences ? resolveSourceReferences(source, [{start:0,end:source.length}])
    .filter(ref => ref.status === "resolved").flatMap(ref => {
      const index = groups.findIndex(g => g.units.some(u => u.start <= ref.start && u.end >= ref.end));
      return index < 0 ? [] : ref.targets.flatMap(target => {
        const targetIds = units.filter(u => u.start < target.end && u.end > target.start).map(u => u.id);
        return targetIds.length ? [{index,targetIds}] : [];
      });
    }) : [];
  const primary = new Set(), attemptedIncoming = new Set();
  const chosen = new Set();
  const ordered = () => units.filter(unit => chosen.has(unit.id));
  const bundles = new Map();
  let groupsSelected = 0;
  const add = (group, related = false) => {
    if (groupsSelected >= maxGroups) return false;
    if (!bundles.has(group.index))
      bundles.set(group.index, references.length ? referenceClosure(group, references, units) : group.units);
    const additions = bundles.get(group.index).filter(unit => !chosen.has(unit.id));
    if (!additions.length) return false;
    for (const unit of additions) chosen.add(unit.id);
    if (measure(ordered()) > maxBytes) {
      for (const unit of additions) chosen.delete(unit.id);
      return false;
    }
    groupsSelected++;
    if (!related) for (const unit of group.units) primary.add(unit.id);
    return true;
  };
  const addIncoming = () => {
    const candidates = [...new Set(incoming.filter(edge =>
      edge.targetIds.every(id => primary.has(id))).map(edge => edge.index))]
      .filter(index => !attemptedIncoming.has(index))
      .map(index => ({...groups[index],index,score:contextual[index]}))
      .sort((a,b) => b.score-a.score || a.index-b.index);
    for (const group of candidates) {
      attemptedIncoming.add(group.index);
      add(group, true);
    }
  };
  if (includeReferences) {
    // Reserve room for different parts of a question before repeated matches
    // and neighboring paragraphs can exhaust the bounded input.
    const remaining = new Set(query.filter(word => frequencies.get(word) > 0));
    while (remaining.size && groupsSelected < maxGroups) {
      const coverage = groups.map((group,index) => ({...group,index,
        score:[...remaining].reduce((sum,word) => sum + scoreWord(documents[index],word),0)
      })).filter(group => group.score > 0).sort((a,b) => b.score-a.score || a.index-b.index);
      if (!coverage.some(group => add(group))) break;
      for (const word of terms(ordered().map(unit => unit.text).join(" "))) remaining.delete(word);
    }
  }
  addIncoming();
  for (const group of ranked) {
    if (groupsSelected >= maxGroups) break;
    if (add(group)) addIncoming();
  }
  const selected = ordered();
  return { units: selected, ranked: true, bytes: measure(selected), totalUnits: units.length, groupsSelected };
}

export function completeSourceSelection(source, units, passages, { completeSurvivalReferences = false } = {}) {
  const selected = units.filter(unit => passages.some(range => unit.end > range.start && unit.start < range.end));
  const structural = unit => {
    const text = unit.text.trim();
    if (/^(?:[ivxlcdm]+|[a-z]|\d+(?:\.\d+)*)[.)]$/i.test(text) ||
        /^[A-Z]{1,3}$/.test(text) || /^(?:page\s+)?\d+\s+of\s+\d+$/i.test(text)) return true;
    if (/\b(?:shall|must|will|may|is|are|means|requires?|agrees?)\b/i.test(text)) return false;
    const words = text.replace(/[.:]$/,"").split(/\s+/);
    return words.length <= 14 && words.every(word => /^\p{Lu}/u.test(word) || STOP.has(word.toLowerCase()));
  };
  const references = sentenceContinuations(source, units).map(reference => ({...reference, triggerUnits:reference.units.filter(unit => !structural(unit))}));
  const lists = listRanges(source, units, { merge: false });
  for (const list of lists) {
    const body = units.slice(list.begin, list.last + 1);
    if (list.mandatory) references.push({ units: body, triggerUnits:body.filter(unit => !structural(unit)) });
    else {
      const intro = units.slice(list.begin, list.items[0].begin);
      for (const item of list.items) {
        const child = units.slice(item.begin, item.last + 1);
        references.push({ units: [...intro, ...child], triggerUnits: child.filter(unit => !structural(unit)).slice(0,1) });
      }
    }
  }
  const lines = sourceLines(source);
  for (const definition of quotedDefinitions(source, units)) {
    const prior = lines.filter(line => line.start < definition.start && numberedLine(line.text));
    const scope = source.slice(prior.at(-1)?.start ?? 0, definition.start);
    const global = /\b(?:defined terms|definitions)\b/i.test(scope) &&
      /\bthroughout\s+(?:the|this)\s+(?:agreement|contract)\b/i.test(scope);
    const local = /\b(?:only|solely|for purposes of)\b[\s\S]{0,80}\b(?:this|the)\s+(?:section|subsection|paragraph)\b/i.test(scope);
    if (global && !local) references.push(definition);
  }

  const headings = lines.flatMap(line => {
    const marker = numberedLine(line.text);
    return marker && (/^[IVXLCDM]+$/.test(marker.token) || /^\d+$/.test(marker.token))
      ? [{start:line.start,indent:marker.indent}] : [];
  });
  const topIndent = Math.min(...headings.map(item => item.indent));
  const topHeadings = headings.filter(item => item.indent === topIndent);
  const sectionAt = position => topHeadings.findLast(item => item.start <= position)?.start ?? -1;
  for (const unit of units) {
    if (!/\b(?:means?|are|is|shall\s+be|called|referred\s+to)\b/i.test(unit.text)) continue;
    for (const match of unit.text.matchAll(/\(\s*(?:(?:the|collectively)\s+)?[“"]([^”"\r\n]{2,100})[”"]\s*\)/g)) {
      const term = match[1].trim();
      const escaped = term.replace(/[.*+?^$(){}|[\]\\]/g,"\\$&").replace(/\s+/g,"\\s+");
      const termMatch = new RegExp("(?<![\\p{L}\\p{N}-])" + escaped + "(?![\\p{L}\\p{N}-])","iu");
      const paragraphOnly = /\b(?:for\s+(?:the\s+)?purposes\s+of|in|within)\s+this\s+paragraph\b/i.test(unit.text);
      const definitionSection = sectionAt(unit.start);
      const globalDefinition = /\b(?:throughout|for\s+(?:the\s+)?purposes\s+of)\s+(?:this|the)\s+(?:agreement|contract)\b/i.test(unit.text);
      references.push({units:[unit], matches: visible => visible.some(other => {
        if (paragraphOnly && other.id !== unit.id || !termMatch.test(other.text)) return false;
        const otherSection = sectionAt(other.start);
        if (globalDefinition || definitionSection >= 0 && otherSection === definitionSection) return true;
        const between = source.slice(Math.min(unit.end,other.end),Math.max(unit.start,other.start)).replace(/\r\n?/g,"\n");
        return definitionSection < 0 && otherSection < 0 && !/\n\s*\n/.test(between);
      })});
    }
  }

  // Universal-looking rules remain input candidates. Final selection must
  // name them explicitly; noun overlap cannot establish their applicability.
  const completed = referenceClosure({ units: selected }, references, units);
  // Only an explicit survival statement preserves an entire selected provision.
  // A reference to rates, an exception or another section does not make every
  // sentence there part of the answer. Follow only references in the original
  // selection, to targets the model already selected in part, and one hop.
  const survivalLists = lists.filter(list => list.survival)
    .map(list => ({start:units[list.begin].start,end:units[list.last].end}));
  const isSurvivalReference = reference => survivalLists.some(range =>
    reference.start >= range.start && reference.end <= range.end) ||
    selected.some(unit => reference.start >= unit.start && reference.end <= unit.end && explicitSurvival(unit.text));
  const bodyTarget = target => {
    const lead = source.slice(target.start,target.leadEnd).trim();
    // A standalone title may sit outside the model's chosen body. Keep every
    // operative or conditional lead, even when it is styled as a heading.
    const titleOnly = target.leadEnd < target.end && !/[\r\n]/.test(lead) &&
      lead.length <= 180 && !/[.?!;:]/.test(target.title) &&
      !/\b(?:shall|must|will|may|is|are|means|requires?|agrees?|pay|deliver|retain|keep|return|provide|submit|notify|ensure|supply)\b/i.test(lead) &&
      !/\b(?:if|unless|only|except|provided|subject|after|before|until|without|no|not|when|where|on|upon|following|during|while|once|conditional|despite|notwithstanding)\b/i.test(lead);
    if (!titleOnly) return target;
    const offset = source.slice(target.leadEnd,target.end).search(/\S/);
    return offset < 0 ? target : {...target,start:target.leadEnd+offset};
  };
  const referenced = completeSurvivalReferences
    ? [...new Map(resolveSourceReferences(source, passages)
      .filter(reference => reference.status === "resolved" && isSurvivalReference(reference))
      .flatMap(reference => reference.targets)
      .filter(target => selected.some(unit => unit.start < target.end && unit.end > target.start))
      .map(bodyTarget)
      .filter(target => !passages.some(range => range.start <= target.start && range.end >= target.end))
      .map(target => [target.start + ":" + target.end, target])).values()]
    : [];
  const visibleIds = new Set(completed.map(unit => unit.id));
  for (const unit of units)
    if (referenced.some(target => unit.start < target.end && unit.end > target.start)) visibleIds.add(unit.id);
  const completeUnits = units.filter(unit => visibleIds.has(unit.id));
  const ranges = [...passages, ...completed.map(unit => ({ start: unit.start, end: unit.end, quote: source.slice(unit.start, unit.end) })),
    ...referenced.map(({start,end}) => ({start,end,quote:source.slice(start,end)}))]
    .sort((a,b) => a.start-b.start || a.end-b.end);
  const merged = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && (range.start <= previous.end || !source.slice(previous.end, range.start).trim())) {
      previous.end = Math.max(previous.end, range.end);
      previous.quote = source.slice(previous.start, previous.end);
    } else merged.push({ ...range });
  }
  return { passages: merged, units: completeUnits, hasRuleText:completeUnits.some(unit => !structural(unit)),
    referencedSections: referenced.map(({kind,label,start,end}) => ({kind,label,start,end})) };
}
