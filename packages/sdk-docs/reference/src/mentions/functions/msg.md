# Function: msg()

> **msg**(`strings`, ...`values`): [`RichMessage`](../interfaces/RichMessage.md)

Compose a rich message. Interpolate mentions (a User, Document,
[here](../variables/here.md), …) or plain strings. Each mention writes its `<m-*>` tag into the
content *and* adds itself to `mentions[]`, so the two can never drift; strings
are inserted as-is, so markdown like `**bold**` passes through untouched.

## Parameters

| Parameter | Type |
| ------ | ------ |
| `strings` | `TemplateStringsArray` |
| ...`values` | [`Interpolation`](../type-aliases/Interpolation.md)[] |

## Returns

[`RichMessage`](../interfaces/RichMessage.md)

## Example

```ts
channel.send(msg`Hey ${user}, see ${doc}. cc ${here}`);
channel.send(msg`Status: ${status} — see ${doc}`);
```
