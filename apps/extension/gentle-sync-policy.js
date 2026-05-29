export const GENTLE_SYNC_STEP_DELAY_MINUTES = 2;
export const GENTLE_SYNC_RATE_LIMIT_BACKOFF_MINUTES = 30;
export const GENTLE_SYNC_LOAD_SETTLE_MS = 15000;
export const GENTLE_SYNC_TARGET_LIMIT = 12;

export function isRateLimitSignal(value = "") {
  return /429|too many requests|rate limit|rate-limit/i.test(String(value));
}

export function packageHitRateLimit(packageData = {}) {
  if (isRateLimitSignal(packageData?.capture?.backendApiError)) return true;

  return (packageData?.messages || []).some((message) =>
    isRateLimitSignal(`${message.role || ""} ${message.text || ""}`)
  );
}
