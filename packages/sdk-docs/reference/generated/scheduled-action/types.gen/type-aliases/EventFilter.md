# Type Alias: EventFilter

> **EventFilter** = \{ `condition?`: `string` \| `null`; `events`: [`EventName`](EventName.md)[]; `github?`: `null` \| [`GithubSelector`](GithubSelector.md); `ids?`: `string`[] \| `null`; `labels?`: `string`[] \| `null`; `match?`: [`PayloadCondition`](PayloadCondition.md)[] \| `null`; \}

An event name AND an entity ID must match within the same filter. A
condition further requires the event's content to answer it with yes.

`github` comes from outside Macro and carries its payload: it stands
alone in its filter, takes no ids, and may require
exact payload values with `match`. A `github` filter narrows deliveries
with its `github` selector.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-condition"></a> `condition?` | `string` \| `null` | Yes/no question about the triggering content, e.g. "Is this email an invoice?". The routine runs only when the answer is yes. |
| <a id="property-events"></a> `events` | [`EventName`](EventName.md)[] | - |
| <a id="property-github"></a> `github?` | `null` \| [`GithubSelector`](GithubSelector.md) | - |
| <a id="property-ids"></a> `ids?` | `string`[] \| `null` | - |
| <a id="property-labels"></a> `labels?` | `string`[] \| `null` | Email label names, any one of which the event must carry: the labels a received message arrived with, or the labels just added to a thread. Compared ignoring case. Only email received and email label filters take it; `None` matches any label, or none. |
| <a id="property-match"></a> `match?` | [`PayloadCondition`](PayloadCondition.md)[] \| `null` | Exact tests on the payload, all of which must pass. |
