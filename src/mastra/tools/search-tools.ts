import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const SEARCH_API_URL = 'https://google.serper.dev/search';

function getSerperApiKey(): string | undefined {
  if (typeof process === 'undefined') return undefined;
  return process.env.SERPER_API_KEY?.trim() || undefined;
}

/**
 * Internet search tool (Serper/Google). Set SERPER_API_KEY in .env.
 * When key is missing, returns a placeholder so the workflow still runs.
 */
export const internetSearchTool = createTool({
  id: 'internet-search',
  description:
    'Search the web for current information. Use for market data, company info, news, or validating claims. Prefer specific queries.',
  inputSchema: z.object({
    query: z.string().min(1).max(300).describe('Search query'),
    numResults: z.number().min(1).max(10).optional().default(5),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    query: z.string(),
    results: z.array(
      z.object({
        title: z.string(),
        link: z.string(),
        snippet: z.string(),
      })
    ),
    error: z.string().optional(),
  }),
  execute: async ({ query, numResults }) => {
    const apiKey = getSerperApiKey();
    if (!apiKey) {
      return {
        success: false,
        query,
        results: [],
        error: 'SERPER_API_KEY not set. Add it to .env for live web search.',
      };
    }
    try {
      const res = await fetch(SEARCH_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': apiKey,
        },
        body: JSON.stringify({ q: query, num: numResults }),
      });
      if (!res.ok) {
        const err = await res.text();
        return { success: false, query, results: [], error: err || res.statusText };
      }
      const data = (await res.json()) as {
        organic?: Array< { title?: string; link?: string; snippet?: string }>;
      };
      const organic = data.organic ?? [];
      return {
        success: true,
        query,
        results: organic.slice(0, numResults).map((o) => ({
          title: o.title ?? '',
          link: o.link ?? '',
          snippet: o.snippet ?? '',
        })),
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { success: false, query, results: [], error: message };
    }
  },
});

/**
 * Deep research tool: run multiple searches and return reasoning + synthesized findings.
 * Agents should use this when they need to reason over multiple angles and cite sources.
 */
export const deepResearchTool = createTool({
  id: 'deep-research',
  description:
    'Perform multi-query research with reasoning. Use when you need to validate hypotheses, compare sources, or synthesize evidence. Provide 1–3 sub-queries and your reasoning steps; returns search results per query plus a synthesis prompt.',
  inputSchema: z.object({
    reasoning: z.string().describe('Brief reasoning: what you are trying to verify or find'),
    queries: z
      .array(z.string().min(1).max(200))
      .min(1)
      .max(5)
      .describe('1–5 search queries to run (e.g. different angles or keywords)'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    reasoning: z.string(),
    findings: z.array(
      z.object({
        query: z.string(),
        results: z.array(
          z.object({
            title: z.string(),
            link: z.string(),
            snippet: z.string(),
          })
        ),
      })
    ),
    synthesisHint: z.string().describe('Short hint for synthesizing the findings'),
    error: z.string().optional(),
  }),
  execute: async ({ reasoning, queries }) => {
    const numPerQuery = 3;
    const results: { query: string; results: Array<{ title: string; link: string; snippet: string }> }[] = [];

    const apiKey = getSerperApiKey();
    if (!apiKey) {
      return {
        success: false,
        reasoning,
        findings: [],
        synthesisHint: 'Add SERPER_API_KEY to .env for live deep research.',
        error: 'SERPER_API_KEY not set.',
      };
    }

    for (const query of queries) {
      try {
        const res = await fetch(SEARCH_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
          body: JSON.stringify({ q: query, num: numPerQuery }),
        });
        const data = res.ok
          ? ((await res.json()) as { organic?: Array<{ title?: string; link?: string; snippet?: string }> })
          : { organic: [] };
        const organic = data.organic ?? [];
        results.push({
          query,
          results: organic.slice(0, numPerQuery).map((o) => ({
            title: o.title ?? '',
            link: o.link ?? '',
            snippet: o.snippet ?? '',
          })),
        });
      } catch {
        results.push({ query, results: [] });
      }
    }

    return {
      success: true,
      reasoning,
      findings: results,
      synthesisHint: `Synthesize the above findings with respect to: ${reasoning}. Cite sources; note conflicts or gaps.`,
    };
  },
});
