# Chat code-mode proof

Primary PR head: `b043d2af4d87834b4ec30ab4a61dd3eb6d36fb43`.
Local integration: `48ba8bfee7c9214164dd9aa9fe82556d180f47e4`.

The 60-second recording shows real SDK `Chat.send` and
`ai.structuredCompletion`, both with toolset `all`, reading a private test
task. The title and body marker appear in the structured response and the
persisted chat reply. The legacy web chat is read-only: there is no web send
composer on main; the turn was sent through the SDK. `steps.png` shows the
expanded `Finished a step` row without program or result disclosure.

AI responses, code execution, and Macro APIs are real. The integration has
vendor and Cursor stand-in configuration, neither used by this task read.
Image support from another integrated change is not attributed to this PR.
Total recorded model cost, including preflight: $0.1786; zero unpriced calls.
Preflight included a model type error rejected before execution, followed
by a corrected successful read. The recorded narrower read succeeded.

`proof.mp4` is the full-speed captioned recording; `proof.gif` is a preview
at 1.5x speed. `before.png` and `after.png` show the empty and populated
read-only chat. All visible data is synthetic local test data.
