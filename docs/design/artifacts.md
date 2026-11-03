# Artifacts

**Status:** Proposed. No implementation until this design is approved; the PR
plan is at the end.

Macro task: MACRO-4637.

## Goal

Agents write arbitrary HTML pages (an app screen, a prototype, a report, a set
of scenes) and publish them as Macro items that people open, share, comment on,
embed in documents and messages, and place on a canvas. It works from every
agent surface: code mode, Macro chat agents, and macrod agents running on the
user's machine, which can read the user's repository and build pages from its
real components and CSS.

This is the Macro version of Claude artifacts. What Claude artifacts do
especially well, and what this design keeps central, is **replicating an
existing UI and then making scenes and examples from it**: one capture of the
real styles, many pages that reuse it.

## Research

### Claude artifacts

Sources: [What are artifacts](https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them),
[Claude Code artifacts](https://code.claude.com/docs/en/artifacts),
[How Anthropic built Artifacts](https://newsletter.pragmaticengineer.com/p/how-anthropic-built-artifacts),
[Build artifacts](https://claude.com/blog/build-artifacts),
[Simon Willison on AI-powered artifacts](https://simonwillison.net/2025/Jun/25/ai-powered-apps-with-claude/).

- **What one is.** A self-contained output that opens in a panel beside the
  chat and lives in an Artifacts gallery: documents, single-page sites,
  diagrams, dashboards, small tools. Since September 2026, chat and Claude Code
  share one model, plus templates (Docs, Slides, Design, Dashboards).
- **Authoring.** One `.html` (or `.md`) file, up to 16 MiB rendered. Scripts
  load only from an allowlist of CDNs (cdnjs, jsDelivr `/npm/`, unpkg, jQuery,
  Tailwind CDN); fonts only from Google Fonts; every other asset is inlined
  (data URIs). Newer pages can publish supporting files next to the page
  (255 files, 16 MiB each, 64 MiB per version) and copy files from another
  artifact, which is how a design system's CSS and fonts are reused.
- **Sandbox.** Each page loads from a `*.claudeusercontent.com` origin, never
  claude.ai, so it can't see the session cookie. A strict CSP limits `fetch`,
  XHR and WebSocket to the page's own origin and Google Fonts; downloads need a
  capability. Anthropic describes it as iframe sandboxes with full-site process
  isolation plus strict CSPs. Exact sandbox flags are not published.
- **Sharing.** Private by default; share with people, the org, or a public link
  (public off by default for organizations). Viewer and editor roles. Every
  publish is a version and the owner picks which one viewers see. Comments,
  including comments addressed to Claude. Pages viewed from outside the org
  carry a "user-generated and unverified" notice.
- **Runtime capabilities.** Declared per page: call the model billed to the
  viewer (`window.claude.complete`), text storage (20 MB, personal or shared
  scope), MCP connectors that run as the viewer after the viewer approves, a
  shared document database, file uploads, downloads. The host makes every
  request; the page never sees a credential.
- **Design guidance.** The built-in design skill looks for the project's own
  design system first (tokens in CLAUDE.md, a theme file), defines colors as
  `:root` tokens with a dark-mode override, and makes pages work at phone
  width. Claude Design builds a persistent design system from a codebase,
  screenshots or a live site and then draws every screen from it.

**Why "replicate my UI, then make scenes" works.** The model stops inventing a
look. Once the real compiled CSS, tokens and markup are captured into the
artifact, every later page is a recombination of a fixed vocabulary, so scenes
stay consistent with each other and with the product, dark mode comes for free
from the tokens, and reviewers judge the idea instead of the styling. Macro's
own UI proposals already work this way: the real Solid components are rendered
in a harness and their markup plus compiled CSS are serialized into a page.
Hand-drawn lookalikes were rejected as not reflecting the product.

**Others.** Gemini renders untrusted pages in `*.scf.usercontent.goog` frames
([SafeContentFrame](https://bughunters.google.com/blog/beyond-sandbox-domains-rendering-untrusted-web-content-with-safecontentframe)),
with each subdomain its own site via the Public Suffix List. ChatGPT Canvas
uses a separate-origin sandboxed iframe; its published account-takeover came
from an unsandboxed `srcdoc` frame plus a `postMessage` handler on the host
page, not from the sandbox itself. v0 and Lovable run server VMs with open
network access. Claude and Gemini, the closest to this feature, both render
static pages in the browser on a separate origin and route data through the
host.

### What Macro has

**Canvas** (`packages/graphics`, `apps/web/src/features/block-canvas`,
[architecture](../architecture/canvas.md)). A canvas is a `Document` with file
type `canvas`, whose scene is a Loro tree in sync-service. Node kinds:
rectangle, ellipse, text, pencil, connector, image, video, document, plus
groups. The `document` node (`core/shapes/embedded.ts`) references any item by
`documentId`, `fileType` and optional `entityType` and `subpath`, and has
`display: 'preview' | 'embed'`. Embed mode (`views/embedded-items.tsx`) mounts
the item's block inside the node, `inert` until the user presses Interact, and
is allowed only for `md` and `canvas` (`core/document-display.ts`). Agents edit
canvases through the ai-editing worker's `CanvasEditor`, but cannot create or
delete embedded items (`services/ai-editing-worker/src/canvas/operations.ts`):
those go through the UI's reference flow, which also records an entity mention.
The SDK can only create a canvas today; read, edit and structured operations
are planned in [SDK content editing](sdk-content-editing.md) (MACRO-4584).

**HTML rendering.** Nothing in Macro serves HTML with running scripts from a
real origin.

- `.html` files are a plain-text code file type. The code block renders them in
  `<iframe sandbox="allow-scripts" srcdoc>` (`block-code/component/HtmlPreview.tsx`):
  an opaque origin with no relative assets, no storage and unrestricted network.
- The markdown `html-render` node renders sanitized email HTML into a shadow
  root on the app origin, with scripts, iframes and forms stripped. Agents can
  create it. It is for email, not for running pages.
- The static file service serves uploads from a macro.com subdomain under
  `default-src 'none'`, so HTML there cannot run scripts, and any file is
  readable by anyone who has its id.

**An isolated origin already exists.** The agent preview gateway
(`crates/agent_preview`, `infra/stacks/preview-gateway`) serves agent dev
servers on `*.macro-agent-gateway.com`, and the stack refuses any domain under
macro.com because previews run agent-written JavaScript. Viewers authenticate
with a one-time ticket exchanged for a host-only cookie, and previews open in a
new tab, never in an iframe.

**Items, sharing and comments.** Documents get Drive, Recent, Home, search,
projects, share links and team grants, document discussions (`comms_messages`
with a document parent), mentions and cards in markdown and channels, and
favorites. A new entity kind has to register in dozens of places
([add-entity guide](../guides/add-entity.md)); the canvas avoided that by being
a document file type.

**Agent surfaces.**

- **SDK** (`packages/sdk`): one namespace per noun, entity handles with
  `webUrl()`, no raw ids. Code mode runs it in Deno with a 64 KiB source and
  result limit and no filesystem.
- **macrod** (`crates/coding_agent_worker`): local ACP agents get Macro only
  through MCP servers at the agent egress, authenticated by an opaque session
  token. ExecuteCode runs remotely, so a local agent can't hand it a file;
  `UploadFile` takes base64 in the tool call.
- **Views** (`crates/dynamic_ui`): a fixed declarative widget list, no HTML.

## Design

### An artifact is a document

An artifact is a `Document` with a new file type, `artifact`, like the canvas.

- It inherits Drive, Recent, Home, search, projects, share links, team grants,
  favorites, document discussions, mentions and document cards without a new
  entity kind. The add-entity guide lists every place a new kind must register
  and notes every launch missed some; none of that buys anything here.
- Documents are the item Macro uses for user content of many formats (markdown,
  canvas, PDF, spreadsheet, code), which is what an artifact is, so this is
  reuse for the same purpose (CS-71).
- What documents don't have is a multi-file, versioned body. That is the one
  new piece of storage (below).

Rejected: **its own entity kind** (`artifact_entities`), which duplicates
sharing, catalog and discussions for no gain; **a canvas-only item**, which
can't be opened, shared or embedded on its own; **the `html` code file type**,
which is one file, unversioned, and rendered in an opaque `srcdoc` frame.

### Versions and scenes

Each publish creates an immutable **version**: a manifest of files plus a list
of scenes.

```text
artifact_versions
  id            uuid
  document_id   text      -- the artifact document
  number        int       -- 1, 2, 3 … per artifact
  files         jsonb     -- { "index.html": {sha256, size, content_type}, "theme.css": … }
  scenes        jsonb     -- [{ "id": "empty-state", "title": "Empty state", "path": "scenes/empty.html" }]
  message       text      -- optional "what changed"
  created_by    text      -- user id; agent actor recorded alongside, as sync-service blame does
  created_at    timestamptz
```

- File bytes are content-addressed in S3 (`artifacts/<document_id>/<sha256>`),
  so unchanged files cost nothing across versions.
- The document points at its current version. Restoring an old version
  publishes its manifest again as a new version; history is never rewritten.
- Publishing takes an optional `baseVersion`; a stale one is rejected, so two
  agents republishing the same artifact can't silently overwrite each other.
- Limits match Claude's: 16 MiB per file, 64 MiB and 255 files per version, and
  a content-type allowlist (HTML, CSS, JS, JSON, images, fonts, video, PDF,
  text).

**Scenes are the shareable chunks.** A scene is a named page in the bundle.
The UI-replication flow produces exactly this shape: one captured `theme.css`
(and fonts, icons) shared by many scene pages, `index.html` listing them.

- A scene has its own URL (`/app/artifact/<id>?scene=empty-state`), can be
  placed on a canvas or embedded on its own, and shows as a tab in the
  artifact view.
- Permissions stay per artifact. Sharing a scene shares a link into the
  artifact. A scene that needs different access is copied into a new artifact
  (publish with files copied from another artifact, as Claude does for design
  systems), which also gives agents a way to reuse a captured design system.

### Rendering and security

Agent-written pages run with scripts, so they must never run on a Macro origin.

**A separate registrable domain.** Content is served from
`<document-id>.macro-artifacts.com` (dev: `<document-id>.dev.macro-artifacts.com`),
a new domain outside macro.com, guarded in its stack the way the preview
gateway is. One subdomain per artifact gives each artifact its own origin, so
`localStorage`, IndexedDB and service workers are isolated between artifacts
and stable across versions. We should also list the domain on the Public
Suffix List so each artifact is its own site, as `usercontent.goog` is. A
separate domain from the preview gateway keeps artifacts and previews from
being same-site with each other.

**No cookies; a capability path instead.** An artifact frame is a third-party
iframe, and browsers block third-party cookies there, so the preview gateway's
ticket-to-cookie exchange doesn't work. Instead the app asks DSS for a view
URL:

```text
https://<document-id>.macro-artifacts.com/t/<token>/v/<number>/<path>
```

The token is short-lived (hours), signed, and names the artifact, the version
and the viewer's access level. It sits in the path, so every relative URL in
the page (`theme.css`, `scenes/empty.html`, images) keeps working without the
author knowing about it. DSS mints it after the normal document access check,
including public links for anonymous viewers.

**Serving.** CloudFront in front of the S3 bucket, with a viewer-request
CloudFront Function that verifies the token (HMAC, key in a KeyValueStore so
it can rotate), checks it matches the subdomain, and rewrites the path to the
version's content-addressed object. Bytes never pass through a Macro service,
and versions cache forever. A Rust handler on the gateway ALB, like the preview
gateway, is the alternative if the function can't resolve a path to a sha
without a lookup; the manifest can be written to S3 as a path index per
version to avoid that.

**Headers on every response:**

```text
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net/npm/ https://unpkg.com;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' data: https://fonts.gstatic.com;
  img-src 'self' data: blob:;
  media-src 'self' data: blob:;
  connect-src 'self';
  form-action 'none';
  base-uri 'none';
  frame-ancestors https://macro.com https://dev.macro.com <local app origins> tauri://localhost;
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Cross-Origin-Resource-Policy: same-origin
```

- `connect-src 'self'` and the image and media rules mean a page can't send
  anything anywhere but its own origin, which only serves the artifact's
  files. A page has nothing of the viewer's to send anyway: no cookies, no
  token, no Macro API.
- `frame-ancestors` restricted to Macro app origins, and the function rejecting
  requests whose `Sec-Fetch-Dest` is `document`, mean an artifact never renders
  as a top-level page. It is always inside Macro's chrome, which shows who
  published it, so it can't pose as a Macro login page at its own URL.
- The CDN allowlist matches Claude's, so pages agents already know how to write
  work unchanged.

**The frame:**
`<iframe sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer">`.

- `allow-same-origin` is safe here because the origin is the artifact's own
  domain; it is what gives the page storage and `fetch('self')`.
- No `allow-top-navigation`, so a page can't navigate Macro away. No
  `allow-forms`, `allow-modals` or `allow-downloads` in v1.
- Popups are allowed so links in a page open in a new tab, like any link on
  the web. Revisit when runtime capabilities give pages viewer data.
- The host page never trusts a message from the frame. v1 listens only for a
  size message (for auto-height embeds) and the theme handshake below, matched
  on the exact frame origin.

**Theme.** The view URL carries `?theme=light|dark`, and the parent posts
theme changes. Agents are told (in SDK docs and the macrod guidance) to define
tokens on `:root` with a `[data-theme="dark"]` override and to read the
parameter, the same convention Claude's design skill uses.

### The artifact view

The artifact block is the standard block shell (TopBar with name, share,
discussions, the overflow menu) around the frame, like the code block's HTML
render mode. It adds a scene switcher (tabs, or a select when there are many)
and a version menu (history, "what changed", restore). A notice in the TopBar
names the publisher, and for viewers outside the owner's team says the content
is user-generated.

Mobile: the frame fills the block's content area between the floating chrome,
as `HtmlPreview` already does with its mobile insets; the scene switcher
collapses into the TopBar's menu.

### On the canvas

An artifact on a canvas is the existing `document` node with
`fileType: 'artifact'`, and `subpath` holding the scene id (it is already the
node's opaque host navigation state).

- `canEmbedDocument` accepts `artifact`, and the embed view renders the frame.
  It stays `inert` until Interact, exactly like embedded documents today, so
  panning and selecting the canvas never fight the page. Preview display shows
  the version's thumbnail.
- The node follows the artifact's current version. When an agent republishes,
  the version change reaches viewers through the existing document update
  events and the frame reloads with a new view URL, so people watching a canvas
  see the agent's change land. Pinning a node to one version is a later option.
- Several scenes of one artifact laid out side by side is the "scenes and
  examples" board: one node per scene.
- Placing an artifact goes through the same reference bookkeeping as the UI
  (entity mention recorded). Agents get it as an `embed` operation in the
  canvas structured layer planned in SDK content editing; the worker is told
  the references are recorded server-side before it commits the node.
- RenderCanvas, and Drive and card previews, use a thumbnail captured at
  publish time by the same Browser Rendering setup the worker already uses for
  canvas snapshots, loading the artifact's view URL.

### In documents and messages

An artifact mention or card uses the existing document card path with a new
`artifact` branch: the thumbnail, the name, the scene, and click to open. A
live inert frame inside a markdown card is a later option; thumbnails keep long
documents and channels cheap.

### Authoring

**SDK** (`macro.artifacts`, handles only):

```ts
const artifact = await macro.artifacts.create({
  name: 'Agents settings: proposals',
  files: { 'index.html': html, 'theme.css': css },
  scenes: [{ id: 'empty', title: 'No agents', path: 'scenes/empty.html' }],
  project,
});
await artifact.publish({ files: { 'scenes/empty.html': next }, message: 'Tighter empty state' });
artifact.webUrl();                           // https://macro.com/app/artifact/<id>
artifact.sceneUrl(artifact.scene('empty'));
await artifact.versions();
await canvas.place(artifact.scene('empty'), { x: 0, y: 0, width: 1280, height: 800 });
```

- `publish` sends only changed files: the server answers with the shas it is
  missing and presigned PUTs for them, then commits the manifest. Small files
  can go inline in the request, which is what code mode uses within its
  64 KiB source limit.
- `files` may name a file of another artifact (`{ artifact, path }`) and the
  server copies it by sha, so a captured design system is reused without
  re-uploading.
- The rule agents must follow (one HTML entry point, CDN allowlist, inline or
  bundle every asset, theme tokens) goes in the first sentence of `create`'s
  doc, because code-mode indexes keep only that.

**Macro chat agents** get a `PublishArtifact` tool (files as text, scenes,
optional artifact to update) built on the same domain service, for hosts
without code mode.

**macrod agents.** A local agent should publish files from disk without
reading them into its context, which is what Claude Code's artifact tool does.
macrod serves a local `PublishArtifact` tool that takes paths in the session's
working tree, reads and hashes the files itself, and uploads only the missing
ones through the agent egress (a new `/artifacts` route that resolves the
session token to the owner, as `/mcp-macro` does). The agent never holds a
Macro API token.

**Replicating the user's UI.** Shipped as guidance to macrod and code-mode
agents (macrod's runtime prompt and an SDK docs topic), from the recipe Macro
already uses for UI proposals:

1. Find the design system in the repository: token files, the Tailwind theme,
   compiled CSS from the app's own build.
2. Render the real components (the repository's dev server or a small harness
   page) in a headless browser and serialize the markup plus every stylesheet
   rule; inline fonts.
3. Publish that once as `theme.css` and fonts, then write each scene as a page
   that reuses the captured markup and classes. Reuse the captured files in
   later artifacts by copying them.

### Observability

Spans `artifact.publish` (artifact id, version, file count, bytes uploaded vs.
reused), `artifact.view_url` (artifact id, access level), and
`canvas.embed_artifact`, with trace context carried from the SDK, the egress
route and macrod's upload. CloudFront logs carry the artifact subdomain and
version; tokens are never logged.

### Runtime capabilities (later)

Pages that read Macro data, keep shared state or ask a model need a bridge,
because the page can't hold a credential. The serving edge would inject a small
runtime script into HTML responses that talks to the Macro frame over
`postMessage`; the Macro side performs each request as the viewer, only for
capabilities the artifact declares and the viewer approves. That is the point
at which popups, `allow-forms` and the message handler need a security review.
Not in the first phases.

## Phasing

Each step is a reviewable PR; the UI stays behind an `artifacts` feature flag
until the first three land.

1. **Backend.** `FileType::Artifact`, `artifact_versions`, an `artifacts`
   domain crate hosted in DSS (create, publish with missing-sha upload, read
   versions, restore, mint view URL), Soup and preview registration for the
   file type, spans.
2. **Serving.** The `macro-artifacts.com` stack: certificate, CloudFront,
   token-verifying function, headers, key rotation. Code only; deploying it and
   registering the domain are separate, explicit steps.
3. **SDK and web viewer.** `macro.artifacts`, code-mode docs, the artifact
   block (frame, scenes, versions), and the canvas `document` node accepting
   `artifact` for people placing artifacts by hand.
4. **Agents on the canvas.** The canvas `embed` operation, `canvas.place`,
   publish-time thumbnails, document and message cards, `PublishArtifact` for
   chat agents.
5. **macrod.** The local `PublishArtifact` tool, the egress `/artifacts` route,
   and the UI-replication guidance.
6. **Runtime capabilities**, designed separately.

## Open questions

- **Domain.** Buy `macro-artifacts.com` (or another name) and apply for the
  Public Suffix List. Needs a person.
- **Default sharing.** Should an artifact an agent creates in a session be
  shared with the session's thread participants, like other agent-created
  documents, or start private?
- **macrod local tools.** Confirm macrod can add its own MCP server to an ACP
  session alongside the egress servers, or expose the tool another way.
