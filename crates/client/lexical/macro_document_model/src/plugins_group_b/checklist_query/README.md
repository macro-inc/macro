# Checklist plan application query

`group-b.checklist-plan` is one explicit initial/on-demand read of a current
**direct-root checklist**. It uses the existing WASM query kind 9 and FFI
`application_query(name, payload, generation)` bridge. Both reject a retired
model generation before decoding the payload. The GroupB child repeats the
current-state generation check for direct callers. Unknown names remain available
to other query children. No BOP, binding method, callback or UI is added.

The request is strictly decoded JSON (unknown fields and wrong types reject):

- `listKey`: current-generation u32 node index. The enclosing generation applies
  to this index. Root, stale, missing, ordinary-list and nested-list targets
  reject; they are not missing-metadata/default-plan observations.
- `tasks`: lookup object from actual task ID to `{statusOptionId, priorityOptionId,
  assigneeIds, due}`. Option IDs and due are strings or nullish; assigneeIds is a
  required string array. These are externally resolved provider facts.
- `names`: actual name-resolution map, string ID to string label. Empty labels
  remain empty. It has Map lookup semantics, not Object.prototype semantics.
- `calendar`: `{today, dueDates}`. `today` is an observation; dueDates maps exact
  due strings to `{kind:"invalid"}` or `{kind:"valid", observation}`.

An observation is `{instantMs, local, startOfDay}`. `local` contains integer
`year, month, day, hour, minute, second, millisecond` from actual Date getters.
`startOfDay` is `{kind:"invalid"}` or `{kind:"valid", instantMs, local}` from
cloning that actual Date and calling setHours(0,0,0,0). Valid original/invalid
midnight remains supported. Do not send a JS bucket/day delta or replace local
fields with UTC getters. Rust retains all calendar/filter/progress policy from
the pure planner. See request-example.json for a complete raw UTC observation.

The host cannot supply metadata, settings or rows. They are collected from the
actual current retained editor state; the query neither mutates state nor caches
provider facts. The target must have actual supported direct-root collection
coverage. A successful response includes `listKey:{index,generation}` and one tag:

- `planned`: effective `items`, normalized `settings`, ordered `rows`, `active`,
  `filterCount`, `hasTasks` and `progress:{done,total,ratio,percentage}`. Each item
  contains its actual key, leadingKeys/attachedKeys, checked/text/taskId,
  status/priority/assignees/due. Row keys have index/generation; each row has
  dimmed. Status and priority values are the pure planner's pinned source values;
  absent priority is null. Maybe-valued taskId, due and assignee IDs use explicit
  `{kind:"missing"}`, `{kind:"null"}` or `{kind:"value",value:string}` so absence
  is not collapsed to null.
- `unsupportedInput`: `field` and exact serialized `settingsContext`. This is a
  whole-result coverage gap, never a partial plan or a Source exception/default.
  For external reserved-key facts the settings are context, not the offending
  fact. Noncanonical settings and referenced reserved task/status/priority keys
  retain the pure planner's explicit coverage boundary.
- `invalidCalendarFacts`: a `problem` discriminated by `kind`: invalidCivilDate
  (year/month/day), invalidInstant (instantMs), invalidLocalTime (all local
  fields), or missingDueObservation (due). Invalid representations or missing
  required parse facts never silently become an undated item.

No native task fetching, parsing clock, timer, facts cache or consumer activation
is installed. This query must not be called once per list after every edit.
Initial mount may query all mounted lists once. Steady plan delivery needs a
separate explicit facts-revision input and native publication sidecar; that
producer and its measured crossing budget are not established by this query.
