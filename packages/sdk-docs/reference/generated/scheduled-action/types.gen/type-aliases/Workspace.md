# Type Alias: Workspace

> **Workspace** = \{ `agents?`: [`WorkspaceAgent`](WorkspaceAgent.md)[]; `channels?`: [`NamedItem`](NamedItem.md)[]; `folders?`: [`NamedItem`](NamedItem.md)[]; `labels?`: `string`[]; `people?`: [`NamedItem`](NamedItem.md)[]; `tags?`: [`WorkspaceTag`](WorkspaceTag.md)[]; \}

The items AI may name in a draft. They are data for the model; saving
checks every id the draft uses.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-agents"></a> `agents?` | [`WorkspaceAgent`](WorkspaceAgent.md)[] | Agents a step may hand the run to. |
| <a id="property-channels"></a> `channels?` | [`NamedItem`](NamedItem.md)[] | - |
| <a id="property-folders"></a> `folders?` | [`NamedItem`](NamedItem.md)[] | Projects. |
| <a id="property-labels"></a> `labels?` | `string`[] | Email label names. |
| <a id="property-people"></a> `people?` | [`NamedItem`](NamedItem.md)[] | - |
| <a id="property-tags"></a> `tags?` | [`WorkspaceTag`](WorkspaceTag.md)[] | Tag options, by the property definition they belong to. |
