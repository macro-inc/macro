// Phase 0 spike for the GraphQL normalized cache
// (js/app/docs/graphql-normalized-cache-plan.md).
//
// Fetches real pages from the DSS soup GraphQL endpoint and reports the
// numbers needed to size the cache tiers:
//   - raw payload bytes per page
//   - entity counts per __typename / entity type
//   - estimated normalized record counts + per-record "own" sizes
//     (nested keyable objects replaced by refs, like the cache would store)
//   - cross-page dedupe ratio (how much normalization actually saves)
//   - extrapolations to 10k / 50k / 100k records
//
// Usage:
//   ACCESS_TOKEN=... bun scripts/measure-soup-payloads.ts
//   REFRESH_TOKEN=... bun scripts/measure-soup-payloads.ts   # mints a token
//
// Env:
//   DSS_HOST            default https://cloud-storage-dev.macro.com
//   FUSIONAUTH_DOMAIN   default https://fusionauth-dev.macro.com
//   PAGES               default 5
//   LIMIT               page size, default 100 (server max 500)
//   SORT                default UPDATED_AT
//   OUT                 optional path to write full JSON report

import { readFileSync } from "node:fs";
import { join } from "node:path";

const DSS_HOST = process.env.DSS_HOST ?? "https://cloud-storage-dev.macro.com";
const FUSIONAUTH_DOMAIN =
  process.env.FUSIONAUTH_DOMAIN ?? "https://fusionauth-dev.macro.com";
const PAGES = Number(process.env.PAGES ?? 5);
const LIMIT = Number(process.env.LIMIT ?? 100);
const SORT = process.env.SORT ?? "UPDATED_AT";

const QUERY = readFileSync(
  join(
    import.meta.dir,
    "../packages/service-clients/service-storage/graphql/soup.graphql"
  ),
  "utf8"
);

