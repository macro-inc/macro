# PR and Snapshot decorator hosts

## Current canonical package

This fixture now imports the canonical ordinary document-session package built
by `just build-document-session-wasm` in `apps/web`. It does not load a private
`wasm/` or `wasm-root-id/` directory. Before a new run, build that package, run
`bun scripts/check-decorator-browser-wasm.ts`, then typecheck with
`bun ../../node_modules/typescript-native/bin/tsc --noEmit --skipLibCheck --project tsconfig.decorator-browser-tests.json`.
The current Playwright config requires the real outputs, checks their declaration
against the generated consumer ABI, and records their actual hashes in metadata.
A missing output or mismatched declaration fails; there is no stub or skip.

## Archived build evidence

Earlier manifests, seal-specific descriptions and captured evidence describe
the archived builds, not this canonical target. Reproduce those runs only with
their archived fixture source and matching artifacts. They do not qualify a new
canonical-package run, and the typecheck change supplies no new browser result.

This cohort mounts the actual Source wrapper, nodes, components, selection
plugin and metadata registration. It freezes the factory's exported model,
then imports that exact string before either editor first decorates it.

The PR query resolves through the actual service client at a controlled
HTTP boundary. The test checks the derived label and URL, selection, Normal
Enter, and the real hover preview. Snapshot uses a supplied preview-cache
entry and exercises its actual popup removal menu. Captures retain model,
editor DOM, shadow DOM and portaled popup markup.

Each run verifies the exact compiled Vite maps and HTTP-served pristine
Lexical and code-core dependency bytes. The config checks all files from
its pinned native seal.

No split manager is installed in this fixture. Enter's handled result and
the application's unavailable-navigation boundary are recorded explicitly.
These tests do not establish destination rendering or backend permission
checks. Native action acceptance requires the matching compiled producer.

The default gate includes standard imports and Source-admitted null optional
labels/mention UUIDs. The latter stay null in both the model and the projector.
UI-only input types admit them while the public node prop declarations remain
unchanged. Source preimage epochs may select one cohort through
REFERENCE_STANDARD_ONLY or REFERENCE_NULLABLE_ONLY.
