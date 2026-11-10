# Macro documentation content

These are the canonical guides used by the public website at `macro.com/docs`.
The website in `apps/marketing` compiles the MDX, owns the navigation and styling,
and publishes the guides, screenshots, videos, and Markdown in the same build as
the product pages. Do not maintain a separate copy of the content in marketing.

## Edit and preview

Edit the MDX here and the navigation in `docs.json`, then run `bun run dev` in
`apps/marketing` and open `/docs`. The website watches this directory for changes.
The existing Mintlify component syntax is supported by the website's
`DocumentationContent` components; no Mintlify runtime is needed.

The outdated MCP tool reference is retired. Its former URLs redirect to MCP
setup; clients discover current tools through the connected MCP server.

## Publication and domain cutover

The website build renders product guides into the owning feature page's expandable
**Setup and reference** section. They remain MDX sources here, but no longer have
duplicate standalone HTML pages or sitemap entries. The compiler omits their old
demos and screenshots because the feature page already presents the current UI.
Standalone guides remain under `/docs`. Assets use `/docs-assets`; Markdown
exports keep their source paths, and the LLM indexes link to canonical pages.

`apps/marketing/seo/page-redirects.json` drives permanent 308 redirects on the
website's local servers and CloudFront function. The build also emits static
fallbacks for other hosts. Deploy the website stack together with the site to
activate the edge records. `/docs`, the old introduction, and `/migrate` lead to
the switching guide; product guides lead to features. The retired FAQ leads to
Pricing, with its remaining guidance in Email, the switching guide, Teams & Admin,
and Security. Queries survive redirects,
and legacy feature heading fragments open the embedded reference section.

`docs.json` contains the permanent redirect records for the old Mintlify host,
pointing directly at the final destination. Keep both maps in sync. The website
still uses its navigation for standalone guides.

The migration includes the 214 URLs published in the old host's sitemap on
2026-11-06 (`apps/marketing/seo/legacy-docs-paths.json`). Pages absent from this
checkout were restored from `origin/main` at `23658392c9`; existing guide edits
were preserved. Keep this URL inventory as a regression baseline, even when a
page is renamed or removed. Add a specific redirect before the catch-all when a
guide moves. Do not send missing guides to the homepage to disguise a 404.

Run `bun run check:docs-redirects` in `apps/marketing` after building. It validates
all recorded URLs, current guides, Markdown exports, trailing slashes, and media
against actual build files. Add `--origin=http://localhost:<preview-port>` to
check that every destination returns HTTP 200 from a static preview. The full
website build runs this check automatically.

Deploy and verify the website **before** publishing the Mintlify redirect config.
The old host must continue serving redirects after the migration: do not delete
its Mintlify project or DNS record. To retire Mintlify hosting later, first move
these same redirect rules to a replacement host with a valid `docs.macro.com`
certificate. Publishing redirect records and changing DNS require the separately
authorized cutover; neither is performed by local checks. After publishing,
check the old hostname itself for 308 responses and follow every sitemap URL to
a 200 destination before considering the migration live.
