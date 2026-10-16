# Type Alias: SelectableRepository

> **SelectableRepository** = \{ `defaultBranch?`: `string`; `url`: `string`; \}

A GitHub repository the caller can point a managed session at.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-defaultbranch"></a> `defaultBranch?` | `string` | The branch its clones check out, and where a session starts unless `createManaged` names another. Absent for a repository with no commits. |
| <a id="property-url"></a> `url` | `string` | The canonical `https://github.com/owner/name` URL, as `createManaged` takes it. |
