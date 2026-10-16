# Type Alias: ExcludedDefaultView

> **ExcludedDefaultView** = \{ `defaultViewId`: `string`; `id`: `string`; `userId`: `string`; \}

Frontend can define any set of its own default views for the user.
This is a list of views that are excluded from the default views list on the frontend.

It is important that the frontend can quickly iterate on default views, for that reason
we don't keep track of default views in the database, only those that are explicitly excluded.

## Properties

| Property | Type |
| ------ | ------ |
| <a id="property-defaultviewid"></a> `defaultViewId` | `string` |
| <a id="property-id"></a> `id` | `string` |
| <a id="property-userid"></a> `userId` | `string` |
