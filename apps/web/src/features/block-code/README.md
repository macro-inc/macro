# Block Code

A block for editing code files with syntax highlighting and formatting.

## Features

- Syntax highlighting for multiple programming languages
- Code editing with Code Mirror
- Automatic saving of code changes
- Support for various file types and extensions
- Find bar (`cmd+f`) with match highlighting, styled with the app's own
  controls; replace appears only when the document is editable
- Read-only viewers keep a caret and can select and copy code, but cannot edit
  it (`EditorState.readOnly`, not `EditorView.editable`)
- HTML files render in a sandboxed `srcdoc` frame (`HtmlPreview`). Behind
  `enableHtmlCodeMode`, a stored document renders the agent harness's build
  of its saved source (`queries/document-programs.ts`, keyed in
  `queries/keys.ts`): the page with its `text/macro` programs removed and its
  TypeScript client script bundled, or the build's problems by block. A
  document the server can't build renders as plain HTML. `code-mode/`
  supplies the frame's `window.macro`, which the build's `macro:programs` and
  `macro:client` imports compile onto: `frame-helper.ts` is the injected
  script and message protocol, `preview-runner.ts` the host side that runs
  each named program of the shown build on the server as the viewer (with
  no cap of its own: the server queues a viewer's runs past two), unwraps
  its value, reports each failed run through `onFailure` (the preview shows
  the latest one in a dismissible notice above the frame) and refetches the
  build when the server answers that the document changed, and `event-host.ts` the host side of `on`: one server
  event stream per frame (`queries/document-events.ts`) whose filters are the
  union of the frame's subscriptions, forwarding only each event's name and
  entity id. The frame never holds a credential or sends code.
- `composeProgramDocument` puts a strict Content-Security-Policy `<meta>`
  first in the built page's head, before the helper: inline scripts and
  styles, `data:`/`blob:` media, and no network, forms or `<base>`, so a page
  that runs programs as the viewer can't send what it read anywhere. CSP does
  not block the frame navigating itself, and programs run with the
  viewer's full access with no consent prompt (see the design doc). The plain fallback frame runs no programs and gets no policy. See the agent
  guide's "Program blocks in HTML previews" for the authoring contract.
