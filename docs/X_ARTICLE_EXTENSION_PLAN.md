# Macro Editor for X Articles (Chrome Extension)

## Status

Design discussion. No code or schema changes have been made as part of this document. Every claim about
existing behavior is cited to a file in this repository, or to the public X API surface where noted.

## Problem

X's Articles composer is a Draft.js rich-text editor. It has headings, bold/italic/strikethrough, flat
lists, blockquotes, links, images, and embedded posts, and nothing else. There is no Markdown, no code
blocks, no tables, and no way to reference anything you have written elsewhere.

Macro users write in the Macro Lexical editor and reference Macro entities inline: documents, channels,
email threads, projects, people. When they want to publish long-form content to X, that context is lost.
They export or retype, and every Macro reference becomes a manual copy-pasted link.

The ask: a Chrome extension that replaces the body of X's article composer with the Macro editor, so the
page still looks like X, mentions still work like Macro, and publishing produces something X renders
correctly.

## Key findings

### The X side is friendlier than expected

X API v2 exposes `POST /2/articles/draft` and `POST /2/articles/{article_id}/publish`, both under
`OAuth2UserToken` with the `tweet.write` scope. The draft endpoint takes a `content_state` object that is
richer than the in-app composer toolbar suggests:

- Block types: `unstyled`, `header-one`, `header-two`, `header-three`, `unordered-list-item`,
  `ordered-list-item`, `blockquote`, `atomic`.
- Inline styles: `bold`, `italic`, `strikethrough`.
- Entity types: `post`, `link`, `image`, `emoji`, `markdown`, `divider`, `latex`.

The `markdown` entity is the important one. Per the schema it "carries code blocks, GFM tables, and other
Markdown", with a 10,000 weighted-character budget per article. There is no table entity type — tables
are Markdown. So the two formats X's own UI cannot produce are reachable through the API, and the answer
to "it becomes MD renderable by x.com" is literally yes for the parts that need it.

`latex` renders TeX from the block text, and `divider` is a horizontal rule. Between them, most of what
the Macro editor can express has a home.

Publishing requires an X Premium subscription. Draft creation does not.

### Macro's external Markdown already degrades mentions into links

`EXTERNAL_TRANSFORMERS` in `packages/lexical-core/transformers/index.ts` exists precisely for handing
Macro content to a non-Macro reader. `E_DOCUMENT_MENTION` in `packages/lexical-core/transformers/mentions.ts`
turns a document mention into `[{documentName}](https://{hostname}/app/{blockName}/{documentId})`.
`E_TAG_MENTION` produces `#{name}`, `E_GROUP_MENTION` produces `@here`, `E_CONTACT_MENTION` produces the
email or domain, equations produce `$...$` / `$$...$$`.

Two defects matter for this feature:

1. `cleanHostname()` reads `window.location.hostname`. Running inside x.com, a document mention would
   serialize to `https://x.com/app/md/{id}`. The hostname must be injectable rather than ambient.
2. `E_USER_MENTION` emits the bare `userId` (e.g. `macro|alice@example.com`), which is meaningless to a
   public reader. Publishing needs a display name, or an X handle if we can map one.

### There is no liftable editor component

`@macro-inc/lexical-core` is genuinely headless and framework-agnostic: no Solid or React imports, no CSS,
consumed as TypeScript source, already used from `services/lexical-service` and `services/ai-editing-worker`.
It is a good foundation.

The mountable editor is not. `MarkdownShell` and its plugin graph live in
`apps/web/src/lib/core/component/LexicalMarkdown/` and assume the app shell:

- `MentionsMenu` calls `useAnalytics()` and `useQuickAccess()` unconditionally; both throw outside their
  providers, and `QuickAccessProvider` sits beneath `UserContextProvider`, `TeamContextProvider`,
  `ChannelsContextProvider`, and the query-sync graph in `Root.tsx`.
- `ContactMention` does `useSplitLayout()!` and crashes without a split layout.
- `DocumentMention` pulls `@queries/preview`, `useSplitNavigationHandler`, `@block-calendar/*`, and
  `@property/*`.
- `apps/web` is a single-entry SPA (`vite.base.ts` has one `input: { app: ... }`) resolving dozens of
  tsconfig path aliases, with Tailwind v4 semantic tokens assumed on `:root`.

Mounting that in a content script is a fork, not an embed. Nodes do degrade gracefully without decorators
(`DocumentMentionNode.decorate()` returns `undefined` when `getDecorator()` is empty), so building fresh
UI on the same nodes is viable.

### Auth already has an answer, and it is not cookies

Production session cookies are `HttpOnly` and `SameSite=Strict`
(`services/authentication_service/src/api/utils.rs`). That rules out cross-site iframes, and it rules out
`credentials: 'include'` from an extension origin. The CORS allowlist in `crates/macro_cors/src/lib.rs`
has no `chrome-extension://` entry.

