// Keep Word conversion off the UI thread and preserve the prior source on every refusal.
export async function wordText(data, { signal } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./agreement-word.worker.mjs", import.meta.url), { type: "module" });
    const finish = (error, value) => {
      clearTimeout(timer); signal?.removeEventListener("abort", abort); worker.terminate();
      error ? reject(error) : resolve(value);
    };
    const abort = () => finish(signal.reason || new DOMException("Import cancelled.", "AbortError"));
    const timer = setTimeout(() => finish(Error("This Word file took too long to read. Export it as a PDF or paste the agreement text.")), 20000);
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data }) => data.error ? finish(Error(data.error)) : finish(null, data.text);
    worker.onerror = () => finish(Error("This Word file could not be read. Export it as a PDF or paste the agreement text."));
    worker.postMessage(data, [data]);
  });
}
