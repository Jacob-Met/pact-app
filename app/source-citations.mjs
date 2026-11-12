export const MAX_CITATION_CHARACTERS = 4000;
export const MAX_CITATION_TOTAL_CHARACTERS = 12000;
export const MAX_CITATION_PASSAGES = 16;
// Explicit authoring can use the complete existing passage envelope. The model
// proposal path retains its narrower aggregate bound.
export const MAX_CAPTURE_TOTAL_CHARACTERS =
  MAX_CITATION_PASSAGES * MAX_CITATION_CHARACTERS + (MAX_CITATION_PASSAGES - 1) * 2;

const fail = (code, message, citationLimit) => { throw Object.assign(new RangeError(message), { code, ...(citationLimit ? { citationLimit } : {}) }); };
function exact(value, fields, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_OBJECT", name + " must be an object.");
  const extra = Object.keys(value).find(key => !fields.includes(key));
  if (extra) fail("UNKNOWN_FIELD", name + " contains unsupported field " + extra + ".");
}
function checkRange(range, source, limit = MAX_CITATION_CHARACTERS) {
  if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) ||
      range.start < 0 || range.end <= range.start || range.end > source.length)
    fail("CITATION_RANGE", "Citation range is invalid.");
  const splitsPair = offset => offset > 0 && offset < source.length &&
    /[\uD800-\uDBFF]/.test(source[offset - 1]) && /[\uDC00-\uDFFF]/.test(source[offset]);
  if (splitsPair(range.start) || splitsPair(range.end))
    fail("CITATION_RANGE", "Citation boundaries cannot split a Unicode surrogate pair.");
  if (typeof range.quote !== "string" || range.quote.length > limit)
    fail("CITATION_SIZE", "Citation quote must be at most " + limit.toLocaleString("en-US") + " UTF-16 code units.",
      typeof range.quote === "string" ? { kind:"passage_length", actual:range.quote.length, limit } : undefined);
  if (source.slice(range.start, range.end) !== range.quote)
    fail("CITATION_MISMATCH", "Citation quote does not match the source exactly.");
}

export function citationPassages(citation) {
  if (!citation) return [];
  if (citation.related !== undefined && !Array.isArray(citation.related))
    fail("CITATION_RANGES", "Related source passages must be an array.");
  return [{ start: citation.start, end: citation.end, quote: citation.quote },
    ...(citation.related ?? []).map(({ start, end, quote }) => ({ start, end, quote }))];
}

export function citationPassagesText(passages) {
  return passages.map((passage, index) => (index && passages[index - 1].end !== passage.start ? "\n\n" : "") + passage.quote).join("");
}

export function citationText(citation) {
  return citationPassagesText(citationPassages(citation));
}

export function validateSourceCitation(citation, source) {
  return validateCitation(citation, source, MAX_CAPTURE_TOTAL_CHARACTERS);
}

function validateCitation(citation, source, totalLimit) {
  exact(citation, ["sourceId", "sourceRevision", "start", "end", "quote", "related"], "citation");
  if (citation.sourceId !== source.id || citation.sourceRevision !== source.revision)
    fail("CITATION_SOURCE", "Citation does not target this source revision.");
  checkRange(citation, source.text);
  if (citation.related !== undefined) {
    if (!Array.isArray(citation.related) || !citation.related.length ||
        citation.related.length >= MAX_CITATION_PASSAGES)
      fail("CITATION_RANGES", "A citation supports one through sixteen separate source passages.",
        Array.isArray(citation.related) && citation.related.length >= MAX_CITATION_PASSAGES
          ? { kind:"passage_count", actual:1+citation.related.length, limit:MAX_CITATION_PASSAGES } : undefined);
    let end = citation.end;
    for (const passage of citation.related) {
      exact(passage, ["start", "end", "quote"], "related citation");
      checkRange(passage, source.text);
      if (passage.start < end) fail("CITATION_RANGE", "Source passages must be ordered and must not overlap.");
      end = passage.end;
    }
  }
  const totalCharacters = citationText(citation).length;
  if (totalCharacters > totalLimit)
    fail("CITATION_SIZE", "The complete cited wording must fit within " + totalLimit.toLocaleString("en-US") + " characters.",
      { kind:"total_length", actual:totalCharacters, limit:totalLimit });
  return citation;
}

// Sort and combine only overlap or whitespace. Omitted words are never bridged.
export function sourceCitation(source, ranges) {
  return buildSourceCitation(source, ranges, false);
}

