# Upstream Loro test utilities

## What it is

Exact test logging/allocation helper from upstream revision
ef83c083f19aea0d590a46db2d541b3a5daf1339, omitted by the published internal crate.

## Scope

- Development dependency of the two internal Loro copies only.
- Never link its global allocator or tracing initialization into production.
- Preserve its source and MIT notice; this is not application test infrastructure.

## Checks

- Run the two standalone internal-crate dense_batch tests from their manifests.
- Verify the worker dependency tree excludes dev-utils.
