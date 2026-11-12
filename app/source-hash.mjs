// Reused from Jacob-Met/chronos-vision at 17ea44c3bc962bc94d93e2b85499803de0e7721c.
// PACT also identifies zero-byte files; all nonempty input uses the same bounded-read path.
/** Bounded input buffers for SHA-256; the original Blob remains the source. */
import {sha256} from './vendor/noble-hashes/sha2.js';

export const SOURCE_HASH_CHUNK_BYTES = 1024 * 1024;

function checkAbort(signal) {
  if (signal?.aborted) throw new DOMException('Source byte checking was cancelled.', 'AbortError');
}

/**
 * Read one fixed-size slice at a time. The macrotask yield also keeps the
 * no-Worker fallback responsive; resolving a Promise alone would not do so.
 * Browser File read failures propagate and can never produce a partial hash.
 */
export async function hashSourceChunks(blob, {signal, onProgress} = {}) {
  if (!blob || !Number.isSafeInteger(blob.size) || blob.size < 0) throw Error('Choose a local file with an exact byte count.');
  checkAbort(signal);
  const size = blob.size;
  const hash = sha256.create();
  try {
    onProgress?.({bytesRead: 0, totalBytes: size});
    for (let offset = 0; offset < size;) {
      checkAbort(signal);
      const end = Math.min(offset + SOURCE_HASH_CHUNK_BYTES, size);
      // Keep this buffer inside the loop body so it is not retained across
      // reads, and never concatenate source chunks or reopen a file by path.
      {
        const bytes = new Uint8Array(await blob.slice(offset, end).arrayBuffer());
        checkAbort(signal);
        if (bytes.byteLength !== end - offset) throw Error('The source file could not be read completely.');
        hash.update(bytes);
      }
      offset = end;
      if (offset < size) {
        onProgress?.({bytesRead: offset, totalBytes: size});
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    checkAbort(signal);
    const digest = hash.digest();
    const result = {sha256: Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join(''), byte_length: size};
    onProgress?.({bytesRead: size, totalBytes: size});
    checkAbort(signal);
    return result;
  } finally {
    hash.destroy();
  }
}
