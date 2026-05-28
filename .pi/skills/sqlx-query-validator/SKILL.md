---
name: sqlx-query-validator
description: Inspect Rust changes for SQLx queries. Use after modifying Rust code that adds or changes SQLx queries to ensure compile-time SQLx macros are used, run `just prepare_db` for offline query cache, and review queries for performance and security issues.
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

When SQLx queries were changed, run this from `rust/cloud-storage`:

```bash
just prepare_db
```

If it fails, inspect the error. Fix in-scope query/cache issues and rerun `just prepare_db`. If it still fails for environmental reasons, stop and report the failure clearly.

## Performance Review Checklist

For each changed query, inspect the SQL and surrounding code for likely performance problems:

- Avoid unbounded result sets; prefer explicit `LIMIT`, pagination, or keyset pagination where applicable.
- Ensure filters and joins are likely backed by appropriate indexes for high-cardinality or frequently queried columns.
- Avoid `SELECT *` in production queries; select only needed columns.
- Avoid N+1 query patterns in loops; prefer batching or joins.
- Watch for leading-wildcard `LIKE` / `ILIKE` searches, broad JSON scans, or functions on indexed columns that may prevent index use.
- Check joins for accidental cross joins or missing join predicates.
- Prefer stable ordering for paginated queries.

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
- Any performance or security concerns found and fixed, or that none were found.
