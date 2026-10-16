# Type Alias: ElicitationContentValue

> **ElicitationContentValue** = `string` \| `boolean` \| `number` \| `number` \| `string`[]

A value ACP accepts in an elicitation answer.

Mirrors ACP's `ElicitationContentValue` so that the contract a caller
answers against is the closed union ACP will accept, rather than arbitrary
JSON narrowed on the way out. An object, a null, or a mixed array is
refused when the request is deserialized - where the caller learns of it -
instead of at send time, when the elicitation slot has already been
released.
