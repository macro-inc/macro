# outlook_emulator

## What it is

Test support for the Email feature: a stateful fake of the Microsoft Graph
mail API and the Microsoft identity platform our email and sign-in code call.
The real `email_api_client` Outlook adapter, `email_service` and its workers,
FusionAuth's `microsoft` identity provider and the authentication service's
Outlook link run against it, in a `cargo test`, as a standalone process or as
part of a local stack, without Microsoft accounts.

## How it works

- `OutlookEmulator::start(seed)` listens on a `127.0.0.1` port; `cargo run -p
  outlook_emulator -- --seed <file>` is the same emulator as a process.
- It holds any number of mailboxes. An access token names its mailbox, so
  `/me` is whoever the bearer token belongs to. Unknown, expired and revoked
  tokens answer 401.
- Every change (delivery, send, update, move, delete) gets the mailbox's next
  sequence number. A folder's delta round reads the changes after its delta
  token, in pages linked by skip tokens; a message that left the folder is
  reported `@removed`. As measured against Graph, a page holds as many
  entries as the request's `Prefer: odata.maxpagesize` asks for (10 without
  it), the round ends on the first short page, and `$top` caps the whole
  round. A token from before `expire_delta_tokens`, or older
  than the mailbox's `delta_token_lifetime_days`, answers 410
  `SyncStateNotFound`.
- `POST /subscriptions` posts a validation token to the notification URL and
  the lifecycle URL and stores the subscription only if both echo it. After
  that a message change posts a change notification; `send_lifecycle` posts
  `reauthorizationRequired`, `subscriptionRemoved` or `missed`.
- Sending moves the draft to Sent Items under the same id and delivers a copy
  to every recipient that is a mailbox here.
- Every mailbox is also a Microsoft user. `/{tenant}/oauth2/v2.0/authorize`
  is a page that lists them in place of Microsoft's account picker and
  consent screen; picking one redirects back with an authorization code,
  which `/{tenant}/oauth2/v2.0/token` exchanges for an access token, a
  refresh token and an ID token. The ID token carries Microsoft's issuer
  (`https://login.microsoftonline.com/{tid}/v2.0`) and is signed by a key the
  emulator generates and serves at `/{tenant}/discovery/v2.0/keys`, named by
  `/{tenant}/v2.0/.well-known/openid-configuration`. `/oidc/userinfo` names
  the token's user, and `/{tenant}/v2.0/adminconsent` is the admin-consent
  page.
- Refreshing answers a new access token and a further refresh token; the
  earlier refresh tokens keep working until the grant is revoked.
