# Type Alias: GetPendingProjectsHandlerResponses

> **GetPendingProjectsHandlerResponses** = \{ `200`: \{ `data`: ([`Project`](Project.md) & \{ `documentStatuses`: [`ProjectDocumentStatus`](ProjectDocumentStatus.md)[]; \})[]; `error`: `boolean`; \}; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-200"></a> `200` | \{ `data`: ([`Project`](Project.md) & \{ `documentStatuses`: [`ProjectDocumentStatus`](ProjectDocumentStatus.md)[]; \})[]; `error`: `boolean`; \} | - |
| `200.data` | ([`Project`](Project.md) & \{ `documentStatuses`: [`ProjectDocumentStatus`](ProjectDocumentStatus.md)[]; \})[] | Data to be returned |
| `200.error` | `boolean` | Indicates if an error occurred |
