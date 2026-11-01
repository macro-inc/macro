# Type Alias: MessageParent

> **MessageParent** = \{ `id`: `string`; `type`: `"channel"`; \} \| \{ `id`: [`DocumentId`](DocumentId.md); `type`: `"document"`; \} \| \{ `id`: `string`; `type`: `"initiative"`; \} \| \{ `id`: `string`; `type`: `"crm_company"`; \} \| \{ `id`: `string`; `type`: `"crm_contact"`; \} \| \{ `id`: `string`; `type`: `"call"`; \}

The entity whose permissions and lifecycle govern a message.

## Union Members

### Type Literal

\{ `id`: `string`; `type`: `"channel"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `id` | `string` | A channel, including direct messages. |
| `type` | `"channel"` | - |

***

### Type Literal

\{ `id`: [`DocumentId`](DocumentId.md); `type`: `"document"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `id` | [`DocumentId`](DocumentId.md) | A document, including tasks and PDFs. |
| `type` | `"document"` | - |

***

### Type Literal

\{ `id`: `string`; `type`: `"initiative"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `id` | `string` | An initiative, presented as a project in the application. |
| `type` | `"initiative"` | - |

***

### Type Literal

\{ `id`: `string`; `type`: `"crm_company"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `id` | `string` | A CRM company. |
| `type` | `"crm_company"` | - |

***

### Type Literal

\{ `id`: `string`; `type`: `"crm_contact"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `id` | `string` | A CRM contact. |
| `type` | `"crm_contact"` | - |

***

### Type Literal

\{ `id`: `string`; `type`: `"call"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `id` | `string` | A video call and its persistent chat thread. |
| `type` | `"call"` | - |
