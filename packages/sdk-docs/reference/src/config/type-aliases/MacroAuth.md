# Type Alias: MacroAuth

> **MacroAuth** = \{ `apiKey?`: `never`; `token`: [`TokenSource`](TokenSource.md); `type`: `"user"`; \} \| \{ `apiKey`: `string`; `token?`: `never`; `type`: `"user"`; \} \| \{ `scope?`: [`BotScope`](BotScope.md); `token`: [`TokenSource`](TokenSource.md); `type`: `"bot"`; \}

How the SDK authenticates with Macro.

A user has exactly one of two credential fields.

- `token`: a bearer token, or a `mak_` API key. The SDK picks the header
  from the prefix at send time.
- `apiKey`: a Settings → API Keys key, always sent as
  `x-macro-user-api-key`. Not prefix-checked, so keys that predate the
  `mak_` prefix work here.

A bot uses an `mbot_` token as `x-macro-bot-token` plus
`x-macro-bot-scope`, defaulting to `user` when `requestedAs` is set and
`team` otherwise.
