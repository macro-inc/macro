# Type Alias: PromptAttachment

> **PromptAttachment** = \{ `mimeType?`: `string` \| `null`; `name`: `string`; `size?`: `number` \| `null`; `uri`: `string`; \}

A file the prompt refers to, by where the agent can fetch it.

Mirrors ACP's `resource_link` content block, which every agent must
accept: bytes never ride the prompt, only a URI (a static file service URL
in practice) with enough metadata for a client to render a chip and for
the agent to decide whether to fetch it. Keeping the wire shape ACP-native
means the harness translates without resolving anything, and the fold
reads the same fields back off the logged frame.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-mimetype"></a> `mimeType?` | `string` \| `null` | The file's media type, when known. |
| <a id="property-name"></a> `name` | `string` | Display name, typically the original file name. |
| <a id="property-size"></a> `size?` | `number` \| `null` | Size in bytes, when known. |
| <a id="property-uri"></a> `uri` | `string` | Where the agent can fetch the file. |
