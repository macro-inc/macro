# Interface: ListenOptions

Options for [MacroEvents.listen](../classes/MacroEvents.md#listen).

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-filters"></a> `filters?` | [`WebhookFilter`](../../../../generated/storage/types.gen/type-aliases/WebhookFilter.md)[] | Event/entity-id filters, identical to persisted webhook `filters`. Defaults to one filter covering every event currently registered with [MacroEvents.on](../classes/MacroEvents.md#on). |
| <a id="property-scope"></a> `scope?` | [`WebhookScope`](../../../../generated/storage/types.gen/type-aliases/WebhookScope.md) | Personal or team workspace whose webhook lifecycle events are delivered. Defaults to `'user'`. |
| <a id="property-signal"></a> `signal?` | `AbortSignal` | Abort the stream. |
