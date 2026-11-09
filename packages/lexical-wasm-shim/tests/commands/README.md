# Core command and constant source contract

`src/commands.ts` owns the 49 pinned core command objects and `createCommand`.
Commands are unique mutable objects, not names or numeric IDs. Re-export these
same bindings from the root; do not recreate them in a root barrel or wrapper.
`KEY_DOWN_COMMAND.type` deliberately retains upstream's `KEYDOWN_COMMAND` spelling.

The command wrapper type is a canonical primitive type-only alias. Recursive
clipboard payloads and command listeners refer to the actual node, selection and
editor types. The type fixture checks those edges without nominal upstream core
classes or casts. No engine is required to create a command.

`src/constants.ts` preserves pinned flags, maps, regexes, update tags and listener
priorities, including negative before-priority values. It uses the shared view
environment flags; there is no new environment detector. `TextDetailType` is the
pinned private string alias because the root does not export it. The copied maps
retain upstream mutability and spellings.

`exports.json` records every source value/type export for root integration.
Some constants are internal to upstream core and are not root re-exports; use the
pinned root inventory when integrating. Existing root/editor/backend files are
not changed by this slice.

`src/commands-source.json` pins all copied source inputs to the immutable upstream
0.45 commit and source fingerprint. The focused test config checks every source
hash before loading the original modules. Runtime comparisons use those original
source modules; compiler paths use their real installed original declarations.
Neither is an ambient stub. The suite compares all command descriptors,
identity across consumers, constants and tags. A child process disables all
WebAssembly access before cold import; the bundle input graph rejects upstream
runtime/editor/backend dependencies.

From the package with the actual immutable upstream source available:

```sh
LEXICAL_UPSTREAM_SOURCE=/absolute/upstream-source TMPDIR=/tmp \
  node node_modules/vitest/vitest.mjs run --config tests/commands/vitest.config.mts
node node_modules/typescript/bin/tsc -p tests/commands/tsconfig.json
```

The focused Vite cache is under `TMPDIR`. These source/identity/cold-evaluation
checks do not prove root namespace completeness, native command dispatch, browser
behavior or production initialization; those integration gates remain separate.
