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

## Which redirect URIs are usable

Dynamic client registration is open, because MCP clients require it. That means
the registered redirect URIs of a client prove nothing about who registered it:
anyone can register a client whose callback they control. So a client's
registration is not the only check on where a code may go — a deployment-level
policy decides which destinations are usable at all, and a registration can only
narrow that set further.

A redirect URI is usable when it is either:

- `http` on a loopback host (`localhost`, `127.0.0.1`, `[::1]`), on any port.
  RFC 8252 section 7.3. A code sent here reaches a listener on the resource
  owner's own machine, so it cannot leave the user who authorized it.
- `https` on a host listed in `MCP_ALLOWED_REDIRECT_HOSTS`, matched exactly.
  When that variable is unset the list falls back to
  `DEFAULT_MCP_ALLOWED_REDIRECT_HOSTS` in `services/agent_harness_service/src/public_mcp.rs`,
  which holds the browser-based MCP clients Macro supports. Subdomains of a
  listed host are not themselves trusted.

Loopback hosts are interchangeable for this policy, but not for a registration:
a client that registered `http://localhost:6274/...` cannot have a code sent to
`http://127.0.0.1:6274/...`.

A new third-party HTTPS client therefore needs exactly one change: its callback
host added to `DEFAULT_MCP_ALLOWED_REDIRECT_HOSTS` (or the deployment's
`MCP_ALLOWED_REDIRECT_HOSTS`). It needs no FusionAuth origin. Registering through
DCR alone is not enough, on purpose: FusionAuth signs in a user with an existing
session without showing a consent screen, so if any registered HTTPS host were
usable, anyone could register their own callback and send a Macro user a link
that hands them that user's code.

A redirect URI carrying a fragment or credentials in its authority is refused
regardless of host.

Both endpoints that take a redirect URI apply the policy: `/register` refuses to
store one it does not permit, and `/authorize` re-applies the policy before
comparing against the registration, so narrowing the host list takes effect for
clients that registered under a wider one.

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

Access tokens are FusionAuth JWTs and are not revocable: presenting one gets
`400 unsupported_token_type`. Revocation does not cut them short, so an access
token issued before the revocation stays valid until it expires. Every token
response carries `expires_in`, which is that remaining window; FusionAuth signs
them for one hour (`ttlSeconds` in `infra/stacks/fusionauth-instance`).
