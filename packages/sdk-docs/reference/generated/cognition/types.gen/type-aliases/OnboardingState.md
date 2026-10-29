# Type Alias: OnboardingState

> **OnboardingState** = \{ `connected_servers`: [`ConnectedServer`](ConnectedServer.md)[]; `row`: [`OnboardingRow`](OnboardingRow.md); `suggested_team_domain?`: `string` \| `null`; \}

The onboarding aggregate served to the setup page. Import runs and
staged entities are served separately by `GET /import/state`.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-connected_servers"></a> `connected_servers` | [`ConnectedServer`](ConnectedServer.md)[] | The user's MCP server connections. |
| <a id="property-row"></a> `row` | [`OnboardingRow`](OnboardingRow.md) | The user's onboarding row. |
| <a id="property-suggested_team_domain"></a> `suggested_team_domain?` | `string` \| `null` | The account email's domain when it can back a domain team — i.e. it is not a generic consumer provider — `None` otherwise. Judged with the same list the teams service uses for domain auto-join and claiming, so the client never suggests a domain team the server would refuse. |
