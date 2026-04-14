/**
 * Pulls releases from macro-inc/macro matching the vYYYY.M.D.N format
 * and generates a single changelog MDX page using <Update> components.
 *
 * Usage: bun run scripts/generate-changelog.ts
 *
 * Requires: GITHUB_TOKEN env var (or gh CLI auth)
 */

import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "fs";
import { join } from "path";

const REPO = "macro-inc/macro";
const CHANGELOG_DIR = join(import.meta.dirname, "../changelog");
const DOCS_JSON_PATH = join(import.meta.dirname, "../docs.json");
const TAG_PATTERN = /^v\d{4}\.\d{1,2}\.\d{1,2}\.\d+$/;

interface Release {
  tag_name: string;
  name: string | null;
  body: string | null;
  published_at: string;
}

async function fetchAllReleases(): Promise<Release[]> {
  const releases: Release[] = [];
  let page = 1;

  while (true) {
    const url = `https://api.github.com/repos/${REPO}/releases?per_page=100&page=${page}`;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
    };

    const token = process.env.GITHUB_TOKEN;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    }

    const batch: Release[] = await res.json();
    if (batch.length === 0) break;

    releases.push(...batch);
    page++;
  }

  return releases;
}

function escapeForMdx(text: string): string {
  return text.replace(
    /<(?!\/?(?:br|hr|img|a |ul|ol|li|p |h[1-6]|code|pre|em|strong|b |i |table|thead|tbody|tr|td|th|div|span|sup|sub|blockquote|details|summary|dd|dl|dt|del|ins|kbd|mark|s |u |var|wbr|abbr|cite|dfn|q |ruby|rt|rp|samp|small|time|data|meter|progress|output|dialog|slot|template|picture|source|track|video|audio|canvas|map|area|section|nav|article|aside|header|footer|main|figure|figcaption|caption|col|colgroup|fieldset|legend|datalist|optgroup|option|textarea|select|button|label|input|form))/g,
    "\\<"
  );
}

async function main() {
  console.log(`Fetching releases from ${REPO}...`);
  const allReleases = await fetchAllReleases();

  const releases = allReleases
    .filter((r) => TAG_PATTERN.test(r.tag_name))
    .sort(
      (a, b) =>
        new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
    );

  console.log(
    `Found ${releases.length} releases matching ${TAG_PATTERN.source}`
  );

  // Clean out old per-release MDX files
  mkdirSync(CHANGELOG_DIR, { recursive: true });
  for (const file of readdirSync(CHANGELOG_DIR)) {
    if (file !== "introduction.mdx") {
      rmSync(join(CHANGELOG_DIR, file));
    }
  }

  const updates = releases.map((r, i) => {
    const label = i === 0 ? `${r.tag_name} (Current)` : r.tag_name;
    const body = escapeForMdx((r.body ?? "").trim());
    return `    <Update label="${label}">\n${body}\n    </Update>`;
  });

  const mdx = `---
title: Changelog
icon: clock-rotate-left
---

All notable changes to Macro, pulled from [GitHub Releases](https://github.com/${REPO}/releases).

Releases follow the format \`vYYYY.M.D.patch\`.

${updates.join("\n\n")}
`;

  writeFileSync(join(CHANGELOG_DIR, "introduction.mdx"), mdx);
  console.log("Wrote changelog/introduction.mdx");

  // Update docs.json with changelog tab
  const docsJson = JSON.parse(readFileSync(DOCS_JSON_PATH, "utf-8"));
  const tabs = docsJson.navigation.tabs as Array<Record<string, unknown>>;

  const filtered = tabs.filter(
    (t) => (t.tab as string).toLowerCase() !== "changelog"
  );

  filtered.push({
    tab: "Changelog",
    groups: [
      {
        group: "Releases",
        pages: ["changelog/introduction"],
      },
    ],
  });

  docsJson.navigation.tabs = filtered;
  writeFileSync(DOCS_JSON_PATH, JSON.stringify(docsJson, null, 2) + "\n");
  console.log("Updated docs.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
