# Type Alias: FavoritesFilter

> **FavoritesFilter** = \{ `entityIds?`: `string`[]; `entityTypes?`: [`MacroEntityType`](../../../entity/type-aliases/MacroEntityType.md)[]; \}

Which favorites to list.

The two dimensions are independent. Within one, the values are alternatives;
between them they are both required, so `entityTypes: ['document']` with
`entityIds: [a, b]` matches only documents `a` and `b`. An omitted or empty
list constrains nothing, which is why the default lists the whole collection.

## Properties

| Property | Type |
| ------ | ------ |
| <a id="property-entityids"></a> `entityIds?` | `string`[] |
| <a id="property-entitytypes"></a> `entityTypes?` | [`MacroEntityType`](../../../entity/type-aliases/MacroEntityType.md)[] |
