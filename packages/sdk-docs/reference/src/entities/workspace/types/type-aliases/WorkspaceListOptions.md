# Type Alias: WorkspaceListOptions

> **WorkspaceListOptions** = [`WorkspaceFilters`](WorkspaceFilters.md) & \{ `emailPreset?`: `"signal"`; `emailView?`: `"inbox"` \| `"sent"` \| `"drafts"` \| `"starred"` \| `"all"` \| `"important"` \| `"other"` \| `` `user:${string}` ``; `favoritesOnly?`: `boolean`; `inbox?`: `string`; `includeTypes?`: [`WorkspaceType`](WorkspaceType.md)[]; `limit?`: `number`; `sortBy?`: `"recently_viewed"` \| `"recently_updated"` \| `"recently_created"`; `tags?`: \{ `label`: `string`; `scope?`: `"personal"` \| `"team"`; \}[]; `tagsMatch?`: `"any"` \| `"all"`; \}

Options shared by bounded pages and automatic iteration.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `emailPreset?` | `"signal"` | Important/signal email: overrides ef with Importance=true AND Shared=exclude. |
| `emailView?` | `"inbox"` \| `"sent"` \| `"drafts"` \| `"starred"` \| `"all"` \| `"important"` \| `"other"` \| `` `user:${string}` `` | Default inbox. Use signal + inbox for important emails, not the important view. |
| `favoritesOnly?` | `boolean` | - |
| `inbox?` | `string` | Connected inbox email address. Omit to include all accessible/delegated inboxes. |
| `includeTypes?` | [`WorkspaceType`](WorkspaceType.md)[] | Omitted or empty means all supported types; signal defaults to email when omitted. |
| `limit?` | `number` | Page size, default 50, clamped to 1–500. Iteration may fetch many pages. |
| `sortBy?` | `"recently_viewed"` \| `"recently_updated"` \| `"recently_created"` | Defaults to recently_updated, descending. |
| `tags?` | \{ `label`: `string`; `scope?`: `"personal"` \| `"team"`; \}[] | Case-insensitive labels resolved against the caller's personal/team tags. |
| `tagsMatch?` | `"any"` \| `"all"` | Default any. All rejects ambiguous unscoped labels rather than guessing. |
