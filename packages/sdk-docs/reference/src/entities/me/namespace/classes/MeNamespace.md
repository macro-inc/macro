# Class: MeNamespace

The authenticated user's own profile.

## Constructors

### Constructor

> **new MeNamespace**(`client`): `MeNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`MeNamespace`

## Methods

### update()

> **update**(`options`): `Promise`\<`void`\>

Set your display name and profile picture. Agents should do this after
signing in, so teammates can tell who they are working with.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | [`UpdateMeOptions`](../interfaces/UpdateMeOptions.md) |

#### Returns

`Promise`\<`void`\>

#### Example

```ts
const image = await macro.images.upload(bytes, {
  fileName: 'avatar.png',
  contentType: 'image/png',
});
await macro.me.update({ name: 'Research Agent', profilePicture: image });
```
