# Type Alias: SendEmailResponse

> **SendEmailResponse** = \{ `sent`: \{ `message_id`: `string`; `thread_id`: `string`; \}; \} & \{ `convertedToDraft?`: `never`; \} \| \{ `convertedToDraft`: \{ `draft_id`: `string`; \}; \} & \{ `sent?`: `never`; \} \| `"userEdited"`

Response from the SendEmail tool.
