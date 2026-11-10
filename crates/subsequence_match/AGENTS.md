# subsequence_match

## What it is

Pure Unicode normalization and ordered-subsequence matching for server contact search.

## Scope

- Owns: normalization, token eligibility, and corpus-independent match quality.
- Not here: authorization, pagination, database reads, ranking, or surface-specific boosts.
- Used by: `contacts`.

## Checks

- `cargo test -p subsequence_match`

## Gotchas

- Keep this crate dependency-free; do not pull backend infrastructure into matching.
- Inputs to `subsequence_score` are normalized by the caller. SQL wildcards are
  ordinary characters here; SQL adapters escape their bound patterns separately.
