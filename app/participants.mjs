// Setup labels declare participants, not authenticated identities or fixed roles.
export function declaredParties(first, second, additional = "") {
  if ([first, second, additional].some(value => typeof value !== "string")) throw new Error("Enter party names as text.");
  const extras = additional.split(/\r?\n/).map(name => name.trim()).filter(Boolean);
  const names = [first.trim(), second.trim(), ...extras];
  if (names.length > 8) throw new Error("An agreement supports up to eight parties. Keep at most six additional names.");
  if (names.some(name => !name || name.length > 120)) throw new Error("Each party needs a name of 1–120 characters.");
  const seen = new Set();
  for (const name of names) {
    const key = name.normalize("NFKC").toLocaleLowerCase("en-US");
    if (seen.has(key)) throw new Error("Party names must be distinct. Add a distinguishing team or role to “" + name + "”.");
    seen.add(key);
  }
  return names.map((name, index) => ({ id: "party-" + String.fromCharCode(97 + index), name }));
}
