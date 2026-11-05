# Type Alias: SavedViewConfig

> **SavedViewConfig** = `Record`\<`string`, `unknown`\> & \{ `kind`: `string`; `version`: `number`; \}

A saved view's configuration. Its shape belongs to the app surface that
shows it, named by `kind` (`email`, `task`) and versioned by `version`; see
`docs/design/saved-views.md` for each kind's filters.

## Type Declaration

| Name | Type |
| ------ | ------ |
| `kind` | `string` |
| `version` | `number` |
