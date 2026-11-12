import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModelLookupJournal } from "../model-lookup-journal.mjs";

const request = () => ({ id: "pact-source-" + "a".repeat(64),
  requestSha256: "b".repeat(64), projectId: "source-agreement",
  route: "https://model.example/app/api", deadlineUnixMs: Date.now() + 120000, timeoutSeconds: 119 });
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "pact-model-lookup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("concurrent source lookups reserve one durable dispatch and restart observes its original deadline", async t => {
  const root = await fixture(t), directory = join(root, "lookups"), item = request();
  const journals = Array.from({ length: 12 }, () => createModelLookupJournal(directory));
  const results = await Promise.all(journals.map(journal => journal.reserve(item)));
  assert.equal(results.filter(result => result.created).length, 1);
  const first = results.find(result => result.created).record;
  for (const result of results) assert.deepEqual(result.record, first);
  const restored = await createModelLookupJournal(directory).reserve({ ...item, deadlineUnixMs: item.deadlineUnixMs + 120000, timeoutSeconds: 118 });
  assert.equal(restored.created, false);
  assert.deepEqual(restored.record, first);
  assert.deepEqual(await readdir(directory), [item.id + ".json"]);
  const path = join(directory, item.id + ".json");
  if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), first);
});

test("an existing lookup cannot be reused for another payload, project or model route", async t => {
  const directory = await fixture(t), journal = createModelLookupJournal(directory), item = request();
  await journal.reserve(item);
  for (const changed of [{ requestSha256: "c".repeat(64) }, { projectId: "another-agreement" }, { route: "https://another.example/app/api" }])
    await assert.rejects(journal.reserve({ ...item, ...changed }), { code: "AI_LOOKUP_CONFLICT" });
  assert.equal((await journal.load(item.id)).requestSha256, item.requestSha256);
});

test("damaged or credential-bearing lookup state refuses a fresh reservation", async t => {
  const directory = await fixture(t), journal = createModelLookupJournal(directory), item = request();
  const { record } = await journal.reserve(item), path = join(directory, item.id + ".json");
  for (const text of ['{"schema":', JSON.stringify({ ...record, sessionCookie: "must-not-be-persisted" }), "x".repeat(4097)]) {
    await writeFile(path, text);
    await assert.rejects(journal.reserve(item), { code: "AI_LOOKUP_STORE_INVALID" });
    assert.equal(await readFile(path, "utf8"), text);
  }
});
