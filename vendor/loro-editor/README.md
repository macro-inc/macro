# Editor Loro internal source

This is the crates.io loro-internal 1.17.1 distribution from upstream revision
`ef83c083f19aea0d590a46db2d541b3a5daf1339`. Public Loro and the TS peer stay 1.17.1;
this changes neither the release pin nor the encoder/format.

Registry archive SHA-256: `7e533c1688430aa4fcdd933f00861e331c169a4158ee6d27d054e0558892d447`.
The MIT license is retained from that exact upstream revision. Upstream agent
guidance is retained as UPSTREAM-AGENTS.md. Optional author metadata, registry
cache markers, standalone lockfiles and the redundant unnormalized manifest are
omitted. The exact upstream dev-utils helper is restored as a development-only
dependency for standalone tracker tests; it is absent from production dependency trees.

Local runtime change: assign each dense text-tracker update range through a
checked slice fill instead of repeated checked SmallVec indexing. LeafIndex is
Copy; input order, bounds/debug checks and resulting leaf assignment remain the
same, including overlapping and empty ranges. Encoder/serializer code and corpus
expectations are untouched. The preserved 1.16.2 server copy uses the same change.

Validate ordered range updates against the existing sequential update algorithm,
consumer tests, exact replay, and a fresh Worker re-record with 155 zero normalized
differences. Keep this path dependency outside workspace membership.
