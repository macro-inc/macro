---
name: dump-schema
description: Dump clean Postgres schema to a file and copy path to clipboard.
allowed-tools: Bash
---

# Dump Schema

Dump a clean PostgreSQL schema (no comments, no ownership, no privileges) from the local dev database.

## Parameters

Ask the user (if not provided):
- **output_file** – absolute path for the `.sql` file (default: prompt user)

Use this database URL unless the user specifies otherwise:
```
postgres://user:password@localhost:5432/macrodb
```

## Steps

1. Run `pg_dump` with schema-only flags, pipe through cleanup, write to file:

```bash
pg_dump --schema-only --no-owner --no-privileges --no-comments --no-publications --no-subscriptions --no-security-labels --no-tablespaces "$DB_URL" | sed '/^--/d' | sed '/^SET /d' | sed '/^SELECT pg_catalog/d' | sed '/^$/N;/^\n$/d' > "$OUTPUT_FILE"
```

2. Copy the output path to the clipboard:

```bash
echo -n "$OUTPUT_FILE" | pbcopy
```

3. Report: `Schema dumped to <path> (path copied to clipboard)`
