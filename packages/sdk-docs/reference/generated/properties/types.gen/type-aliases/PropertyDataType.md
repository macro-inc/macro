# Type Alias: PropertyDataType

> **PropertyDataType** = \{ `type`: `"boolean"`; \} \| \{ `type`: `"date"`; \} \| \{ `type`: `"number"`; \} \| \{ `type`: `"string"`; \} \| \{ `multi`: `boolean`; `options`: [`SelectNumberOption`](SelectNumberOption.md)[]; `type`: `"select_number"`; \} \| \{ `multi`: `boolean`; `options`: [`SelectStringOption`](SelectStringOption.md)[]; `type`: `"select_string"`; \} \| \{ `multi`: `boolean`; `specific_type?`: `null` \| [`EntityType`](EntityType.md); `type`: `"entity"`; \} \| \{ `multi`: `boolean`; `type`: `"link"`; \}

Data type with embedded options for requests - provides compile-time validation.
