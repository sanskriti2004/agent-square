import { XMLParser } from "fast-xml-parser";
import { splitPublisher } from "./vocab";

export type NewsItem = {
  url: string;
  title: string;
  publisher: string | null;
  publishedAt: string | null;
};

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });

export function googleNewsUrl(query: string) {
  const q = encodeURIComponent(`${query} when:2d`);
  return `https://news.google.com/rss/search?q=${q}&hl=en-IN&gl=IN&ceid=IN:en`;
}

export async function fetchGoogleNews(query: string, limit = 8): Promise<NewsItem[]> {
  const response = await fetch(googleNewsUrl(query), {
    headers: { "user-agent": "AgentSquare/0.1 (+polls every 20-40 min per query)" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Google News RSS ${response.status}`);
  const xml = await response.text();
  const doc = parser.parse(xml) as { rss?: { channel?: { item?: unknown } } };
  const raw = doc.rss?.channel?.item;
  const items = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Record<string, unknown>[];
  return items
    .map((item) => {
      const source = item.source as { "#text"?: string } | string | undefined;
      const sourceName = typeof source === "string" ? source : source?.["#text"];
      const split = splitPublisher(String(item.title ?? ""));
      const pub = item.pubDate ? new Date(String(item.pubDate)) : null;
      return {
        url: String(item.link ?? ""),
        title: split.title,
        publisher: sourceName ?? split.publisher,
        publishedAt: pub && !Number.isNaN(pub.getTime()) ? pub.toISOString() : null,
      };
    })
    .filter((item) => item.url && item.title)
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
    .slice(0, limit);
}
