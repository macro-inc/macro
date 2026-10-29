# Type Alias: SuggestedEvent

> **SuggestedEvent** = `"email.message_received"` \| `"task.created"` \| `"document.created"` \| `"call.started"` \| `"call.ended"`

Workspace-wide events a suggestion may start from. Events scoped to
specific channels, documents, or tasks are left out: they need the user to
pick those first.
