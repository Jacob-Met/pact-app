import { sourceFileTextChanges } from "./source-file-diff.mjs";
self.onmessage = ({data}) => {
  try {
    if(typeof data.before!=="string" || typeof data.after!=="string" || data.before.length>100000 || data.after.length>100000)throw Error("Source wording is too large to compare.");
    self.postMessage({parts:sourceFileTextChanges(data.before,data.after)});
  } catch(error) { self.postMessage({error:error.message}); }
};
