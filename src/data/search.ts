/**
 * Web search provider abstraction.
 * Allows swapping search backends (Brave, SerpAPI, etc.).
 */

/**
 * A single search result.
 */
export interface SearchResult {
  title: string
  url: string
  snippet: string
}

/**
 * Interface for search providers.
 */
export interface SearchProvider {
  /**
   * Search the web and return results.
   */
  search(query: string): Promise<SearchResult[]>
}

/**
 * Brave Search API response types.
 */
interface BraveWebResult {
  title: string
  url: string
  description: string
}

interface BraveSearchResponse {
  web?: {
    results?: BraveWebResult[]
  }
}

/**
 * Brave Search provider implementation.
 * Uses the Brave Search API (2,000 free queries/month).
 */
export class BraveSearchProvider implements SearchProvider {
  private apiKey: string
  private baseUrl = "https://api.search.brave.com/res/v1/web/search"

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async search(query: string): Promise<SearchResult[]> {
    const url = new URL(this.baseUrl)
    url.searchParams.set("q", query)
    url.searchParams.set("count", "10")

    const response = await fetch(url.toString(), {
      headers: {
        "X-Subscription-Token": this.apiKey,
        Accept: "application/json",
      },
    })

    if (!response.ok) {
      throw new Error(`Brave Search API error: ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as BraveSearchResponse
    const results = data.web?.results || []

    return results.map((result) => ({
      title: result.title,
      url: result.url,
      snippet: result.description,
    }))
  }
}

/**
 * Creates a search provider based on environment configuration.
 * Returns null if no API key is configured.
 */
export function createSearchProvider(): SearchProvider | null {
  const braveKey = process.env.BRAVE_SEARCH_API_KEY

  if (braveKey) {
    return new BraveSearchProvider(braveKey)
  }

  return null
}

/**
 * Singleton search provider instance.
 * Lazily initialized on first access.
 */
let _searchProvider: SearchProvider | null | undefined

export function getSearchProvider(): SearchProvider | null {
  if (_searchProvider === undefined) {
    _searchProvider = createSearchProvider()
  }
  return _searchProvider
}
