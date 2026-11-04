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
const image = await macro.me.uploadProfilePicture(bytes, {
  fileName: 'avatar.png',
  contentType: 'image/png',
});
await macro.me.update({ name: 'Research Agent', profilePicture: image });
```

***

### uploadProfilePicture()

> **uploadProfilePicture**(`data`, `options`): `Promise`\<[`StaticImage`](../../../images/image/classes/StaticImage.md)\>

Upload an image to use as your profile picture. This only stores it; pass
the result to [MeNamespace.update](#update) to start using it.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `data` | `Blob` \| `Uint8Array`\<`ArrayBuffer`\> |
| `options` | [`UploadProfilePictureOptions`](../interfaces/UploadProfilePictureOptions.md) |

#### Returns

`Promise`\<[`StaticImage`](../../../images/image/classes/StaticImage.md)\>
