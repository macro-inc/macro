# Documentation project instructions

## What it is

The canonical customer-facing reference content for feature pages and `macro.com/docs`, built
and styled by `apps/marketing`. This directory covers the hosted product and MCP setup. Keep a single content source here; do not duplicate guides in
the website.

## About this project

- Pages are MDX files with YAML frontmatter; navigation lives in `docs.json`.
- Preview with `bun run dev` in `apps/marketing` and visit `/docs`.
- Run the marketing build to validate MDX, links, assets, and prerendered pages.
- Component adapters and document styles live in `apps/marketing/src/features/documentation`.
- Keep the retired MCP tool reference unpublished; redirect its old URLs to MCP setup.
- Keep billing guidance on `/pricing`; redirect the retired billing guide there. Keep the keyboard shortcut reference in the app and redirect its retired web guide to Support.
- Keep one content source. Feature guides render in the feature page’s expandable reference section; do not publish duplicate standalone pages.
- When consolidating a page, preserve its useful details and add permanent records to `docs.json` and `apps/marketing/seo/page-redirects.json`; run the marketing redirect check and follow the ordered host cutover in README.md.

- Keep the Main benefits navigation in this order: Company graph, AI tagging, Automatic permissions, Workspace events, Unified search. Preserve the existing guide URLs when changing their display names; the marketing site presents these as feature overviews with this MDX retained under Setup and reference.

## Terminology

- A **block** is the core unit in Macro (doc, email, channel, task, call, canvas, etc.). Use "block", not "module" or "app"
- Use **@mention** (not "at-mention" or "tag") for references created with `@`
- Use **channel** (not "chat room"), **agent** (not "bot"), and **workspace** for a user's whole Macro environment
- Use **personal memory** and **team memory** for the two memory levels
- **Signal** and **Noise** are capitalized when referring to the inbox and email views
- Third-party products use their official capitalization: GitHub, Gmail, Notion, Slack

## Style preferences

- Use active voice and second person ("you")
- Keep sentences concise — one idea per sentence
- Use sentence case for headings
- Bold for UI elements: Click **Settings**
- Code formatting for file names, commands, paths, and code references
- Keyboard shortcuts use `<kbd>` tags, e.g. press <kbd>c</kbd> + <kbd>t</kbd>
- Block tutorial videos embed from `https://macro.com/video/tutorials/<id>.mp4` with `<id>-poster.jpg`; the website publishes these from `apps/marketing/public/video/tutorials/`.
- Use `<GuideGraphic kind="…" label="…" />` for product illustrations, reusing the feature-page scenes registered in the marketing documentation adapter; do not add product screenshots. Keep existing external-service captures and explanatory diagrams where needed.

## Content boundaries

- Document the hosted product; self-hosting is covered only at a high level in Security
- Don't document internal tooling, infrastructure details, or unreleased features
- Don't add placeholder or "WIP" pages — add a page only when there's real content for it
- Keep Security brief: show the three existing compliance badges with `SecurityBadges`, link to `https://security.macro.com` for security reviews, and retain security reporting and self-hosting contacts.
