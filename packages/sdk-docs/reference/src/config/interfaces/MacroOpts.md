# Interface: MacroOpts

Options passed to `new Macro(opts)` and stored on `MacroClient`.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-auth"></a> `auth?` | [`MacroAuth`](../type-aliases/MacroAuth.md) | How to authenticate. Takes precedence over `token`. Falls back to `MACRO_API_KEY` (a user API key or bearer token) or `MACRO_BOT_TOKEN` (bot). |
| <a id="property-env"></a> `env?` | [`Env`](../type-aliases/Env.md) | Which Macro environment to talk to. Falls back to the MACRO_ENV env var, then `'prod'`. |
| <a id="property-hosts"></a> `hosts?` | `Partial`\<`Record`\<[`ServiceName`](../type-aliases/ServiceName.md), `string`\>\> | Override individual service hosts (e.g. point one at localhost). |
| <a id="property-onrequest"></a> `onRequest?` | (`event`) => `void` | Optional generated API operation events; excludes arguments, URLs and response data. |
| <a id="property-requestedas"></a> `requestedAs?` | `string` | User id the bot acts for, sent as `x-macro-bot-for-macro-user-id` on every request. Bot auth only. Set via `macro.requestedAs(user)` rather than directly. |
| <a id="property-token"></a> `token?` | [`TokenSource`](../type-aliases/TokenSource.md) | Shorthand for `auth: { type: 'user', token }`. Accepts a Settings API key (`mak_…`) or a bearer token. |
| <a id="property-webappurl"></a> `webAppUrl?` | `string` | Override the web app base URL (e.g. for local frontend dev). Also reads MACRO_WEB_URL. |
| <a id="property-webhooksecret"></a> `webhookSecret?` | `string` | Signing secret for verifying incoming persisted-webhook deliveries. Required only for `macro.events.webhook()` / `macro.events.handle()`. SSE via `macro.events.listen()` uses the API token and does not need this. Falls back to MACRO_WEBHOOK_SECRET. |
| <a id="property-wsverify"></a> `wsVerify?` | `string` | - |
