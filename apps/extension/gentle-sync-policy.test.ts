import test from "node:test";
import assert from "node:assert/strict";

import {
  GENTLE_SYNC_RATE_LIMIT_BACKOFF_MINUTES,
  GENTLE_SYNC_STEP_DELAY_MINUTES,
  isRateLimitSignal,
  packageHitRateLimit
} from "./gentle-sync-policy.ts";

test("gentle sync policy spaces background steps conservatively", () => {
  assert.ok(GENTLE_SYNC_STEP_DELAY_MINUTES >= 2);
  assert.ok(GENTLE_SYNC_RATE_LIMIT_BACKOFF_MINUTES >= 30);
});

test("rate limit detection catches backend errors and rendered warning pages", () => {
  assert.equal(isRateLimitSignal("429 Too Many Requests"), true);
  assert.equal(isRateLimitSignal("normal response"), false);
  assert.equal(
    packageHitRateLimit({
      capture: {
        backendApiError: "ChatGPT backend API returned 429"
      }
    }),
    true
  );
  assert.equal(
    packageHitRateLimit({
      messages: [
        {
          role: "message",
          text: "Too many requests"
        }
      ]
    }),
    true
  );
});
