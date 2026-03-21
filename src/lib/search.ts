// Tavily web search — used exclusively by Eva (Evidence Retrieval Agent).
// Called before Eva's LLM turn to ground her context in real sources.

export interface SearchResult {
  title:   string;
  url:     string;
  content: string; // snippet / summary from Tavily
  score:   number; // relevance score 0–1
}

interface TavilyResponse {
  results: Array<{
    title:   string;
    url:     string;
    content: string;
    score:   number;
  }>;
}

// Builds a focused search query from the research topic and the last
// few messages — so Eva searches for what the conversation actually needs,
// not just the raw problem statement.
export function buildSearchQuery(topic: string, recentContext: string): string {
  // Keep it tight — Tavily works best with 5–15 word queries
  const contextSnippet = recentContext
    .replace(/\[.*?\]/g, "")   // strip role labels
    .replace(/\n+/g, " ")
    .trim()
    .slice(0, 200);

  // If context is rich, blend topic + context; otherwise just use topic
  if (contextSnippet.length > 40) {
    return `${topic} ${contextSnippet}`.slice(0, 300);
  }
  return topic;
}

export async function searchWeb(query: string): Promise<SearchResult[]> {
  const key = process.env.TAVILY_API_KEY;

  if (!key || key === "your_tavily_key_here") {
    console.warn("[AGORA] TAVILY_API_KEY not set — Eva will proceed without search results");
    return [];
  }

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key:      key,
        query,
        search_depth: "advanced",
        max_results:  5,
        include_answer: false,
        include_raw_content: false,
      }),
    });

    if (!res.ok) {
      console.error(`[AGORA] Tavily error: ${res.status} ${res.statusText}`);
      return [];
    }

    const data: TavilyResponse = await res.json();

    return (data.results ?? []).map((r) => ({
      title:   r.title,
      url:     r.url,
      content: r.content,
      score:   r.score,
    }));
  } catch (err) {
    console.error("[AGORA] Tavily fetch failed:", err);
    return [];
  }
}

// Formats search results into a block for injection into Eva's context.
export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return "SEARCH RESULTS: No results returned. Proceed based on existing knowledge and flag any gaps.";
  }

  const lines = results.map((r, i) =>
    `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.content.slice(0, 300).replace(/\n/g, " ")}`
  );

  return `SEARCH RESULTS (${results.length} sources, relevance-ranked):\n\n${lines.join("\n\n")}`;
}
