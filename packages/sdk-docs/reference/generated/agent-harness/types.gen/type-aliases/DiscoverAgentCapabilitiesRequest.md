# Type Alias: DiscoverAgentCapabilitiesRequest

> **DiscoverAgentCapabilitiesRequest** = \{ `harness`: [`CapabilityHarnessDto`](CapabilityHarnessDto.md); `harnessId?`: `string` \| `null`; `model?`: `string` \| `null`; \}

HTTP request selecting one provider to probe.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-harness"></a> `harness` | [`CapabilityHarnessDto`](CapabilityHarnessDto.md) | Provider to probe. |
| <a id="property-harnessid"></a> `harnessId?` | `string` \| `null` | Required for macrod and forbidden for other targets. |
| <a id="property-model"></a> `model?` | `string` \| `null` | Model whose session settings should be inspected. |
