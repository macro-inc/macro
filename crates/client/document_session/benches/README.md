# Native bulk measurements

Run from the worktree root inside its devshell, with an owned target directory:

```sh
TMPDIR=/home/wolf/tmp CARGO_BUILD_JOBS=2 CARGO_TARGET_DIR="$PWD/target" \
  direnv exec . cargo bench -p document_session --bench bulk -j2 -- \
  --save-baseline codec-before 'json-parse|json-serialize|markdown-export'
```

Use a fresh baseline name for each exact source. Compare with
`--baseline codec-before` in place of `--save-baseline codec-before`.
Keep source hashes, build provenance and Criterion estimates/sample files with
each result. The measurement rejects invalid or excessive one-minute host load
above 150 before and after every timing interval.

The checked-in synthetic Markdown seeds under
`packages/lexical-conformance/bench/docs` prepare the same S/M/L model shapes.
Each cell uses 20 samples, one second of warmup and a three-second measurement
target; slow cells can exceed that target. The filter above intentionally omits
the separate Markdown import experiment.

JSON parse includes node and link construction in a detached state and excludes
`set_editor_state` and publication. JSON serialization includes node export and
JavaScript-compatible encoding. These are native portable model measurements.
They do not measure WASM transport, collaboration, DOM reconciliation or browser
performance, and cannot establish a Rust/upstream browser ratio.
