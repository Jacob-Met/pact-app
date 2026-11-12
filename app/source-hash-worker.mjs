import {hashSourceChunks} from './source-hash.mjs';

// One worker owns one immutable Blob and is terminated by its caller on every
// terminal path. Raw source bytes never leave the worker or enter saved JSON.
self.addEventListener('message', async ({data}) => {
  try {
    let lastProgressAt = -Infinity;
    const result = await hashSourceChunks(data.blob, {
      onProgress: progress => {
        const now = performance.now();
        if (progress.bytesRead === 0 || progress.bytesRead === progress.totalBytes || now - lastProgressAt >= 50) {
          self.postMessage({type: 'progress', ...progress});
          lastProgressAt = now;
        }
      },
    });
    self.postMessage({type: 'complete', ...result});
  } catch (error) {
    self.postMessage({type: 'error', name: error?.name || 'Error',
      message: error?.message || 'The source file could not be checked.'});
  }
}, {once: true});
