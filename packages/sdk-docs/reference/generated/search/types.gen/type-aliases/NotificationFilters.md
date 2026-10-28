# Type Alias: NotificationFilters

> **NotificationFilters** = \{ `states?`: [`NotificationState`](NotificationState.md)[]; \}

Notification-level filters that apply to an entity type.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-states"></a> `states?` | [`NotificationState`](NotificationState.md)[] | Include entities with a non-deleted notification in any of these exact states. Empty means no notification restriction. Active means `[unseen, seen]`. |