// Explicit author capture may represent one long provision as adjacent exact
// pieces. Automatic/model normalization retains its existing strict behavior.
export function captureSourceCitation(source, ranges) {
  return buildSourceCitation(source, ranges, true);
}

function partitionSourceRange(source, range) {
  const pieces = [];
  let start = range.start;
  while (range.end - start > MAX_CITATION_CHARACTERS) {
    let end = start + MAX_CITATION_CHARACTERS;
    const newline = source.lastIndexOf("\n", end - 1);
    if (newline > start) end = newline + 1;
    else {
      const whitespace = source.slice(start, end).match(/\s+\S*$/u);
      if (whitespace && whitespace.index > 0) end = start + whitespace.index + whitespace[0].match(/^\s+/u)[0].length;
    }
    if (/[\uD800-\uDBFF]/.test(source[end - 1]) && /[\uDC00-\uDFFF]/.test(source[end])) end--;
    pieces.push({start, end, quote:source.slice(start, end)});
    start = end;
  }
  pieces.push({start, end:range.end, quote:source.slice(start, range.end)});
  return pieces;
}

function buildSourceCitation(source, ranges, partitionLongPassages) {
  if (!Array.isArray(ranges) || !ranges.length)
    fail("CITATION_RANGES", "Choose at least one source passage.");
  // The limit applies to the resulting separate passages. An explicit added
  // range can join or extend existing passages even when the maximum is already captured.
  const sorted = ranges.map(range => {
    exact(range, ["start", "end", "quote"], "source passage");
    checkRange(range, source.text, partitionLongPassages ? MAX_CAPTURE_TOTAL_CHARACTERS : MAX_CITATION_CHARACTERS);
    return { ...range };
  }).sort((a, b) => a.start - b.start || a.end - b.end);
  const combined = [];
  for (const range of sorted) {
    const previous = combined.at(-1);
    if (previous && (range.start <= previous.end || !source.text.slice(previous.end, range.start).trim())) {
      previous.end = Math.max(previous.end, range.end);
      previous.quote = source.text.slice(previous.start, previous.end);
    } else combined.push({ ...range });
  }
  const bounded = partitionLongPassages ? combined.flatMap(range => partitionSourceRange(source.text, range)) : combined;
  const [first, ...related] = bounded;
  const citation = { sourceId: source.id, sourceRevision: source.revision, ...first,
    ...(related.length ? { related } : {}) };
  return validateCitation(citation, source,
    partitionLongPassages ? MAX_CAPTURE_TOTAL_CHARACTERS : MAX_CITATION_TOTAL_CHARACTERS);
}

// JSON can encode one UTF-16 code unit as six characters (for example a
// control character). Include each range's numeric fields, punctuation and
// array separators so every supported canonical capture can be saved.
const MAX_RELATED_PASSAGES = MAX_CITATION_PASSAGES - 1;
const MAX_RANGE_JSON_LENGTH = JSON.stringify({
  start: Number.MAX_SAFE_INTEGER, end: Number.MAX_SAFE_INTEGER, quote: ""
}).length + MAX_CITATION_CHARACTERS * 6;
export const MAX_CITATION_DRAFT_LENGTH =
  2 + MAX_RELATED_PASSAGES * MAX_RANGE_JSON_LENGTH + MAX_RELATED_PASSAGES - 1;

export function citationDraftFields(citation) {
  return {
    citationStart: citation ? String(citation.start) : "",
    citationEnd: citation ? String(citation.end) : "",
    citationQuote: citation?.quote ?? "",
    citationRelated: citation?.related ? JSON.stringify(citation.related) : ""
  };
}

export function citationFromDraft(source, values) {
  const raw = values.citationRelated ?? "";
  if (typeof raw !== "string" || raw.length > MAX_CITATION_DRAFT_LENGTH)
    fail("CITATION_RANGES", "Saved source passages are too large.");
  let related;
  try { related = raw ? JSON.parse(raw) : []; }
  catch { fail("CITATION_RANGES", "Saved source passages could not be read."); }
  if (!Array.isArray(related)) fail("CITATION_RANGES", "Saved source passages must be an array.");
  if (!values.citationQuote) {
    if (related.length) fail("CITATION_RANGES", "Choose the first source passage again.");
    return null;
  }
  return validateSourceCitation({
    sourceId: source.id, sourceRevision: source.revision,
    start: Number(values.citationStart), end: Number(values.citationEnd), quote: values.citationQuote,
    ...(related.length ? { related } : {})
  }, source);
}
