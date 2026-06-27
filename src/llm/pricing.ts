/**
 * Per-model base input pricing from OpenRouter, used to compute cache cost
 * savings WITHOUT hardcoding provider-specific cache multipliers (Anthropic
 * charges 1.25x for cache writes, Gemini 0.3x, OpenAI has no write premium,
 * etc.). We only need the base $/prompt-token rate; the actual discounted cost
 * from the API already encodes each model's own read/write economics.
 *
 * The model list is fetched once and cached for the process lifetime (prices
 * change rarely, and a stale rate only nudges a derived savings estimate).
 */

let cache: Map<string, number> | undefined
let inflight: Promise<Map<string, number>> | undefined

async function loadPricing(apiKey: string): Promise<Map<string, number>> {
  const res = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) {
    throw new Error(`OpenRouter models API error: ${res.status}`)
  }
  const data = (await res.json()) as {
    data: { id: string; pricing?: { prompt?: string } }[]
  }
  const map = new Map<string, number>()
  for (const m of data.data) {
    const price = m.pricing?.prompt != null ? Number(m.pricing.prompt) : NaN
    if (Number.isFinite(price)) {
      map.set(m.id, price)
    }
  }
  return map
}

/**
 * Base price ($ per prompt token) for a model, or undefined if it can't be
 * determined (unknown model, or the models API was unreachable). Never throws.
 */
export async function getPromptTokenPrice(
  model: string,
  apiKey: string,
): Promise<number | undefined> {
  try {
    if (!cache) {
      inflight ??= loadPricing(apiKey).then((m) => (cache = m))
      await inflight
    }
    return cache?.get(model)
  } catch {
    inflight = undefined // let a later call retry the fetch
    return undefined
  }
}
