# Collaborative session differential

Run from repository root:

```sh
bunx vitest run --config packages/lexical-conformance/diff/collab.config.mts
bunx tsc --noEmit -p packages/lexical-conformance/diff/collab/tsconfig.json
```

Two native document sessions and two current TypeScript editors exchange real
Loro updates through a FIFO server relay with scheduled delivery and offline
windows. The TypeScript peers use the actual mirror, reconcile and collaborative
history modules, each with its own DOM document. Loro is the app's 1.17.1 pin.

Three fixed seeds each execute 2,000 operations, comparing all four editor JSON
states and native deep values after complete delivery. A literal additionally
checks own undo/redo after another peer edits. Remote normalization can briefly
be pending on TypeScript's microtask boundary; equality is strict at quiescence.
`COLLAB_STEPS` permits smoke runs; acceptance uses the default 2,000.

Failure tapes, scheduler reports and state dumps are written under
`target/lexical-collab-failures`. These artifacts do not automatically shrink
into Tier A fixtures. Retain a literal regression for every native defect found.
The native bridge is a development-only example behind the conformance feature.
