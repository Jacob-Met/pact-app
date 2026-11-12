import test from "node:test";
import assert from "node:assert/strict";
import { formatUsdMinor, formatUtcControl, parseUtcControl } from "../app/ui-utils.mjs";

test("UTC controls preserve their labeled wall time without host-zone conversion", () => {
  assert.equal(parseUtcControl("2026-11-15T12:00:00"), "2026-11-15T12:00:00.000Z");
  assert.equal(parseUtcControl("2026-11-15T12:00"), "2026-11-15T12:00:00.000Z");
  assert.equal(parseUtcControl("2026-11-15T12:00:00.123"), "2026-11-15T12:00:00.123Z");
  assert.equal(formatUtcControl("2026-11-15T12:00:00.123Z"), "2026-11-15T12:00:00.123");
  assert.equal(parseUtcControl("", { optional: true }), null);
  assert.throws(() => parseUtcControl("2026-13-15T12:00:00"));
});

test("USD renderer preserves exact cents through the supported safe-integer maximum", () => {
  assert.equal(formatUsdMinor(0), "$0.00");
  assert.equal(formatUsdMinor(10_001), "$100.01");
  assert.equal(formatUsdMinor(Number.MAX_SAFE_INTEGER), "$90,071,992,547,409.91");
});
