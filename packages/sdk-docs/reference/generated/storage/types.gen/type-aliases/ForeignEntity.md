# Type Alias: ForeignEntity

> **ForeignEntity** = \{ `createdAt`: `string`; `foreignEntityId`: `string`; `foreignEntitySource`: `string`; `id`: `string`; `metadata`: `unknown`; `storedForAuthEntity`: `string`; `storedForId`: `string`; `updatedAt`: `string`; \}

A persisted mapping to an entity owned by an external system.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-createdat"></a> `createdAt` | `string` | Timestamp when the record was created. |
| <a id="property-foreignentityid"></a> `foreignEntityId` | `string` | Identifier assigned by the external system. |
| <a id="property-foreignentitysource"></a> `foreignEntitySource` | `string` | Source system that owns the external identifier. |
| <a id="property-id"></a> `id` | `string` | Internal primary key for this foreign entity record. |
| <a id="property-metadata"></a> `metadata` | `unknown` | Arbitrary metadata stored with the mapping. |
| <a id="property-storedforauthentity"></a> `storedForAuthEntity` | `string` | Internal auth entity namespace this foreign entity is stored for. |
| <a id="property-storedforid"></a> `storedForId` | `string` | Internal entity identifier this foreign entity is stored for. |
| <a id="property-updatedat"></a> `updatedAt` | `string` | Timestamp when the record was last updated. |
