# Native editor sessions

`loadDocumentSession` initializes the production WASM module lazily and shares
its initialization promise. Failed loading clears the promise so a later open
can retry. Keep this off the app boot path.

`createRustEditorSession` in `create-editor-session.ts` composes a collaborative
Macro editor from an authorized source identity, native view registry, platform
and loading span. Documents and collaborative surfaces use the same sync socket
route; their authorization adapters supply tokens from the appropriate endpoint.
Server-backed sessions always retain their actual access level.

The optional `installEditing` callback installs the surface's native UI port.
The returned runtime disposes that port before the view and session and closes
its own telemetry. The document feature's old primitive path re-exports this
shared implementation.

Local composers and static views use `mountLocalSessionView` from
`@macro-inc/lexical-wasm-view` instead. It disables transport, persistence and
cross-tab chatter and seeds a fresh local document before host imports. Supply
the correct native node/plugin preset; a title, calendar description and full
document do not share the same allowed nodes.
