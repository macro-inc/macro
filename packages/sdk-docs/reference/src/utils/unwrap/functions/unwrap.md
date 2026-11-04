# Function: unwrap()

> **unwrap**\<`TData`, `TError`\>(`res`): `TData`

Turn a hey-api `{ data, error, response? }` result into either the success
payload or a thrown MacroApiError (MacroForbiddenError for a 403).

## Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-tdata"></a> `TData` |
| <a id="type-parameter-terror"></a> `TError` |

## Parameters

| Parameter | Type |
| ------ | ------ |
| `res` | \{ `data?`: `TData`; `error?`: `TError`; `response?`: `Response`; \} |
| `res.data?` | `TData` |
| `res.error?` | `TError` |
| `res.response?` | `Response` |

## Returns

`TData`
