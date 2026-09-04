Browse the user's Macro workspace (the unified inbox) by writing a GraphQL query
against the schema below. This is the tool for "catch me up", "what happened
today", "list my tasks", "important emails since Friday", recent items by kind,
by project, by tag, or by time window. It reads; it cannot change anything.
For finding an item by words in its name or body use NameSearch/ContentSearch.

Rules
- Exactly one `query` operation. Mutations and subscriptions do not exist here.
- Filters are per kind: an item of kind K passes if K's tree is absent or matches.
  Date windows (createdAt/updatedAt) exist on document, project, chat and email
  trees only; other kinds are cut by sortMethod + limit.
- Macro tasks are DOCUMENT items with subType TASK. Prefer `taskFilter` for
  status, assignee, and priority — do not invent property definition ids.
- Tags: filter by label with input.tags (ListTags shows them); results carry
  tags { label scope }. Status/Priority values come back as option ids.
- Prefer emailPreset: SIGNAL for "important"/"signal" email; keep emailView as
  inbox (or omit it). For a user label pass emailView: "user:<name>".
- There is no cursor. If hasMore is true, tighten filters or raise limit (≤500).
- Select `id` on every `items` selection so results can be linked.
- Alias `soup` to ask two questions in one call (max 5). Example: activity and
  signal email.
- Anything not shown: { __type(name: "GraphqlEmailLiteral") { inputFields { name type { name ofType { name } } } } }
