# Type Alias: GetCrmPipelineRowsData

> **GetCrmPipelineRowsData** = \{ `body?`: `never`; `path`: \{ `id`: `string`; \}; `query?`: \{ `after?`: `string` \| `null`; \}; `url`: `"/crm/pipelines/{id}/rows"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `id`: `string`; \} | - |
| `path.id` | `string` | - |
| <a id="property-query"></a> `query?` | \{ `after?`: `string` \| `null`; \} | - |
| `query.after?` | `string` \| `null` | Continue after this row identity. |
| <a id="property-url"></a> `url` | `"/crm/pipelines/{id}/rows"` | - |
