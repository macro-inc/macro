A lib defining a `ContextConsumer` trait and a `ContextProviderStruct`. 

Context is provided by services and processed in the `insight_service`. Context is then aggregated and passed to consumers to generate insight.

The `chat_insight_context` lib defines a context consumer for DCS(chat)