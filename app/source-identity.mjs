// Adapted from CHRONOS 17ea44c3bc962bc94d93e2b85499803de0e7721c; file-domain wording and empty-file support.
/** Exact source-byte identity without a whole-large-file buffer. */
export const SOURCE_HASH_FAST_BYTES = 8 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;

function abortError() {
  return new DOMException('Source byte checking was cancelled.', 'AbortError');
}

/**
 * Existing callers may continue to pass (blob, crypto). Progress reports read
 * bytes, never a verified identity; only this promise's result is admissible.
 * Small Web Crypto operations cannot be interrupted internally, but cancellation
 * rejects immediately and their later completion cannot publish an identity.
 */
export async function identifySource(blob, crypto = globalThis.crypto, {signal, onProgress} = {}) {
  if (!blob || !Number.isSafeInteger(blob.size) || blob.size < 0) throw Error('Choose a local file with an exact byte count.');
  if (signal?.aborted) throw abortError();
  const size = blob.size;

  return new Promise((resolve, reject) => {
    let worker = null, settled = false, lastProgress = -1;
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
      if (worker) {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        worker.removeEventListener('messageerror', onMessageError);
        worker.terminate();
        worker = null;
      }
    };
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error); else resolve(result);
    };
    const onAbort = () => finish(abortError());
    const progress = ({bytesRead, totalBytes}) => {
      if (settled) return;
      if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead < lastProgress || bytesRead > size || totalBytes !== size) {
        throw Error('Invalid source byte-check progress.');
      }
      if (bytesRead === lastProgress) return;
      lastProgress = bytesRead;
      onProgress?.({bytesRead, totalBytes});
    };
    const complete = result => {
      if (settled) return;
      if (signal?.aborted) { onAbort(); return; }
      if (typeof result?.sha256 !== 'string' || !SHA256.test(result.sha256) || result.byte_length !== size) {
        finish(Error('The source byte check did not complete.')); return;
      }
      try {
        progress({bytesRead: size, totalBytes: size});
        if (signal?.aborted) { onAbort(); return; }
        finish(null, {sha256: result.sha256, byte_length: size});
      } catch (error) { finish(error); }
    };
    const onMessage = ({data}) => {
      if (settled) return;
      try {
        if (data?.type === 'progress') progress(data);
        else if (data?.type === 'complete') complete(data);
        else if (data?.type === 'error') {
          const error = Error(data.message || 'The source file could not be checked.');
          error.name = data.name || 'Error';
          finish(error);
        } else finish(Error('Invalid response from the source byte check.'));
      } catch (error) { finish(error); }
    };
    const onError = () => finish(Error('Source byte checking could not run. Choose the file again to retry.'));
    const onMessageError = () => finish(Error('The source byte-check response could not be read.'));
    signal?.addEventListener('abort', onAbort, {once: true});

    try {
      progress({bytesRead: 0, totalBytes: size});
      if (signal?.aborted) { onAbort(); return; }
      if (size <= SOURCE_HASH_FAST_BYTES && crypto?.subtle) {
        (async () => {
          const bytes = await blob.arrayBuffer();
          if (signal?.aborted) throw abortError();
          if (bytes.byteLength !== size) throw Error('The source file could not be read completely.');
          const hash = await crypto.subtle.digest('SHA-256', bytes);
          if (signal?.aborted) throw abortError();
          return {sha256: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join(''), byte_length: size};
        })().then(complete, error => finish(error));
      } else if (typeof globalThis.Worker === 'function') {
        worker = new Worker(new URL('./source-hash-worker.mjs', import.meta.url), {type: 'module'});
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
        worker.addEventListener('messageerror', onMessageError);
        worker.postMessage({blob});
      } else {
        // Node and browsers without Worker still use bounded reads and yield.
        import('./source-hash.mjs').then(({hashSourceChunks}) => {
          if (signal?.aborted) throw abortError();
          return hashSourceChunks(blob, {signal, onProgress: progress});
        }).then(complete, error => finish(error));
      }
    } catch (error) { finish(error); }
  });
}
