import test from "node:test";
import assert from "node:assert/strict";
import { extractAgreement, pageText, MAX_AGREEMENT_BYTES } from "../app/agreement-file.mjs";

test("UTF-8 agreement text preserves Unicode and paragraph boundaries", async () => {
  const file = new File(["\uFEFFDelivery to café.\r\n\r\nPayment follows acceptance."], "terms.txt");
  const result = await extractAgreement(file);
  assert.equal(result.text, "Delivery to café.\n\nPayment follows acceptance.");
});

test("unreadable encodings and binary text cannot become source", async () => {
  await assert.rejects(extractAgreement(new File([new Uint8Array([0xff, 0xfe, 0x41])], "terms.txt")), /not UTF-8/);
  await assert.rejects(extractAgreement(new File(["Terms\0hidden"], "terms.md")), /not a readable text/);
  await assert.rejects(extractAgreement(new File([" \n "], "terms.txt")), /no readable/);
});

test("oversize and unsupported input is refused before reading bytes", async () => {
  let read = false;
  const file = { name: "terms.pdf", size: MAX_AGREEMENT_BYTES + 1, arrayBuffer() { read = true; throw Error("read"); } };
  await assert.rejects(extractAgreement(file), /12 MB/);
  assert.equal(read, false);
  await assert.rejects(extractAgreement({ ...file, name: "terms.doc", size: 1 }), /PDF, Word DOCX, TXT or Markdown/);
  assert.equal(read, false);
});

test("cancelled extraction does not read the file", async () => {
  const controller = new AbortController(); controller.abort();
  let read = false;
  await assert.rejects(extractAgreement({ name: "terms.txt", size: 1, arrayBuffer() { read = true; } }, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(read, false);
});

test("PDF fragments preserve split words, word gaps and paragraph lines", () => {
  const item = (str, x, y, width, hasEOL = false) => ({ str, width, hasEOL, transform: [12,0,0,12,x,y] });
  assert.equal(pageText([
    item("Pay", 0, 100, 18), item("ment", 18, 100, 24), item("follows", 48, 100, 42, true),
    item("acceptance.", 0, 80, 66)
  ]), "Payment follows\nacceptance.");
});
