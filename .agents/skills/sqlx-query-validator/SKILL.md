---
name: sqlx-query-validator
description: Inspect Rust changes for SQLx queries. Use after modifying Rust code that adds or changes SQLx queries to ensure compile-time SQLx macros are used, run `just prepare_db` for offline query cache, and review queries for security issues. Writing a query and measuring its plan is the query-writing skill; reviewing a diff's query cost is query-review.
allowed-tools: Bash Read Edit Glob Grep
---

# SQLx Query Validator

Use this skill after substantial Rust changes that add, remove, or modify SQLx queries.

This is a focused review pass, not something to run after every edit. Batch related Rust changes first, then validate the changed queries before handing the task back to the user.

## Scope Changed Rust Code

1. From the repository root, identify changed Rust files using the repository's VCS:

   - If a `.jj` directory exists at the repository root, use Jujutsu:

     ```bash
     jj diff --name-only
     ```

   - Otherwise, use Git:

     ```bash
     git diff --name-only
     ```

2. Inspect changed `.rs` files for SQLx usage, including:
   - `sqlx::query`
   - `sqlx::query_as`
   - `sqlx::query_scalar`
   - `sqlx::query_file`
   - imported variants such as `query(...)`, `query_as(...)`, `query_scalar(...)`, or `query_file(...)`
   - macro variants such as `sqlx::query!`, `sqlx::query_as!`, `sqlx::query_scalar!`, and `sqlx::query_file!`

3. If no SQLx queries were changed, say so in the final response and do not run `just prepare_db` unless the user explicitly asked for it.

## Require SQLx Macros

Prefer compile-time checked SQLx macros for changed queries:

- `sqlx::query!`
- `sqlx::query_as!`
- `sqlx::query_scalar!`
- `sqlx::query_file!`

Flag changed code that calls SQLx query functions directly, such as:

```rust
sqlx::query("SELECT ...")
sqlx::query_as::<_, MyType>("SELECT ...")
sqlx::query_scalar("SELECT ...")
```

Replace direct function calls with the equivalent macro whenever the SQL text is static enough for SQLx to check at compile time.

Only allow direct SQLx query functions when the SQL must be dynamically assembled and cannot reasonably be expressed with a macro. In that case:

- Keep dynamic fragments constrained to trusted allowlists, not raw user input.
- Bind all values with `.bind(...)`; never interpolate user-controlled values into SQL strings.
- Add or preserve a clear comment explaining why a macro cannot be used.

## Refresh SQLx Offline Cache

When SQLx queries were changed, run this from the repository root:

```bash
just prepare_db
```

If it fails, inspect the error. Fix in-scope query/cache issues and rerun `just prepare_db`. If it still fails for environmental reasons, stop and report the failure clearly.

## Performance

This skill does not check query cost. The author writes and measures each
query with the [`query-writing`](../query-writing/SKILL.md) skill before
committing it, and the [`query-review`](../query-review/SKILL.md) skill checks
it before the push (through the [`review`](../review/SKILL.md) skill). If a
changed query has no measured plan yet, run `query-writing` on it now.

## Security Review Checklist

For each changed query, inspect for security issues:

- No string interpolation, `format!`, concatenation, or raw user input in SQL text.
- User-controlled values must be passed as SQLx bind parameters.
- Dynamic identifiers, order-by fields, directions, table names, and column names must come from trusted allowlists.
- Avoid leaking sensitive data by selecting or returning columns that are not needed.
- Verify tenant, organization, user, or access-control predicates are present where the surrounding domain requires them.
- Be cautious with destructive statements (`DELETE`, `UPDATE`, `INSERT ... ON CONFLICT`) and ensure predicates are correctly scoped.

## Final Response

Briefly summarize:

- Which changed SQLx queries were reviewed.
- Whether all changed queries use SQLx macros, or why any direct function call remains justified.
- Whether `just prepare_db` passed, failed, or was skipped because no SQLx queries changed.
- Any security concerns found and fixed, or that none were found.
- Whether each changed query has a measured plan from `query-writing`.
