import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fingerprintFile, compareFileFingerprint } from "../app/evidence-file.mjs";
import { hashSourceChunks, SOURCE_HASH_CHUNK_BYTES } from "../app/source-hash.mjs";

const nativeHash = bytes => createHash("sha256").update(bytes).digest("hex");

test("complete file larger than the former cap matches native SHA-256, including its final partial chunk", async () => {
  const bytes = Buffer.alloc(26 * 1024 * 1024 + 137);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + (i >>> 12)) & 255;
  const progress = [];
  const result = await fingerprintFile(new File([bytes], "studio-master.wav"), {onProgress: value => progress.push(value)});
  assert.equal(result.sha256, nativeHash(bytes));
  assert.equal(result.bytes, bytes.length);
  assert.equal(progress.at(-1).bytesRead, bytes.length);
  assert.ok(progress.length > 2);
  assert.ok(progress.every((p, i) => p.totalBytes === bytes.length && (!i || p.bytesRead > progress[i - 1].bytesRead)));
  const changed = Buffer.from(bytes); changed[Math.floor(changed.length / 2)] ^= 1;
  const altered = await fingerprintFile(new File([changed], "studio-master.wav"));
  assert.equal(altered.sha256, nativeHash(changed));
  assert.equal(compareFileFingerprint(result, altered), false);
});

test("bounded reads include every byte and never request a whole large-file buffer", async () => {
  const bytes = Buffer.alloc(SOURCE_HASH_CHUNK_BYTES * 2 + 53, 0xa7);
  const slices = [];
  const source = {
    size: bytes.length,
    arrayBuffer() { throw new Error("Whole file read is forbidden in this course"); },
    slice(start, end) {
      slices.push([start, end]);
      return {async arrayBuffer() { const part = bytes.subarray(start, end); return part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength); }};
    }
  };
  const result = await hashSourceChunks(source);
  assert.equal(result.sha256, nativeHash(bytes));
  assert.equal(result.byte_length, bytes.length);
  assert.deepEqual(slices, [[0, SOURCE_HASH_CHUNK_BYTES], [SOURCE_HASH_CHUNK_BYTES, SOURCE_HASH_CHUNK_BYTES * 2], [SOURCE_HASH_CHUNK_BYTES * 2, bytes.length]]);
});

test("cancel after a real first chunk stops before the next read and cannot return a fingerprint", async () => {
  const controller = new AbortController();
  const blob = new Blob([Buffer.alloc(SOURCE_HASH_CHUNK_BYTES * 3, 9)]);
  let reads = 0;
  const source = {size: blob.size, slice(start, end) { reads++; return blob.slice(start, end); }};
  await assert.rejects(hashSourceChunks(source, {
    signal: controller.signal,
    onProgress({bytesRead}) { if (bytesRead > 0) controller.abort(); }
  }), {name: "AbortError"});
  assert.equal(reads, 1);
});

test("a file becoming unreadable partway through does not yield a partial fingerprint", async () => {
  let reads = 0;
  const source = {size: SOURCE_HASH_CHUNK_BYTES * 2, slice() {
    reads++;
    return {async arrayBuffer() {
      if (reads === 2) throw new DOMException("File is no longer readable", "NotReadableError");
      return new Uint8Array(SOURCE_HASH_CHUNK_BYTES).buffer;
    }};
  }};
  await assert.rejects(hashSourceChunks(source), {name: "NotReadableError"});
  assert.equal(reads, 2);
});

test("an empty local file remains identifiable by the standard empty SHA-256", async () => {
  const result = await fingerprintFile(new File([], "empty.txt"));
  assert.equal(result.bytes, 0);
  assert.equal(result.sha256, nativeHash(Buffer.alloc(0)));
  assert.deepEqual(await hashSourceChunks(new Blob([])), {sha256: result.sha256, byte_length: 0});
});

test('source identity uses bounded SHA-256 without Web Crypto and respects cancellation', async () => {
  const {identifySource} = await import('../app/source-identity.mjs');
  const actual = await identifySource(new Blob(['abc']), null);
  assert.deepEqual(actual, {sha256:'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', byte_length:3});
  const empty = await identifySource(new Blob([]), null);
  assert.equal(empty.sha256, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  const controller = new AbortController();
  await assert.rejects(identifySource(new Blob(['abc']), null, {
    signal:controller.signal, onProgress:()=>controller.abort()
  }), error => error.name === 'AbortError');
});
