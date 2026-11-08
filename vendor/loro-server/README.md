# Preserved server encoder

These crates.io Loro and loro-internal1.16.2 distributions come from upstream
revision af130d97d8b110add13283fc5bfc81d97a9a609f. Preserve their MIT licenses.
The sync server and native Room replay use this encoder to retain exact Worker
transcript bytes; editor/session clients use Loro1.17.1 with the internal copy described in
../loro-editor/README.md. Both exchange
the existing protocol bytes. Shared support crates follow the workspace lock.

Local changes: the top manifest selects the adjacent internal crate; its encoder
drops an unused HasIdSpan import because shared types now provide inherent methods.
Dense tracker ranges use an equivalent checked slice fill, with sequential-update
parity tests; assignment order, bounds and debug checks remain unchanged. The
unpublished upstream dev-utils helper is restored as a development-only dependency
for those standalone tests.
Agent guides are local; the upstream internal guide is retained as UPSTREAM-AGENTS.md.
Trailing whitespace is trimmed in README.md and Encoding.md. No encoder algorithm,
state transition, serializer, protocol, format or corpus expectation is changed.

Cargo cannot resolve two semver-compatible exact registry versions together.
The separate source keeps the server on 1.16.2 while the workspace crates.io
loro-internal patch selects the editor implementation under ../loro-editor.
Do not switch the server to the editor encoder or update golden bytes implicitly.
Run native Room replay and a fresh sync-service re-record with 155 zero normalized
differences before changing this boundary. This directory is excluded from the
workspace; consumer suites own validation. No third-party test expectation changes.
