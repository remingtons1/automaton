/**
 * Inference Cost Tracker
 *
 * Calculates the cost of inference calls based on model and token usage.
 * Pricing is in cents per 1M tokens (input/output).
 */

// Pricing table: cents per 1M tokens [input, output]
const MODEL_PRICING: Record<string, [number, number]> = {
  // OpenAI
  "gpt-4o": [250, 1000],
  "gpt-4o-mini": [15, 60],
  "gpt-4-turbo": [1000, 3000],
  "gpt-4": [3000, 6000],
  "gpt-3.5-turbo": [50, 150],
  "gpt-5": [250, 1000],
  "gpt-5-mini": [15, 60],
  "gpt-5.2": [250, 1000],
  // Anthropic
  "claude-sonnet-4-6": [300, 1500],
  "claude-opus-4-6": [1500, 7500],
  "claude-haiku-4-5": [80, 400],
  "claude-3-5-sonnet": [300, 1500],
  "claude-3-5-haiku": [80, 400],
  "claude-3-opus": [1500, 7500],
  // Defaults for unknown models
  "default": [300, 1200],
};

/**
 * Calculate the cost of an inference call in cents.
 */
export function calculateInferenceCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  // Find pricing — try exact match, then prefix match, then default
  let pricing = MODEL_PRICING[model];
  if (!pricing) {
    // Try prefix match (e.g., "gpt-4o-2024-01-01" matches "gpt-4o")
    for (const [key, value] of Object.entries(MODEL_PRICING)) {
      if (key !== "default" && model.startsWith(key)) {
        pricing = value;
        break;
      }
    }
  }
  if (!pricing) pricing = MODEL_PRICING["default"];

  const [inputPer1M, outputPer1M] = pricing;
  const inputCost = (inputTokens / 1_000_000) * inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * outputPer1M;

  // Round up to nearest cent (minimum 1¢ per call)
  return Math.max(1, Math.ceil(inputCost + outputCost));
}
