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
  `enableHtmlCodeMode`, `code-mode/` adds `window.macro` to the frame:
  `frame-helper.ts` is the injected script and message protocol,
  `preview-runner.ts` the host side that runs each `macro.run` on the server
  as the viewer (`queries/document-programs.ts`) and posts only the outcome
  back. The frame never holds a credential. See the agent guide's
  "Program blocks in HTML previews" for the authoring contract.
