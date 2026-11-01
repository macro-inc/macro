# Function: wrapXml()

> **wrapXml**(`tag`, `data`): `string`

Serialize a mention node to its `<tag>{json}</tag>` wire form. Readers take
everything up to the first closing tag, so `<`, `>` and `&` in the JSON are
written as `\u` escapes: a document named `</m-document-mention>` would
otherwise end the tag early. Decoding the JSON restores the original text.

## Parameters

| Parameter | Type |
| ------ | ------ |
| `tag` | `string` |
| `data` | `unknown` |

## Returns

`string`
