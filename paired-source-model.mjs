// The paired private model transport is not part of this distribution.
// Configure PACT_AI_BASE_URL and PACT_AI_MODEL to use any OpenAI-compatible endpoint instead.
const fail = () => { throw Object.assign(new Error("Only the openai-compatible source model transport is available in this build."), { code: "AI_CONFIG", status: 503 }); };
export function createPairedSourceModel() { return { send: async () => fail() }; }
