# Type Alias: AgentPromptAction

> **AgentPromptAction** = \{ `attachments?`: [`PromptAttachment`](PromptAttachment.md)[]; `prompt`: `string`; \}

Ask the agent to work on something.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attachments"></a> `attachments?` | [`PromptAttachment`](PromptAttachment.md)[] | Files the prompt refers to, in the order the user attached them. Delivered after the text as one `resource_link` block each. |
| <a id="property-prompt"></a> `prompt` | `string` | What to tell the agent. |