- A local stack with no real Microsoft client runs it as the
  `outlook_emulator` sidecar (`xtask_local`'s `microsoft_emulator.rs`), seeded
  from `seed.example.yaml`.
- `/_emulator/…` is the control API; each route calls the `OutlookEmulator`
  method of the same purpose.

## Start here

- `src/lib.rs`: `OutlookEmulator`, its URLs and its control methods.
- `src/seed.rs`: the seed file (YAML or JSON) and `NewMessage`;
  `seed.example.yaml` is one that a test keeps valid.
- `src/mailbox.rs`: folders, messages, the change sequence, contacts, the
  request limit; `src/mailbox/delta.rs`: a folder's delta rounds.
- `src/state.rs`: tokens, faults, the clock, subscriptions, `send` and
  delivery between mailboxes.
- `src/graph.rs`: what every request passes (token, faults, request limit),
  the route table and the request log; `src/graph/` holds the handlers.
- `src/odata.rs`: the `$select`, `$top`, `$skip`, `$orderby`, `$filter` and
  `$expand` forms it understands. `src/render.rs`: Graph's JSON.
- `src/notify.rs`: subscription validation and notification delivery.
- `src/oauth.rs`: Microsoft's token endpoint and the authentication-service
  stand-in. `src/control.rs`: `/_emulator/`.
- `src/sign_in.rs` and `templates/`: the sign-in and admin-consent pages,
  authorization codes, ID tokens, the discovery document, keys and userinfo.
  `src/signing_key.rs`: the key ID tokens are signed with.
- `src/test/`: the real client against the emulator.

## Scope

- Owns: the Graph mail endpoints the email code calls, plus `$batch` and the
  send-at-once reply and forward actions, which it does not call yet; and what
  the sign-in and Outlook link code use of the Microsoft identity platform.
- Not here: Graph calendar; Gmail; SQS, Postgres and
  the other Macro services a local `email_service` needs.

## Recipes

- In a test: `OutlookEmulator::start(Seed::parse(yaml)?)`, then
  `OutlookApiClientRepository::for_graph_url(&MicrosoftGraphUrl::from(emulator.graph_url()))`
  and `emulator.access_token("a@example.com")`.
- Point a local `email_service` and `pubsub_workers` at it:
  `OVERRIDE_MICROSOFT_GRAPH_URL=<base>/v1.0/`, and
  `OVERRIDE_AUTH_SERVICE_URL=<base>/_emulator/authentication-service` to get
  grants and access tokens without the authentication service. Bind the OAuth
  attempt, and then the link `/email/init` answers, to a mailbox with
  `POST /_emulator/mailboxes/{email}/links/{id}` (or `link_id` in the seed).
  Set `OUTLOOK_CONNECTIONS_ENABLED`, `OUTLOOK_SYNC_ENABLED` and
  `OUTLOOK_WRITES_ENABLED`.
- Point sign-in and Outlook linking at it:
  `OVERRIDE_MICROSOFT_LOGIN_URL=<base>/` for the authentication service's
  calls and, as the browser reaches it,
  `OVERRIDE_MICROSOFT_LOGIN_PAGE_URL=<base>/`; give FusionAuth's `microsoft`
  provider the issuer `<base>/common/v2.0`. When services and the browser
  reach the emulator at different addresses, start it with `--public-url`
  (services) and `--browser-url` (browser): the discovery document names the
  page on the second and everything else on the first. A local stack does all
  of this by itself.
- Sign in without a browser: `POST /{tenant}/oauth2/v2.0/authorize` with the
  authorization request's parameters as a form, plus `user=<email>`; the
  `Location` header carries the code. `cancel=1` or `admin_approval=1` in
  place of `user` answers a declined consent or "Need admin approval".
- Subscriptions need HTTPS, as with Graph: the watch worker only subscribes
  for an `https://` `OVERRIDE_EMAIL_SERVICE_URL`, and the emulator refuses
  other notification URLs unless started with
  `--allow-http-notification-urls`. Put a TLS front before the service and
  pass its certificate authority with `--trust-certificate`.
- New mail: `POST /_emulator/mailboxes/{email}/messages` (`deliver`). A change
  made in Outlook: `PATCH`/`DELETE …/messages/{id}`. Provider failure:
  `POST /_emulator/faults` (`inject_fault`) with a `route` such as
  `messages.get` and an `error` such as `rate_limit`. Time:
  `POST /_emulator/clock/advance`. What it received: `GET /_emulator/requests`;
  what it sent subscribers: `GET /_emulator/notifications`.
- Add a Graph endpoint: a `Route` variant in `src/fault.rs` → an arm in the
  route table of `src/graph.rs` that calls `ctx.enter(route)` first → a
  handler in `src/graph/` → a test in `src/test/` that calls it with the real
  client.

## Checks

- `cargo test -p outlook_emulator`

## Gotchas

- It only listens where it is told to, `127.0.0.1` by default. Never give it
  real mail or real tokens.
- Responses are Graph's shapes, not ours: build them in `src/render.rs`, not
  from `models_email` types. HTML bodies come back wrapped in a document, as
  Exchange stores them, and `internetMessageHeaders` only when selected.
- A query option, `$filter`, `$expand` or `$select` property it does not
  understand answers 400, and an unknown path answers 400 with no route in
  the request log. Add support instead of loosening that: a silent default
  would hide a query our code starts sending.
- Links (`@odata.nextLink`, `@odata.deltaLink`, upload URLs) are on the
  emulator's own origin, because the client refuses to send its bearer token
  to a host other than its Graph root. Delta links use the OData key form
  (`mailFolders('id')`), as Graph's do.
- Waiting is event driven (`wait_for_notifications`); don't add sleep loops.
- The authentication-service stand-in is not a Microsoft API. It exists so the
  service can run without FusionAuth, and answers like the real routes: 404
  for an unknown link, 401 for a revoked grant.
- ID tokens name Microsoft's issuer, not the emulator's address, because
  `fusionauth` only accepts Microsoft's. The discovery document says the same,
  as Microsoft's does for `common`. Tokens are dated by the real clock, the
  one their verifier reads; everything else follows the emulator's clock.
- The signing key is generated on first use (a few seconds in a debug build)
  and differs per emulator. Don't commit a key: the secret scan refuses it.
- The emulator accepts any client id and secret. A code is bound to the
  client id, redirect URI and PKCE challenge it was issued for, and is
  redeemed once.
- Microsoft's consent is all or nothing, so the page has no checkboxes:
  picking a user grants every scope asked for, added to what the mailbox's
  grant already covers. A seeded mailbox starts with the mail scopes granted.
- A mailbox has one grant. A consent after a revocation starts a new one with
  new refresh tokens; the revoked ones stay dead. That includes a plain
  sign-in, which Microsoft would keep apart from the mail grant.
- A user seeded with `unverified_email_domain: true` gets ID tokens without
  `xms_edov`, which the `microsoft` provider's reconcile lambda refuses.

## Related

- Rules: `.agents/rules/config-and-service-urls.md` ·
  `crates/email_api_client/AGENTS.md`
