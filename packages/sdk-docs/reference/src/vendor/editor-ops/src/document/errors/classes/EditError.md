# Class: EditError

Raised by `DocumentEditor` when the AI references a node id that doesn't exist
or violates a sanity check, and by `Doc` when an edit fails to resolve at apply
time. The tool catches it and reports the message straight back to the model.

## Extends

- `Error`

## Constructors

### Constructor

> **new EditError**(`message`): `EditError`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `message` | `string` |

#### Returns

`EditError`

#### Overrides

`Error.constructor`
