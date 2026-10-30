# Type Alias: GithubSelector

> **GithubSelector** = \{ `actions?`: `string`[]; `events?`: `string`[]; `includeBots?`: `boolean`; `repositories?`: `string`[]; \}

Which GitHub deliveries match.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-actions"></a> `actions?` | `string`[] | Payload actions, such as `completed` or `opened`; any when empty. |
| <a id="property-events"></a> `events?` | `string`[] | GitHub event names, such as `workflow_run` or `pull_request`; any when empty. |
| <a id="property-includebots"></a> `includeBots?` | `boolean` | Also run for deliveries caused by bots and apps, including Macro's own. |
| <a id="property-repositories"></a> `repositories?` | `string`[] | Repositories as `owner/name`, matched without regard to case; every repository the owner's installations cover when empty. A renamed repository stops matching until it is chosen again. |
