# Type Alias: LogFrameDto

> **LogFrameDto** = \{ `content`: \{\[`key`: `string`\]: `unknown`; \}; `direction`: [`LogDirectionDto`](LogDirectionDto.md); \}

The two fields [`AgentSessionLogEntryDto`] flattens in.

Schema only. Nothing constructs one: the entry serializes through
[`Message`], and this exists so the generated clients see `direction` and
`content` as named fields instead of an open map. A hand-built copy could
drift from the fold's wire format, and the point of the endpoint is that it
cannot - so this describes that format without being able to produce it.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-content"></a> `content` | \{\[`key`: `string`\]: `unknown`; \} | The protocol envelope, verbatim. Opaque here: it is Agent Runtime Protocol, whose shape belongs to the fold rather than this endpoint. |
| <a id="property-direction"></a> `direction` | [`LogDirectionDto`](LogDirectionDto.md) | Which way the frame travelled. |
