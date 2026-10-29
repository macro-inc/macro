# Type Alias: SearchSuggestions

> **SearchSuggestions** = [`QuerySearchSuggestions`](QuerySearchSuggestions.md) & \{ `type`: `"all"`; \} \| [`ChannelSearchSuggestions`](ChannelSearchSuggestions.md) & \{ `type`: `"channels"`; \} \| [`QuerySearchSuggestions`](QuerySearchSuggestions.md) & \{ `type`: `"document-or-file"`; \} \| [`TaskSearchSuggestions`](TaskSearchSuggestions.md) & \{ `type`: `"task"`; \} \| [`EmailSearchSuggestions`](EmailSearchSuggestions.md) & \{ `type`: `"email"`; \} \| [`CallSearchSuggestions`](CallSearchSuggestions.md) & \{ `type`: `"calls"`; \} \| [`QuerySearchSuggestions`](QuerySearchSuggestions.md) & \{ `type`: `"folders"`; \} \| [`QuerySearchSuggestions`](QuerySearchSuggestions.md) & \{ `type`: `"agent"`; \} \| [`QuerySearchSuggestions`](QuerySearchSuggestions.md) & \{ `type`: `"calendar"`; \}

Only the selected type's fields can appear in a search suggestion.