But `services/mcp_auth_proxy` is already a general OAuth 2.0 authorization server: dynamic client
registration at `/register`, PKCE S256 at `/authorize`, `/token`, and RFC 8414 discovery metadata. Its
`is_allowed_redirect_uri` (`services/mcp_auth_proxy/src/domain/service.rs`) accepts **any** `https`
redirect URI, which includes the `https://<extension-id>.chromiumapp.org/` callback that
`chrome.identity.launchWebAuthFlow` uses. It returns upstream FusionAuth bearer tokens and supports
refresh exchanges.

That token is the same shape as the `macro-access-token` cookie, and `GET /jwt/macro_api_token` explicitly
accepts `Authorization: Bearer <access_token>` as an alternative to the cookie
(`services/authentication_service/src/api/jwt/macro_api_token.rs`). So the extension can complete a
standard PKCE flow, exchange for a `macro_api_token`, and call every Macro service — with no new backend
auth work.

## What it looks like

Only the article body changes. X's back button, drafts menu, cover-image slot, title field, preview, and
publish button stay exactly where they are, doing exactly what they do.

At rest the body is visually indistinguishable from X's editor: same column width, same Chirp font stack,
same line height, same placeholder. We read X's own computed styles and CSS custom properties rather than
guessing, so the extension follows X's light/dark/dim themes for free.

The difference shows up only when the user reaches for it:

- `@` opens the Macro mention menu, styled in X's surface colors. Buckets: Documents, Channels, Threads,
  People, Projects.
- `/` opens block actions: heading, quote, list, code block, divider, equation, table.
- Macro references render as inline pills while editing, the way they do in Macro.

A thin status strip sits under the body: `Macro editor · 4 references · 2 not publicly shared`, plus a
"Sync to X draft" control.

The pill-versus-link question is the one real UX decision. A Macro pill is not what a reader on X will
see; on X it will be a plain link. Rather than pretend either way, the editor shows pills and X's own
Preview tab shows the truth, and the pre-flight modal (below) makes the transformation explicit before
anything is published.

### Publish pre-flight

Publishing is where a Macro-native document meets a public audience, so the extension interrupts once:

```text
Publishing to X — 4 Macro references

  ✓ Q3 Architecture Review        public link      → link
  ✓ Migration notes               public link      → link
  ⚠ #eng-platform (channel)       team only        [ Make public ] [ Drop ] [ Keep title only ]
  ⚠ Pricing thread (email)        private          [ Make public ] [ Drop ] [ Keep title only ]

  User mentions: 2 → published as display names
```

Share state comes from `SharePermissionV2` (`crates/models_permissions/src/share_permission.rs`), where
`linkShare: PUBLIC` grants anonymous access and `TEAM` does not. `new_document_share_permission` defaults
Markdown documents to public-with-edit unless a team default overrides it, so in practice most document
references will pass clean; channels and email threads will not.

## Architecture

### Three levels of invasiveness

| | Approach | Verdict |
|---|---|---|
| A | Overlay panel launched from a button in X's composer | Least fragile, least of what was asked for |
| B | Replace the body editor in place, keep X's chrome | **The target.** Matches the request |
| C | Take over the `/compose/article` route entirely, drive drafts through the API | Most control, loses "looks like X" for free |

Recommend building toward B. A is a useful intermediate if X's DOM turns out to be hostile, and it shares
every piece of the pipeline below, so it is not wasted work.

### The synchronization problem in option B

If we hide X's Draft.js editor, X's autosave, drafts list, preview, and publish button all still read from
Draft.js state. Two ways to keep them honest:

1. **Write back into Draft.js.** On a debounce, serialize Macro content and apply it to the hidden editor
   via a synthetic paste of `text/html`, which Draft.js's paste processor understands. X's own machinery
   then behaves normally. Fragile in the usual DOM-scraping ways, but requires nothing from X beyond a
   session.
2. **Own the draft through the API.** Skip Draft.js entirely and `POST /2/articles/draft` ourselves, then
   hand the user to X's draft for review and publish. Structured, testable, gives exact control over
   `latex` / `divider` / `markdown` entities. Costs an X developer app and OAuth2 PKCE.

Do both, over one intermediate representation.

### One IR, two sinks

```text
Macro Lexical editor state
        |
        v
  Article IR  (blocks + inline styles + entities, mirrors content_state)
        |
        +--> POST /2/articles/draft            (structured, preferred)
        `--> text/html --> Draft.js paste      (fallback, no API keys)
```

The IR is the durable, unit-testable artifact and the only part with real logic in it. Both sinks are thin.

### Node mapping

| Macro Lexical node | X `content_state` |
|---|---|
| `heading` h1–h3 | `header-one` / `header-two` / `header-three` |
| `heading` h4–h6 | `header-three` (degrade, no deeper level exists) |
| `paragraph` | `unstyled` |
| bold / italic / strikethrough | `inline_style_ranges` |
| `link` | `link` entity range |
| `quote` | `blockquote` |
| flat list | `unordered-list-item` / `ordered-list-item` |
| nested list | flatten with indent prefix; X has no nesting |
| `CustomCodeNode` | `atomic` + `markdown` entity, fenced block |
| table | `atomic` + `markdown` entity, GFM pipe table |
| `HorizontalRuleNode` | `atomic` + `divider` entity |
| `EquationNode` | `atomic` + `latex` entity, TeX in block text |
| `ImageNode` | `atomic` + `image` entity, after `POST /2/media/upload` |
| `TagMentionNode` | text `#{name}` + `data.hashtags` span |
| `DocumentMentionNode` | `link` entity, text = document name, url = `https://macro.com/app/{block}/{id}` |
| `UserMentionNode` | display name text, or `data.mentions` span if an X handle is known |
| X post URL | `atomic` + `post` entity |
| `MagicChipNode`, `WatermarkNode`, `CommentNode`, diff nodes | stripped |

