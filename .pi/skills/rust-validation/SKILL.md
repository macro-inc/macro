---
name: rust-validation
description: Validate Rust work after substantial Rust code changes by running `just check`, `just clippy`, then `just format`. Use before the final response after a significant Rust implementation or cleanup task; batch edits first instead of running after every small change.
allowed-tools: Bash Read Edit Glob Grep
---

# Rust Validation

Use this skill when you have changed Rust code or Rust build inputs and are nearing the end of a substantial implementation, refactor, or bug-fix task.

Do not run these commands after every individual edit. Batch related edits first, then validate once at the end of a major work pass or before handing the task back to the user.

## Working Directory

1. For this repository's main Rust services, run the validation from `rust/cloud-storage`.
2. If the user is clearly working in a different Rust subproject, use the nearest ancestor directory with a `justfile` that defines `check`, `clippy`, and `format`.
3. If there is no appropriate `justfile` or one of the required recipes is missing, stop and tell the user what prevented validation instead of inventing alternate commands.

## Validation Commands

Run these commands one at a time, in this exact order:

```bash
just check
just clippy
just format
```

If `just check` or `just clippy` fails, do not continue to later commands. Inspect the failure, fix it if it is in scope, then rerun the full sequence starting at `just check`.

If `just format` changes files, review the resulting changes before the final response.

## Final Response

Briefly report whether validation passed and list the commands that ran. If validation was skipped because no Rust code was changed, or because the user explicitly asked to skip it, say so.
