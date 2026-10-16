# Type Alias: SoupItem

> **SoupItem** = \{ `data`: [`SoupDocumentSoupPropertiesField`](SoupDocumentSoupPropertiesField.md); `tag`: `"document"`; \} \| \{ `data`: [`SoupChatSoupPropertiesField`](SoupChatSoupPropertiesField.md); `tag`: `"chat"`; \} \| \{ `data`: [`SoupProjectSoupPropertiesField`](SoupProjectSoupPropertiesField.md); `tag`: `"project"`; \} \| \{ `data`: [`SoupInitiativeSoupPropertiesField`](SoupInitiativeSoupPropertiesField.md); `tag`: `"initiative"`; \} \| \{ `data`: [`SoupEnrichedEmailThreadPreviewSoupPropertiesField`](SoupEnrichedEmailThreadPreviewSoupPropertiesField.md); `tag`: `"emailThread"`; \} \| \{ `data`: [`SoupChannel`](SoupChannel.md); `tag`: `"channel"`; \} \| \{ `data`: [`SoupChannelThread`](SoupChannelThread.md); `tag`: `"channelThread"`; \} \| \{ `data`: [`SoupCallRecordSoupPropertiesField`](SoupCallRecordSoupPropertiesField.md); `tag`: `"call"`; \} \| \{ `data`: [`SoupCalendarEventSoupPropertiesField`](SoupCalendarEventSoupPropertiesField.md); `tag`: `"calendarEvent"`; \} \| \{ `data`: [`SoupCrmCompanySoupPropertiesField`](SoupCrmCompanySoupPropertiesField.md); `tag`: `"crmCompany"`; \} \| \{ `data`: [`SoupCrmContactSoupPropertiesField`](SoupCrmContactSoupPropertiesField.md); `tag`: `"crmContact"`; \} \| \{ `data`: [`SoupForeignEntity`](SoupForeignEntity.md); `tag`: `"foreignEntity"`; \} \| \{ `data`: [`SoupAgentSessionSoupPropertiesField`](SoupAgentSessionSoupPropertiesField.md); `tag`: `"agentSession"`; \} \| \{ `data`: [`SoupDatabaseRowSoupPropertiesField`](SoupDatabaseRowSoupPropertiesField.md); `tag`: `"databaseRow"`; \}

A single item in the Soup feed.

## Union Members

### Type Literal

\{ `data`: [`SoupDocumentSoupPropertiesField`](SoupDocumentSoupPropertiesField.md); `tag`: `"document"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `data` | [`SoupDocumentSoupPropertiesField`](SoupDocumentSoupPropertiesField.md) | Document item. |
| `tag` | `"document"` | - |

***

### Type Literal

\{ `data`: [`SoupChatSoupPropertiesField`](SoupChatSoupPropertiesField.md); `tag`: `"chat"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `data` | [`SoupChatSoupPropertiesField`](SoupChatSoupPropertiesField.md) | Chat item. |
| `tag` | `"chat"` | - |

***

### Type Literal

\{ `data`: [`SoupProjectSoupPropertiesField`](SoupProjectSoupPropertiesField.md); `tag`: `"project"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `data` | [`SoupProjectSoupPropertiesField`](SoupProjectSoupPropertiesField.md) | Project item. |
| `tag` | `"project"` | - |

***

### Type Literal

\{ `data`: [`SoupInitiativeSoupPropertiesField`](SoupInitiativeSoupPropertiesField.md); `tag`: `"initiative"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `data` | [`SoupInitiativeSoupPropertiesField`](SoupInitiativeSoupPropertiesField.md) | Initiative entity. |
| `tag` | `"initiative"` | - |

***

### Type Literal

\{ `data`: [`SoupEnrichedEmailThreadPreviewSoupPropertiesField`](SoupEnrichedEmailThreadPreviewSoupPropertiesField.md); `tag`: `"emailThread"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `data` | [`SoupEnrichedEmailThreadPreviewSoupPropertiesField`](SoupEnrichedEmailThreadPreviewSoupPropertiesField.md) | Email thread item. |
| `tag` | `"emailThread"` | - |

***

### Type Literal

\{ `data`: [`SoupChannel`](SoupChannel.md); `tag`: `"channel"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `data` | [`SoupChannel`](SoupChannel.md) | Channel item. |
| `tag` | `"channel"` | - |

***

### Type Literal

\{ `data`: [`SoupChannelThread`](SoupChannelThread.md); `tag`: `"channelThread"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `data` | [`SoupChannelThread`](SoupChannelThread.md) | Channel thread item. |
| `tag` | `"channelThread"` | - |

***

### Type Literal

\{ `data`: [`SoupCallRecordSoupPropertiesField`](SoupCallRecordSoupPropertiesField.md); `tag`: `"call"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `data` | [`SoupCallRecordSoupPropertiesField`](SoupCallRecordSoupPropertiesField.md) | Call record item. |
| `tag` | `"call"` | - |

***

### Type Literal

\{ `data`: [`SoupCalendarEventSoupPropertiesField`](SoupCalendarEventSoupPropertiesField.md); `tag`: `"calendarEvent"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `data` | [`SoupCalendarEventSoupPropertiesField`](SoupCalendarEventSoupPropertiesField.md) | Calendar event item. |
| `tag` | `"calendarEvent"` | - |

***

### Type Literal

\{ `data`: [`SoupCrmCompanySoupPropertiesField`](SoupCrmCompanySoupPropertiesField.md); `tag`: `"crmCompany"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `data` | [`SoupCrmCompanySoupPropertiesField`](SoupCrmCompanySoupPropertiesField.md) | CRM company item. |
| `tag` | `"crmCompany"` | - |

***

### Type Literal

\{ `data`: [`SoupCrmContactSoupPropertiesField`](SoupCrmContactSoupPropertiesField.md); `tag`: `"crmContact"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `data` | [`SoupCrmContactSoupPropertiesField`](SoupCrmContactSoupPropertiesField.md) | Team-owned CRM contact. |
| `tag` | `"crmContact"` | - |

***

### Type Literal

\{ `data`: [`SoupForeignEntity`](SoupForeignEntity.md); `tag`: `"foreignEntity"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `data` | [`SoupForeignEntity`](SoupForeignEntity.md) | Foreign entity item. |
| `tag` | `"foreignEntity"` | - |

***

### Type Literal

\{ `data`: [`SoupAgentSessionSoupPropertiesField`](SoupAgentSessionSoupPropertiesField.md); `tag`: `"agentSession"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `data` | [`SoupAgentSessionSoupPropertiesField`](SoupAgentSessionSoupPropertiesField.md) | Agent session item. |
| `tag` | `"agentSession"` | - |

***

### Type Literal

\{ `data`: [`SoupDatabaseRowSoupPropertiesField`](SoupDatabaseRowSoupPropertiesField.md); `tag`: `"databaseRow"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `data` | [`SoupDatabaseRowSoupPropertiesField`](SoupDatabaseRowSoupPropertiesField.md) | Database row item. |
| `tag` | `"databaseRow"` | - |
