The `mcp_service` acts as proxy to the auth server.

I believe this is needed because FusionAuth doesn't support DCR

(Official Docs)[https://modelcontextprotocol.io/docs/tutorials/security/authorization]
(Useful fusionauth article)[https://fusionauth.io/articles/ai/mcp-connecting-software-ai]

## Origin versus redirect URI

Two different values get checked during sign-in, by two different parties:

- The **origin** is the page a browser request comes from, sent as the `Origin`
  header or, on a navigation, the `Referer`. FusionAuth checks it against the
  application's authorized origins (`infra/stacks/fusionauth-instance/origins.ts`)
  and fails with `invalid_request: Invalid origin uri` when it is not listed.
  That list is for Macro's own apps that talk to FusionAuth directly, plus
  Google's sign-in pages, which send the browser back to FusionAuth.
- The **redirect URI** is where the authorization code is delivered. The broker
  checks it, as described in the next two sections. FusionAuth only ever
  redirects to the broker's own `/oauth/callback`.

MCP clients never talk to FusionAuth directly: the client opens the broker's
`/authorize`, which redirects the browser to FusionAuth. The browser would carry
the client page's `Referer` across that redirect, so a client page on an origin
FusionAuth does not list (`http://127.0.0.1:6274` for MCP Inspector, say) was
refused even though its redirect URI was fine. The `/authorize` redirect is sent
with `Referrer-Policy: no-referrer`, so FusionAuth sees no client origin and
third-party clients need no entry in the FusionAuth origin list. Whether a
client may sign in is decided only by its redirect URI.

## How a user signs in

`/authorize` first shows every client's user a chooser, because the client cannot
know how that user's account signs in. The chooser stores nothing; its form is
the same `/authorize` request with `sign_in` added.

- **Google** goes straight to Google through FusionAuth.
- **Email** is the one-time code the Macro app uses. `/authorize` records the
  pending flow and redirects to `email-sign-in`, the broker's own form. The form
  calls the authentication service's public endpoints
  (`outbound/email_sign_in.rs`), so its address checks, per-address rate limits,
  and signup policy apply as they do in the app. An address on a single sign-on
  domain is sent to its provider instead, on the same pending flow. The form is
  tied to the browser like the consent form, and a mistyped code leaves the flow
  pending: only a redeemed code consumes it.
- **Password** goes to FusionAuth's own login page. Accounts created by an emailed
  code have only a random password, so this is for accounts that set one, such as
  shared review accounts that cannot pass Google's challenges.

## Signing in from another machine

An MCP client on a server, reached over SSH or in a container, registers a
loopback redirect URI, but the user's browser is on a different machine, so a
redirect to it goes nowhere. The chooser therefore offers loopback clients an
option to finish elsewhere (`delivery=manual`). After sign-in, the broker shows
the client's callback URL instead of redirecting to it, for the user to either:

- paste into a client that asks for it, as `claude mcp login <name> --no-browser`
  does, or
- fetch with `curl` on the client's machine, which reaches the listener of any
  waiting loopback client, such as `codex mcp login <name>`, with no client support
  needed.

The authorization code still needs the client's PKCE verifier. Because the code
leaves the user's own machine, which is what made a loopback redirect trustworthy,
manual delivery goes through the consent screen first. The URL is shown inside a
command the user is told to run and registration is open, so a redirect URI with
anything that could break out of the quotes, or make `curl` and the broker
disagree about its host, cannot use it (`RedirectUriPolicy::allows_manual_delivery`).

The broker does not implement the device authorization grant (RFC 8628). The MCP
authorization spec does not include it and no client we checked requests it for
MCP servers, so advertising a `device_authorization_endpoint` would not change what
any user sees. Add it if a client starts using it.

## Which redirect URIs are usable

Dynamic client registration is open, because MCP clients require it. That means
the registered redirect URIs of a client prove nothing about who registered it:
anyone can register a client whose callback they control. FusionAuth also signs
in a user with an existing session without asking anything, so without another
check, anyone could register their own callback and send a Macro user a link
that silently hands them that user's code. A deployment-level policy
(`domain/redirect_uri.rs`) therefore sorts every redirect URI into one of three
groups, and a registration can only narrow what it allows:

- **Trusted, delivered directly.** `http` on a loopback host (`localhost`,
  `127.0.0.1`, `[::1]`), on any port (RFC 8252 section 7.3): a code sent there
  reaches a listener on the resource owner's own machine. Or `https` on a host
  listed in `MCP_ALLOWED_REDIRECT_HOSTS`, matched exactly; when that variable is
  unset the list falls back to `DEFAULT_MCP_ALLOWED_REDIRECT_HOSTS` in
  `services/agent_harness_service/src/public_mcp.rs`, which holds the
  browser-based MCP clients Macro has vetted. Subdomains of a listed host are
  not themselves trusted.
- **Delivered after consent.** `https` on any other host, such as a self-hosted
  MCP gateway. `/authorize` shows the consent screen described below before
  sending the user to sign in. So does a loopback redirect when the user asks to
  carry the code to another machine.
- **Refused.** Every other scheme, `http` off loopback, and any URI carrying a
  fragment or credentials in its authority.

Loopback hosts are interchangeable for this policy, but not for a registration:
a client that registered `http://localhost:6274/...` cannot have a code sent to
`http://127.0.0.1:6274/...`.

A new third-party HTTPS client needs no change at all: its users approve it on
the consent screen. Adding its callback host to the trusted list only skips that
screen, so reserve it for clients Macro has vetted. It needs no FusionAuth origin
either way.

Both endpoints that take a redirect URI apply the policy: `/register` refuses to
store one it refuses, and `/authorize` re-applies it before comparing against
the registration, so narrowing the policy takes effect for clients that
registered under a wider one.

## Consent and browser binding

`GET /authorize` for a redirect URI that needs consent renders a page naming the
host the code will go to (punycode for internationalized names, so a lookalike
cannot pass for the host it imitates) and the client's self-reported name,
marked as unverified, with control, bidirectional and zero-width characters
removed and its length capped. Nothing is stored until the user answers.
**Allow** posts the form back to `POST /authorize`, which starts sign-in;
**Cancel** shows a closing page and redirects nowhere, so the broker never
becomes a redirector to a host the user just refused.

Two checks keep a flow tied to the person approving it, using one random secret
in the `__Host-macro_mcp_oauth` cookie (`Secure`, `HttpOnly`, `SameSite=Lax`),
which `/authorize` sets on every flow past the chooser
(`domain/browser_binding.rs`). The email sign-in form is held to the same checks:

- **The consent form only counts from the browser that was shown it.** It
  carries a token derived from the cookie's secret, compared in constant time.
  A cross-site post carries no `SameSite=Lax` cookie, a page on another origin
  cannot read the token, and a `Sec-Fetch-Site` other than `same-origin` is
  refused outright, so no other page can approve on the user's behalf. The page
  sets `frame-ancestors 'none'` and `X-Frame-Options: DENY`, so it cannot be
  framed for clickjacking, and loads and runs nothing.
- **Only the browser that started a flow can finish it.** The pending
  authorization stores a digest of the secret, and `/oauth/callback` refuses a
  callback whose cookie does not match. Without this, someone could approve
  their own flow and send a victim the FusionAuth sign-in URL it produced; the
  victim's existing session would complete it silently and deliver the victim's
  code to the starter's client. The binding applies to trusted clients too.

A pending authorization written by a build before the binding has no digest; the
callback accepts one only when its redirect URI is trusted, which is all that
build could have stored.

## Which client a grant belongs to

Public clients hold no credential, so `client_id` is the only client identity
the broker ever receives. It is not a secret and does not authenticate anyone.
It is still checked everywhere, because a grant that is not tied to a client can
be redeemed by anything that gets hold of it:

- `/authorize` requires a `client_id` with a live registration, and requires the
  request's `redirect_uri` to appear in that registration exactly.
- `/token` requires a `client_id` on both grants. An authorization code is only
  redeemable by the client it was issued to, and a refresh token only by the
  client that obtained it.

Refresh tokens are bound to their client by SHA-256 digest, so the binding store
never holds a token that could be replayed if read. The binding rotates on every
refresh: the new token is bound before the superseded one is dropped, so a
replay of a token the broker has already rotated past finds no binding and is
refused.

Access tokens are recorded the same way, so the `/mcp` route can tell which
client a request comes from: both grants bind the access token they hand out to
the same client and grant, through the same `RefreshTokenBindingStore`, under a
SHA-256 digest taken with a fixed prefix so it can never match a refresh token's
binding (`domain/access_token_clients.rs`). The bearer middleware reads the
binding and the client's registered `client_name` and attaches the request's
caller (`ai_toolset::ToolCaller`) for the tools, which label what the client
writes "via <client_name>". The name is self-reported at `/register`: a display
label, never an identity or permission. A token issued before its binding was
recorded carries no name; the client's next refresh records one. Reading the
records only through the existing ports keeps them working on any store
backend.

Refresh tokens issued before this scheme existed have no binding, so the clients
holding them authorize once more. Rate limiting of `/register` belongs at the
edge; the broker bounds each registration's size but not how many a caller may
create.

## Which MCP server a token is for

The broker signs clients in for two MCP servers, which a client names with the
RFC 8707 `resource` parameter (`domain/resource.rs`):

- **The harness's public MCP** (`McpPublicUrl` + `/mcp`). It gets the
  FusionAuth access token, and labels what the client writes from that token's
  recorded client (previous section). Any `resource` other than the ChatGPT
  server's, or none, is for this server: deployed clients send whatever
  resource they derive from the URL their user configured (the gateway URL, a
  bare origin), so the broker does not refuse one it does not recognize.
- **The ChatGPT MCP server** (`McpChatgptServiceUrl` + `/mcp`, a Cloudflare
  Worker). It passes its bearer unchanged to Macro's APIs, which accept a
  FusionAuth token but cannot look up its client, so writes would show as the
  user's own. This resource gets a Macro API token instead, minted at `/token`
  for the same user through the `MacroApiTokenMinter` port: the Macro bot via
  the client's registered name, the attribution public MCP's `ExecuteCode`
  signs. It expires with the FusionAuth token it was minted from, and the
  refresh token stays FusionAuth's, so a refresh naming this resource mints a
  fresh one.

Only the ChatGPT server's exact URL (a trailing slash aside) selects it; a
lookalike such as its bare origin or an `http` URL gets the harness's token.
The resource is not stored with the code: it changes only which credential for
the same user and client is returned, so `/token` decides from its own
`resource`, which MCP clients send on both grants. A ChatGPT refresh that omits
it gets a FusionAuth token, which Macro's APIs accept without the client label.

## Token endpoint errors

`/token` answers errors in the RFC 6749 section 5.2 JSON shape
(`{"error", "error_description"}`, `Cache-Control: no-store`). The status says
who has to act:

- `400 invalid_request` or `unsupported_grant_type`: the request is malformed.
- `400 invalid_grant`: the code or refresh token is unusable, whether the
  broker refused it (unbound, another client's, revoked grant) or FusionAuth
  did (for example `refresh_token_not_found`). Retrying cannot help; the client
  must authorize again.
- `503 temporarily_unavailable`: FusionAuth is down or throttling. A `Retry-After`
  from a throttling response (429) is passed on; one on a 5xx is not.
- `502 server_error`: FusionAuth answered with something else.

FusionAuth's error and reason are logged with the client and grant ids,
never the token itself, and are not returned to the client.

## Disconnecting a client

`/revoke` implements RFC 7009 and is advertised as `revocation_endpoint` in
the authorization server metadata. A client disconnecting from Macro posts its
refresh token there as a form:

```
POST /revoke
Content-Type: application/x-www-form-urlencoded

token=<refresh token>&token_type_hint=refresh_token&client_id=<client id>
```

`client_id` is required (`401 invalid_client` without it) and is the client
authentication RFC 7009 asks for: these are public clients, so the request must
come from the client the refresh token is bound to. Another client's
`client_id` gets `400 invalid_grant` and leaves the grant untouched.

A revocation revokes the whole grant, not just the presented token. Every
refresh token rotated out of one authorization code shares the grant id on its
binding, and the broker records the grant as revoked for as long as any binding
can outlive it, so no token from the family is refreshed again. It also revokes
the token in FusionAuth and drops its binding. Each step is idempotent and the
binding goes last, so a client that sees a `503` can retry. A token the broker
does not hold (never issued, expired, or already revoked) gets `200`, as RFC
7009 section 2.2 requires.

Access tokens, FusionAuth JWTs or Macro API tokens, are not revocable: presenting one gets
`400 unsupported_token_type`. Revocation does not cut them short, so an access
token issued before the revocation stays valid until it expires. Every token
response carries `expires_in`, which is that remaining window; FusionAuth signs
them for one hour (`ttlSeconds` in `infra/stacks/fusionauth-instance`).
