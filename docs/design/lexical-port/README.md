# Lexical port specification inputs

These six snapshots are the normative inputs to the traceability seed generator.
S4 section 0.2 defines the row semantics; R2 resolutions override earlier body text.
They describe the target design, including later work packages, rather than the
current implementation's completion status. References to uncopied sibling
specifications remain contextual design references.

Local checkout paths and personal attribution/contact examples are generalized
without inserting or deleting lines, preserving `S1:line` through `S8:line`
citations. The generator consumes only the files present here and the in-repo
fixture index; a private spec directory or upstream test checkout is unnecessary.

After a specification change, run `just lexical-coverage-seed`, then
`just lexical-coverage`, and review both generated diffs. Coverage evidence,
current gaps and the pending ratchet live in
[the traceability package](../../../packages/lexical-conformance/coverage/README.md).
