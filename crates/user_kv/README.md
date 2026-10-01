# user_kv

A generic per-user key-value store. Each entry is a JSON object owned by one
user and addressed by a `namespace` and a `key`, e.g. namespace `tours`, key
`calendar`. Use it for small app state that doesn't need its own typed table.
In-app tour progress is the first use.

## Rules

- **Namespaces and keys:** 1–64 characters of `a-z`, `0-9`, `_`, `.` or `-`,
  starting with a letter or digit. Namespaces are free-form; pick one per use
  case and keep it stable.
- **Values:** a JSON object of at most 16 KiB as compact JSON. The store
  doesn't check the object's shape, so each use case parses and validates its
  own values and falls back to a default on anything it doesn't recognize.
- **Writes replace the whole value.** There is no partial update or conflict
  check: the last write wins.
- **Limit:** at most 1,000 entries per user across all namespaces.
- **Lifetime:** entries are deleted with the user.

## HTTP

Served by `document_storage_service` under `/user-kv`, for a signed-in user or
an internal caller acting for one:

| Method | Path | Does |
| --- | --- | --- |
| `GET` | `/user-kv/{namespace}` | The caller's entries in a namespace, ordered by key |
| `GET` | `/user-kv/{namespace}/{key}` | One entry (404 if missing) |
| `PUT` | `/user-kv/{namespace}/{key}` | Create or replace, body `{ "value": { … } }` |
| `DELETE` | `/user-kv/{namespace}/{key}` | Remove one entry (404 if missing) |

Errors are 400 for invalid slugs, bodies, or the entry limit, and 413 for
values over the size limit.

## Web

`apps/web/src/lib/queries/user-kv`:

- `useUserKvQuery(() => 'my-namespace')` reads a namespace. Gate reads on
  `isSuccess` so a pending query never suspends the view.
- `usePutUserKvMutation()` writes an entry, updating the cached namespace
  optimistically and rolling back on failure.

See `apps/web/src/features/tours/queries/tour-progress.ts` for a complete
example, including validating values on read.
