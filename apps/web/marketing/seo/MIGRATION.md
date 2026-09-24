# Public-site SEO / AEO migration audit

Audited September 23, 2026 against the live `https://macro.com/sitemap.xml`,
its 30 listed pages, robots.txt, the imported marketing source, and the previous
`solid-site` CloudFront configuration. No production infrastructure was changed.

## Preserved and repaired

- All 30 indexed URLs remain at their existing paths. No feature/blog URL needs
  a migration redirect. This includes `/agents`, `/github`, `/migrate`, pricing,
  partner/legal pages, and all 11 posts, including the five alternative pages.
- The feature/blog prerenderer, titles, descriptions, canonicals, social images,
  article metadata, breadcrumbs, SoftwareApplication and FAQ markup remain.
  Build checks compare titles and schema types with the captured live baseline.
- Fixed the new homepage's empty HTML shell and missing Organization, WebSite
  and SoftwareApplication data. Its actual public UI is now prerendered for
  everyone; visitors and non-JavaScript crawlers receive the same content.
- Navigation links now exist in the initial HTML even while the menu is closed.
  Feature and comparison pages retain their original contextual links and FAQs.
  Restored the missing Startups menu link; the build also follows the HTML link
  graph and requires all 30 baseline pages to be reachable from the homepage.
- `/start` and `/start.html` now have their own canonical and `noindex, follow`.
  They no longer masquerade as the homepage. Existing mobile-signup noindex and
  sitemap exclusions remain.
- Production robots.txt still allows public crawling, excludes `/app` and
  `/test`, and advertises the sitemap. Non-production builds still disallow all.
  No new bot-specific restrictions were added. The live site returned 403 for
  `/llms.txt`, `/llms-full.txt` and `/agents.md`; there were no working files at
  those URLs to migrate, and none exist in the old public assets directory.
- Restored the marketing analytics initialization and Meta Pixel on the public
  journey. The existing GA4, Ads and PostHog configuration is reused.
- Demo code preloads sequentially during idle time after page load (except on
  Save-Data/2G connections); editors only mount near the viewport, with section
  copy always present and quiet placeholders if loading is still in progress. Direct mention-icon imports avoid loading the app's block
  registry on arrival. Initial JS is about 312 KB gzip, versus more than 1.9 MB
  before this pass; the build fails above 400 KB. These are artifact sizes, not
  production Core Web Vitals or a promise about field performance.

## Hosting contract — required before switching traffic

The current monorepo app deploy does not publish the public site. Keep the old
site origin available until the candidate passes the checks below.

1. Install Chromium (`bunx playwright install chromium --only-shell --with-deps`
   on Linux CI), fetch LFS assets, build with `VITE_APP_BASE_URL=https://macro.com`
   and run `bun run build:site`. Publish **dist-site/** to the website origin;
   keep the app's **dist/** on the existing app origin.
2. Retain direct 200 directory-index rewrites: `/email` → `/email/index.html`,
   `/posts/linear-alternative` → `/posts/linear-alternative/index.html`, etc.
   Do not send all public URLs to the homepage SPA fallback. Unknown URLs must
   return a real 404/410, not a homepage with status 200.
3. Preserve the existing special behaviors: `/app`, `/app/*`, app static files,
   `/.well-known/*` OIDC, and **resources*** to the Ghost origin. The legacy
   `/resources` content is outside the sitemap and this static build; dropping
   that proxy would lose pages despite the sitemap checks passing.
4. Preserve HTTPS, `www` → apex with the path/query intact, `chat.*` → app chat,
   and the authenticated-root → `/app` redirect. These are CDN behaviors, not
   client-side redirects. If URLs ever change, add explicit permanent redirects
   to relevant replacements rather than redirecting everything to `/`.
5. Keep Brotli/gzip delivery, immutable caching for hashed assets, revalidation
   for HTML, correct content types, and cache invalidation. Do not set a public
   `X-Robots-Tag: noindex`. Keep Search Console/Bing DNS verification and any
   CDN verification responses. No verification HTML/meta files were found in
   the old source; ownership settings cannot be verified from this repository.
6. Retain crawler access through WAF/CDN, not just robots.txt. Confirm Googlebot,
   Bingbot and relevant AI search crawlers using the providers' verification
   methods; spoofing a User-Agent alone does not establish real bot access.

## Cutover verification

- Run `bun run check:seo:live https://candidate-host` against the candidate CDN,
  then again against `https://macro.com` immediately after cutover. It checks
  all 30 paths without JavaScript/cookies, metadata, sitemap, robots, `/start`,
  and unknown-path status. The local filesystem gate cannot validate CDN rules.
- Separately exercise the existing `/resources/*` Ghost pages, app deep links,
  auth redirects, `www`/HTTPS redirects and campaign-query preservation.
- Run a mobile Lighthouse/PageSpeed comparison on the deployed old and candidate
  sites with the same settings; check LCP, INP, CLS and actual transfer/cache
  headers. Test a cold visit, menu links, native scrolling, editor loading and
  the footer CTA. The interactive app still needs JS; primary page copy does not.
- In Search Console/Bing Webmaster Tools, inspect `/`, a feature page and a post,
  verify the canonical/rendered HTML, and resubmit the unchanged sitemap. Save
  the previous 28 days of queries, landing-page clicks/impressions and conversions.
  Compare after rollout and watch indexing, 404s, crawler errors and web vitals.
- Keep the previous deployment for rollback. This pass prevents known technical
  regressions; it cannot guarantee unchanged rankings/citations after a redesign.

For AEO, the important preserved assets are fetchable text, clear feature pages,
comparison content, FAQs, internal links and accurate structured data. Google
does not require special AI files or extra schema for AI Overviews/AI Mode:
[AI features guidance](https://developers.google.com/search/docs/appearance/ai-features).
See also [JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)
and [site migration guidance](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes).
