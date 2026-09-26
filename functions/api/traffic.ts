/**
 * Cloudflare Pages Function: GET /api/traffic
 *
 * MnDOT's freeway sensor readings (every 30 s), unzipped and trimmed to
 * speed and flow per station.
 */
import { parseSample } from "../../src/traffic/traffic.ts";

const URL = "https://data.dot.state.mn.us/iris_xml/stat_sample.xml.gz";
const TTL_S = 30;

export async function gunzipText(bytes: ArrayBuffer): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

export const onRequestGet = async (): Promise<Response> => {
  try {
    const res = await fetch(URL, {
      headers: { "user-agent": "minneapolis-from-above (+https://minneapolis-from-above.pages.dev)" },
      cf: { cacheTtl: TTL_S, cacheEverything: true },
    } as RequestInit);
    if (!res.ok) return json({ error: `MnDOT's traffic feed returned ${res.status}.` }, 502);
    return json(parseSample(await gunzipText(await res.arrayBuffer())), 200, `public, max-age=${TTL_S}`);
  } catch {
    return json({ error: "MnDOT's traffic feed is unreachable." }, 502);
  }
};

function json(body: unknown, status: number, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache },
  });
}
