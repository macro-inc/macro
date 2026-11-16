# Preserved server encoder

These crates.io Loro and loro-internal1.16.2 distributions come from upstream
revision af130d97d8b110add13283fc5bfc81d97a9a609f. Preserve their MIT licenses.
The deployed sync worker and native Room replay use this encoder to retain exact Worker
transcript bytes; editor/session clients use Loro1.17.1 with the internal copy described in
../loro-editor/README.md. Both exchange
the existing protocol bytes. Shared support crates follow the workspace lock.

The sources are byte-identical to the crates.io 1.16.2 releases. The only change
is the top manifest's `path` to the adjacent internal crate, plus the local agent
guides and this README. `just check-loro-server-vendor` fails on any other drift.

Cargo cannot resolve two semver-compatible exact registry versions together.
The separate source keeps the server on 1.16.2 while the workspace crates.io
loro-internal patch selects the editor implementation under ../loro-editor.
Do not switch the server to the editor encoder or update golden bytes implicitly.
Run native Room replay and a fresh sync-service re-record with 155 zero normalized
differences before changing this boundary. This directory is excluded from the
workspace; consumer suites own validation. No third-party test expectation changes.

The upstream `loro-internal/benches/automerge-paper.json.gz` benchmark input is
omitted: no build or test here reads it, and its recorded edit trace carries
contributor email addresses. Restore it from the upstream release to run those
benches or examples.
