// The upstream browser bundle expects setImmediate; provide the worker-native equivalent.
globalThis.setImmediate ??= callback => setTimeout(callback, 0);
self.onmessage = async ({ data }) => {
  try {
    const { extractWordText } = await import("./agreement-word-text.mjs");
    self.postMessage({ text: await extractWordText(data) });
  } catch (error) {
    self.postMessage({ error: error?.message || "This Word file could not be read." });
  }
};
