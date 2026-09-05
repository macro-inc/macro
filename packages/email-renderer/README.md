# Email renderer

This package owns rendering an individual HTML or plaintext email body. It has no
Solid, application, thread, block, query, authentication, or transport dependency.

There are two entry points:

- `@macro-inc/email-renderer`: deterministic HTML/CSS preparation, quote and
  signature selection, and serializable output. It runs in Node without DOM APIs.
- `@macro-inc/email-renderer/browser`: Shadow DOM mounting, computed color
  adaptation, font normalization, width fitting, image visibility, and cleanup.
  It requires a browser, but no framework.

```ts
import { prepareEmailBody } from '@macro-inc/email-renderer';
import { mountEmailBody } from '@macro-inc/email-renderer/browser';

const body = prepareEmailBody(
  { html, replylessHtml, text },
  { images: { remote: 'block' } }
);
const options = {
  theme: {
    inkL: 0.2, inkC: 0, inkH: 0, panelL: 0.98,
    accentL: 0.5, accentC: 0.15, accentH: 250,
  },
  adaptColors: !body.hasTable,
  normalizeFonts: false,
};
const renderer = mountEmailBody(host, body, options);
renderer.setExpanded(false);
renderer.update(prepareEmailBody({ html }, { showQuotedContent: true }), options);
renderer.dispose();
```

## Responsibility and dependency rules

`src/core` may import other core modules and the pinned HTML/CSS parsers. It must
not import the browser entry point or read ambient theme, origin, flags, time,
network, or storage. Its TypeScript configuration excludes DOM libraries; its
tests use the Node environment. The package's import-boundary test checks every
production import and re-export, including literal dynamic imports.
These Node tests also run in the web app's default Vitest project list, including
the existing CI job. A regression test compiles core without DOM libraries, so
the framework boundary is checked during the ordinary frontend test run.

`src/browser` consumes prepared content. Only pass output from `prepareEmailBody`
to `mountEmailBody` or `update`; prepared HTML is a trusted intermediate value,
not another untrusted input boundary. The browser layer owns one host's shadow
tree and all listeners, resize observers, animation frames, and resource
lifetimes it starts. Connect an empty host before mounting. In a synchronous
framework render, inserting it immediately after construction is also supported;
the first computed-style and layout pass runs in the next animation frame.

`update` replaces the current content and aborts its resource generation. It
restarts color processing from the original prepared HTML, so toggling themes
does not accumulate transformations. `setExpanded` preserves content and resource
identity. `dispose` is idempotent, aborts work, disconnects observers, cancels
frames, removes listeners, and empties the shadow tree. Updating a disposed
renderer does nothing. Mount a new instance into a new host.

The host supplies `resolveImages(root, lifetime)` for authenticated or CID image
resolution, and optionally `prepareLinks(container)` for application navigation.
An asynchronous adapter must check `lifetime.signal.aborted` after each await
before mutating nodes. Register owned blob URLs or other handles through
`lifetime.onDispose`; registration after disposal releases them immediately.
Handle an image failure in the adapter or supply `onResourceError` for reporting.
There is no implicit fetch client or native-platform detection in this package.

## Content policy

- Nonempty HTML takes precedence over plaintext. Plaintext is escaped and rendered
  literally with preserved line breaks; Markdown punctuation stays literal.
- Prefer supplied replyless HTML. If absent/empty, derive it by removing the
  first recognized `.macro_quote`; otherwise show the full body. Missing
  generated replyless data must never blank a valid HTML message.
- Collapse recognized Gmail and Macro signatures and trailing breaks by default.
  `showQuotedContent` restores the original body, signature, and trailing breaks.
  `showFullContent` chooses the full body while retaining signature trimming.
- Parse with parse5 before DOM insertion. Drop active/embedded markup, form
  controls, handlers, dangerous URL schemes, and application-sensitive attributes.
  CSS is parsed with css-tree. Drop imports, external fonts, animations, host
  selectors, unparsed/unsupported constructs, and color-scheme overrides,
  including nested overrides. Malformed CSS fails closed without dropping text.
- `images.remote` is explicit and defaults to `allow` for existing reader behavior.
  `block` removes remote image references from HTML and CSS before insertion.
  CID references and base64 raster images remain supported. Relative image and
  navigation URLs are excluded because they depend on the embedding app's origin.
  `srcset`, SVG data images, and CSS image-set are excluded. `proxyUrl` rewrites
  HTTP(S) `img[src]` images to the supplied endpoint, matching the native
  authenticated-image adapter. CSS URLs and HTML background attributes follow
  the same allow/block policy but keep direct URLs; authenticated backgrounds
  are not supported by that native adapter. Escaped CSS URL functions that the
  parser cannot normalize as URL nodes are excluded.
- Links open with `target="_blank"` and `rel="noopener noreferrer"`; the host
  may intercept mailto links. Shadow containment bounds layout and paint. It is
  not an iframe security boundary; sanitization remains essential.
- The app decides when to adapt colors and normalize fonts. Its current policy
  adapts personal/table-less email and preserves designed newsletters on a white
  background. Sender classification and Macro-specific rendering stay in the app.

Ordinary HTML/plaintext and Macro Markdown are separate paths. Macro Markdown
still uses the app's Lexical/Solid renderer for document mentions and other app
semantics. This package does not render a thread, message header, attachments
list, editor, reply composer, or quote-expansion button.

## Verification and fixture viewer

From this directory in the repository's Nix shell:

```sh
bun run test
bun run type-check
bun run lint
bun run test:browser
bun run viewer
```

The viewer is a vanilla TypeScript/Vite page with fixture, theme, width, quote,
and expansion controls. It calls the same `prepareEmailBody` and `mountEmailBody`
exports as production. It requires no backend or account. Fixtures live under
`tests/fixtures`; use synthetic or redacted messages. Remote resources are blocked
by preparation, and screenshot tests assert that no external requests occurred.
Inter is loaded locally. The browser suite covers actual CSS/layout, resource
replacement, late cleanup, error handling, theme round trips, and image visibility.

From the repository root, `just test-email-rendering` runs both the Node and
Chromium suites. `just test-email-rendering-update` regenerates visual baselines;
inspect changed images before committing them. Screenshots use a zero differing
pixel budget, so update and compare with the same Chromium, Linux environment,
and fonts. Other OS/font/browser builds need their own comparison environment.
These tests do not establish native iOS/Tauri behavior or provider delivery.
The Chromium suite starts its own viewer on port 24821 and fails if that port is
occupied; it never silently reuses another worktree's server. The interactive
viewer uses Vite's normal development port.

Prepared output is deterministic for the same input, policy, and parser versions.
Pixel output also depends on browser version, fonts, viewport, loaded resources,
and theme. Keep those controlled in visual tests; do not claim universal pixel
determinism from a pure preparation function.
