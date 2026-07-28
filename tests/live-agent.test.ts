import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { runClaudeAgent } from "../server/agent.js";

const requested = process.env.RUN_LIVE_AGENT_TESTS === "1";
const enabled = requested && Boolean(process.env.ANTHROPIC_API_KEY);

if (requested && !process.env.ANTHROPIC_API_KEY) {
  test("live test preflight requires an Anthropic API key", () => {
    assert.fail("ANTHROPIC_API_KEY is required for npm run test:live");
  });
}

test("live Claude agent uses grounded tools and returns the exact challenge answer", {
  skip:enabled ? false : "Set ANTHROPIC_API_KEY and run npm run test:live"
}, async () => {
  const response = await runClaudeAgent(
    "What is the MIG duty cycle at 200 A on 240 V?",
    randomUUID()
  );
  assert.match(response.answer,/25%/);
  assert.ok(response.citations.some(citation =>
    citation.document === "owner-manual" && citation.page === 19
  ));
  assert.ok(response.artifacts.some(artifact =>
    artifact.type === "duty-cycle" &&
    artifact.process === "MIG" &&
    artifact.voltage === 240 &&
    artifact.ratings.some(rating => rating.amps === 200 && rating.percent === 25)
  ));
});