async function getAccessToken(): Promise<string> {
  if (process.env.ACCESS_TOKEN) return process.env.ACCESS_TOKEN;
  const refreshToken = process.env.REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error("Set ACCESS_TOKEN or REFRESH_TOKEN");
  }
  const response = await fetch(`${FUSIONAUTH_DOMAIN}/api/jwt/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "garbage", refreshToken }),
  });
  if (!response.ok) {
    throw new Error(
      `token refresh failed: ${response.status} ${await response.text()}`
    );
  }
  const data = (await response.json()) as { token?: string };
  if (!data.token) throw new Error("no token in refresh response");
  return data.token;
}

// ---------------------------------------------------------------------------
// Normalized-record estimation
// ---------------------------------------------------------------------------

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

interface RecordInfo {
  key: string;
  ownBytes: number;
}

/**
 * Heuristic keyability, mirroring what the cache's key config will do:
 *  - `__typename` + string `id`      → `__typename:id`
 *  - string `id` + ≥2 other fields   → `?:id` (typename unknown w/o schema)
 *  - `messageId`                     → `ChannelMessage:messageId`
 * Everything else is an embedded (non-keyable) object stored inline.
 */
export function keyOf(obj: { [k: string]: Json }): string | null {
  const t = obj.__typename;
  if (typeof t === "string" && typeof obj.id === "string") return `${t}:${obj.id}`;
  if (typeof obj.messageId === "string") return `ChannelMessage:${obj.messageId}`;
  if (typeof obj.id === "string" && Object.keys(obj).length >= 3) {
    return `?:${obj.id}`;
  }
  return null;
}

/**
 * Walks a JSON tree, collecting keyable records. Returns the value with
 * keyable children replaced by `{__ref}` markers, so each record's
 * `ownBytes` measures what the cache would actually store for it.
 */
export function extract(value: Json, records: RecordInfo[]): Json {
  if (Array.isArray(value)) return value.map((v) => extract(v, records));
  if (value === null || typeof value !== "object") return value;

  const replacedEntries: [string, Json][] = Object.entries(value).map(
    ([k, v]) => [k, extract(v, records)]
  );
  const replaced = Object.fromEntries(replacedEntries) as { [k: string]: Json };

  const key = keyOf(value);
  if (key === null) return replaced;
  records.push({ key, ownBytes: JSON.stringify(replaced).length });
  return { __ref: key };
}

function percentile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
}

// ---------------------------------------------------------------------------

async function main() {
  const token = await getAccessToken();
  const url = `${DSS_HOST}/items/soup/graphql`;

  const uniqueRecords = new Map<string, number>(); // key → ownBytes (last write)
  let totalRecordOccurrences = 0;
  const pageReports: object[] = [];
  const entityTypeCounts = new Map<string, number>();
  let cursor: string | null = null;

  for (let page = 0; page < PAGES; page++) {
    const body = JSON.stringify({
      query: QUERY,
      variables: {
        input: {
          limit: LIMIT,
          expand: true,
          sortMethod: SORT,
          cursor,
        },
      },
    });
    const t0 = performance.now();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body,
    });
    const text = await res.text();
    const fetchMs = +(performance.now() - t0).toFixed(1);
    if (!res.ok) {
      throw new Error(`page ${page}: ${res.status} ${text.slice(0, 500)}`);
    }
    const json = JSON.parse(text) as {
      data?: { soup: { items: Json[]; nextCursor: string | null; hasMore: boolean } };
      errors?: Json;
    };
    if (json.errors) throw new Error(`graphql errors: ${JSON.stringify(json.errors).slice(0, 500)}`);
    const soup = json.data!.soup;

    for (const item of soup.items as { entityType?: string }[]) {
      const et = item.entityType ?? "UNKNOWN";
      entityTypeCounts.set(et, (entityTypeCounts.get(et) ?? 0) + 1);
    }

    const records: RecordInfo[] = [];
    extract(soup.items as Json, records);
    totalRecordOccurrences += records.length;
    let newRecords = 0;
    for (const r of records) {
      if (!uniqueRecords.has(r.key)) newRecords++;
      uniqueRecords.set(r.key, r.ownBytes);
    }

    pageReports.push({
      page,
      fetchMs,
      rawBytes: text.length,
      items: soup.items.length,
      records: records.length,
      newRecords,
      hasMore: soup.hasMore,
    });
    console.log(
      `page ${page}: ${soup.items.length} items, ${(text.length / 1024).toFixed(1)} KiB raw, ` +
        `${records.length} records (${newRecords} new), fetch ${fetchMs}ms`
    );

    cursor = soup.nextCursor;
    if (!soup.hasMore || !cursor) break;
  }

  const sizes = [...uniqueRecords.values()].sort((a, b) => a - b);
  const totalOwnBytes = sizes.reduce((a, b) => a + b, 0);
  const avg = totalOwnBytes / Math.max(1, sizes.length);

  const summary = {
    endpoint: url,
    sort: SORT,
    pageLimit: LIMIT,
    pagesFetched: pageReports.length,
    itemsByEntityType: Object.fromEntries(entityTypeCounts),
    uniqueRecords: sizes.length,
    recordOccurrences: totalRecordOccurrences,
    dedupeRatio: +(totalRecordOccurrences / Math.max(1, sizes.length)).toFixed(2),
    recordOwnBytes: {
      total: totalOwnBytes,
      avg: Math.round(avg),
      p50: percentile(sizes, 0.5),
      p95: percentile(sizes, 0.95),
      max: sizes[sizes.length - 1] ?? 0,
    },
    extrapolatedDiskBytes: {
      // raw record bytes only; storage overhead (indexes, links, metadata)
      // typically adds 1.5–2x on top.
      at10k: Math.round(avg * 10_000),
      at50k: Math.round(avg * 50_000),
      at100k: Math.round(avg * 100_000),
    },
  };

  console.log("\n=== summary ===");
  console.log(JSON.stringify(summary, null, 2));

  if (process.env.OUT) {
    await Bun.write(
      process.env.OUT,
      JSON.stringify({ summary, pages: pageReports }, null, 2)
    );
    console.log(`\nfull report written to ${process.env.OUT}`);
  }
}

if (import.meta.main) {
  await main();
}