Inline code has no X equivalent — either promote to an atomic `markdown` entity or drop the styling. The
10,000-character `markdown` budget is per article, so a code-heavy post needs a budget check with a clear
error rather than a truncated publish.

### Editor construction

Build a slim editor on `@macro-inc/lexical-core` plus vanilla `lexical`:

- Register `SupportedNodeTypes` from `packages/lexical-core/node-list.ts`.
- Reimplement the `@`-typeahead against `POST /search` (`crates/search_service/src/api/search.rs`,
  mounted on `document_storage_service`), which already returns `document`, `chat`, `email`,
  `channelMessage`, `channel`, `project`, `call`, `company`, `calendarEvent`. Note the web app's 3-character
  minimum in `validateSearchServiceText`.
- Register lightweight decorators via `setDecorator()` for the handful of nodes that need chips.
- Skip Loro entirely. `buildConfig('markdown')` without collab does not pull `loro-crdt`, and a compose
  surface does not need CRDTs.
- Serialize with `EXTERNAL_TRANSFORMERS`, with an injected hostname instead of `window.location.hostname`.

All Macro API calls route through the MV3 background service worker. Content scripts are subject to CORS
in MV3, and the allowlist in `crates/macro_cors/src/lib.rs` does not include extension origins; background
fetches with `host_permissions` are not.

### Should this become a real package?

The slim editor is useful beyond X — email clients, a VS Code webview, the docs site, any future embed. If
that is on the roadmap, extract `@macro-inc/editor-embed` now and let the extension be its first consumer.
If not, keep it inside the extension and define the seam so extraction stays cheap. Do not extract
speculatively; do not couple it to the extension's DOM either.

## Phasing

1. **Article IR and the `content_state` compiler.** Pure functions, golden-file tests over Macro Markdown
   fixtures. No browser, no extension. This is where the real risk lives and it can be validated alone.
2. **Fix the external transformers.** Inject hostname; make `E_USER_MENTION` emit something a human can
   read. Both are small changes to `packages/lexical-core/transformers/mentions.ts` with existing test
   coverage nearby.
3. **Extension skeleton with OAuth.** PKCE against `mcp_auth_proxy` via `chrome.identity.launchWebAuthFlow`,
   exchange for `macro_api_token`, background-worker API client, token refresh.
4. **Slim editor mounted as an overlay (option A).** Proves the editor, mentions, and search without
   fighting X's DOM.
5. **In-place replacement (option B).** Style mirroring, Draft.js write-back, resilience to DOM drift.
6. **Publish pre-flight and share-permission repair.**
7. **Optional: X draft API path**, replacing write-back where an X developer app is available.

## Open questions

**Which direction is the source of truth?** "Write the article in Macro, publish to X" and "write on X with
Macro superpowers" are different products. The first makes the extension a publish target and keeps the doc
canonical, editable, commentable, and re-publishable; it also lets Macro store the resulting X permalink as
a document property (`crates/properties`). The second makes the article canonical and Macro a reference
library. The first looks stronger, and it changes what phase 1 should build.

**Is X the first of several destinations?** If LinkedIn, Substack, or Ghost are plausible, the Article IR
should be a general publish IR from the start, and the extension becomes one adapter among several. That is
a small change now and an expensive one later.

**What happens to private references?** Silently dropping is dangerous, blocking publish is annoying, and
auto-publicizing is a data-exposure footgun. The pre-flight modal above assumes per-reference choice with a
safe default, but the default matters and should be a product decision.

**Who is this for?** The Macro team publishing changelogs and marketing, or every Macro user? The former
justifies a much narrower v1 and tolerates DOM fragility. The latter needs the API path and a Chrome Web
Store listing.

## Risks

- **X DOM drift.** Option B breaks whenever X reships the composer. Mitigation: feature-detect and fall
  back to the overlay rather than failing closed, and keep the API path as the durable route.
- **Reading a user's Macro session.** The OAuth path avoids this entirely. Any shortcut through
  `chrome.cookies` should be rejected in review — the flow already exists and the redirect-URI rules already
  permit it.
- **Premium gating.** Publish requires X Premium; drafts do not. Detect and message this before the user
  writes 2,000 words.
- **Extension review.** A content script that replaces a major site's editor and holds OAuth tokens for a
  second service invites scrutiny. Narrow `host_permissions` to `https://x.com/compose/*` and the Macro
  hosts, and keep tokens in the background worker.
- **Markdown budget.** 10,000 weighted characters across all `markdown` entities per article. Check before
  submitting, not after.
