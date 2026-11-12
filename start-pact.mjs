// Run from an extracted PACT package with Node.js 20 or newer.
const major = Number(process.versions.node.split(".")[0]);
if (major < 20) {
  console.error("PACT needs Node.js 20 or newer. Install Node.js, then run node start-pact.mjs again.");
  process.exit(1);
}
const port = Number(process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("PORT must be a whole number from 1 to 65535.");
  process.exit(1);
}
const { createPactServer } = await import("./server.mjs");
const { createPactProviders } = await import("./providers.mjs");
const { createOrderJournal } = await import("./order-journal.mjs");
const { fileURLToPath } = await import("node:url");
const journalPath = process.env.PACT_ORDER_JOURNAL ||
  fileURLToPath(new URL(".pact-local/sandbox-orders.json", import.meta.url));
const { createSharedReviewCoordinator } = await import("./shared-review-server.mjs");
const reviewPort=Number(process.env.PACT_REVIEW_PORT||4174);
if(!Number.isInteger(reviewPort)||reviewPort<1||reviewPort>65535||reviewPort===port)throw Error("PACT_REVIEW_PORT must be a distinct valid port.");
const shared = await createSharedReviewCoordinator({organizerCode:process.env.PACT_ORGANIZER_CODE||null,organizerPort:port,externalOrigin:process.env.PACT_REVIEW_ORIGIN||null,preferredPort:reviewPort,path:process.env.PACT_SHARED_JOURNAL || fileURLToPath(new URL(".pact-local/shared-agreements.json",import.meta.url))});
const demoMode = process.argv.includes("--demo") || process.env.PACT_DEMO === "1";
const simulated = demoMode ? (await import("./demo-mode.mjs")).demoSetup({ port }) : null;
const server = createPactServer({ shared, demo: simulated?.demo, providers: createPactProviders(simulated ? simulated.providerOptions : {
  journal: createOrderJournal(journalPath)
}) });
server.once("close", () => { void shared.shutdown(); });
server.on("error", error => {
  console.error(error.code === "EADDRINUSE"
    ? `Port ${port} is in use. Close the other PACT process or choose another PORT.`
    : "PACT could not start: " + error.message);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => {
  console.log(`PACT experimental workbench: http://127.0.0.1:${port}`);
  console.log("Open that address in your browser. Press Ctrl+C here to stop.");
  console.log("Local evidence decisions are not authenticated consent. Optional payments use PayPal Sandbox only.");
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close());
