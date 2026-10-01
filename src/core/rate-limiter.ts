/**
 * Token Bucket Rate Limiter
 * Implements the standard leaky token-bucket algorithm for controlling LLM API throughput
 * and preventing runaway token usage or DoS attacks.
 */
export class TokenBucketRateLimiter {
  private capacity: number;
  private tokens: number;
  private refillRatePerSecond: number;
  private lastRefillTimestamp: number;

  constructor(capacity: number = 60, refillRatePerSecond: number = 10) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillRatePerSecond = refillRatePerSecond;
    this.lastRefillTimestamp = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefillTimestamp) / 1000;
    const tokensToAdd = elapsedSeconds * this.refillRatePerSecond;

    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefillTimestamp = now;
  }

  /**
   * Attempts to consume the specified number of tokens.
   * Returns true if allowed, false if rate limited.
   */
  public tryConsume(tokensRequested: number = 1): boolean {
    this.refill();
    if (this.tokens >= tokensRequested) {
      this.tokens -= tokensRequested;
      return true;
    }
    return false;
  }

  public getAvailableTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  public reset(): void {
    this.tokens = this.capacity;
    this.lastRefillTimestamp = Date.now();
  }
}

/**
 * Prompt Guardrail Validator
 * Detects common malicious patterns like prompt injections, jailbreaks, and system override attempts.
 */
export class PromptGuardrail {
  private static readonly INJECTION_PATTERNS = [
    /ignore all previous instructions/i,
    /disregard above instructions/i,
    /you are now in developer mode/i,
    /jailbreak mode enabled/i,
    /drop database/i,
    /<script.*?>.*?<\/script>/i,
  ];

  public static sanitizeAndValidate(prompt: string): {
    isValid: boolean;
    sanitized: string;
    flaggedReasons: string[];
  } {
    const flaggedReasons: string[] = [];

    for (const pattern of this.INJECTION_PATTERNS) {
      if (pattern.test(prompt)) {
        flaggedReasons.push(`Pattern detected: ${pattern.toString()}`);
      }
    }

    // Strip out potential dangerous script tags
    const sanitized = prompt.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");

    return {
      isValid: flaggedReasons.length === 0,
      sanitized,
      flaggedReasons,
    };
  }
}
