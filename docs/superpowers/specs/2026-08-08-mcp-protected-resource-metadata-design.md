# Design: RFC 9728 protected resource metadata for Macro MCP

**Date:** 2026-08-08  
**Status:** Approved for implementation planning  
**Scope:** `services/mcp_auth_proxy`  
**Related failure:** Grok Build (rmcp 2.1.0) OAuth hangs on authenticate (`i`) because protected resource metadata omits the required `resource` field.

## Problem

Macro’s MCP OAuth broker publishes protected resource metadata for resource
`{public_url}/mcp`. Per RFC 9728 §3, valid discovery locations for that
resource are:

| Route | Role |
|-------|------|
| `/.well-known/oauth-protected-resource/mcp` | Path insertion for resource `…/mcp`. Also the URL in `WWW-Authenticate` `resource_metadata`. |
| `/mcp/.well-known/oauth-protected-resource` | RFC-allowed alternative (well-known under the resource path). Same document. |
| `/.well-known/oauth-protected-resource` | Origin well-known (pre-existing). Continues to serve the same `/mcp` document for SEP-style clients that probe the origin; not a pure origin-resource identifier under a strict reading of RFC 9728 §3. |

Production currently returns approximately:

```json
{
  "authorization_server": "https://mcp-server.macro.com",
  "authorization_servers": ["https://mcp-server.macro.com"]
}
```

That document is incomplete under **RFC 9728** (*OAuth 2.0 Protected Resource Metadata*, Standards Track, April 2025).

Grok’s MCP client (rmcp 2.1.0) validates protected resource metadata and fails with:

> Protected resource metadata missing required resource field

when `resource` is absent. OAuth never advances past discovery when the user presses `i` in the Grok TUI.

## Normative requirements (RFC 9728)

Source: [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728.html) §2 and §3.3.

| Parameter | RFC level | Decision for this change |
|-----------|-----------|---------------------------|
| `resource` | **REQUIRED** | **Add** |
| `authorization_servers` | OPTIONAL | **Keep** (already present; needed for MCP client AS discovery) |
| `resource_name` | **RECOMMENDED** | **Add** |
| `scopes_supported` | **RECOMMENDED** | **Omit** (see below) |
| `bearer_methods_supported` and other optional fields | OPTIONAL | **Out of scope** |

### Why omit `scopes_supported`

RFC 9728 marks `scopes_supported` as RECOMMENDED, but §3.2 also requires:

> Parameters with zero values MUST be omitted from the response.

Macro’s MCP broker does not define resource-level OAuth scopes for the MCP endpoint. Access is granted via a Macro user JWT after the FusionAuth-backed authorization-code flow. FusionAuth scopes (`openid`, `profile`, `email`, `offline_access`) are identity/AS scopes, not MCP resource scopes.

Publishing invented scopes (e.g. `read` / `write`) or identity scopes as resource scopes would be inaccurate. Omitting `scopes_supported` is the honest, RFC-consistent choice until Macro defines a real MCP scope model.

### `resource` value validation

RFC 9728 §3.3: when metadata is obtained via the `WWW-Authenticate` `resource_metadata` URL, the returned `resource` value **MUST** be identical to the URL the client used to request the protected resource. Otherwise the client **MUST NOT** use the metadata.

Clients connect to Macro MCP at `{mcp_public_url}/mcp` (production: `https://mcp-server.macro.com/mcp`). Therefore:

```text
resource = "{public_url}/mcp"
```

where `public_url` is the existing `McpAuthProxyServiceImpl` base URL (same base used for authorize/token/register endpoints).

## Goals

1. Make protected resource metadata valid for RFC 9728 **required** fields.
2. Include the **recommended** `resource_name` field.
3. Unblock MCP OAuth discovery for strict clients (Grok/rmcp and peers).
4. Keep the change small, reviewable, and limited to the auth proxy metadata response.

## Non-goals

- Authorization Server metadata (RFC 8414) improvements (e.g. `token_endpoint_auth_methods_supported`).
- FusionAuth OAuth `state` JSON-quoting cleanup.
- Defining a Macro MCP OAuth scope model.
- Product documentation site updates (optional follow-up).
- Changes outside `services/mcp_auth_proxy` unless tests require a thin addition in-crate.

## Design

### Component

| Unit | Responsibility |
|------|----------------|
| `McpAuthProxyService::protected_resource_metadata` | Build the JSON document for `/mcp` PRM |
| Axum PRM routes | Serve the same metadata on origin, path-insertion, and path-style well-known URLs |
| `WWW-Authenticate` middleware | Unchanged; already points at `/.well-known/oauth-protected-resource/mcp` |

### Target metadata document

```json
{
  "resource": "{public_url}/mcp",
  "authorization_server": "{public_url}",
  "authorization_servers": ["{public_url}"],
  "resource_name": "Macro MCP"
}
```

- Keep singular `authorization_server` **and** plural `authorization_servers` for backward compatibility. RFC 9728 allows additional parameters; existing clients may already read either form.
- `resource_name` is a stable human-readable label: `"Macro MCP"`.

### Implementation sketch

In `services/mcp_auth_proxy/src/domain/service.rs`, update `protected_resource_metadata()`:

```rust
fn protected_resource_metadata(&self) -> serde_json::Value {
    let base = &self.public_url;
    serde_json::json!({
        "resource": format!("{base}/mcp"),
        "authorization_server": base,
        "authorization_servers": [base],
        "resource_name": "Macro MCP",
    })
}
```

No config changes: `public_url` is already injected when constructing `McpAuthProxyServiceImpl` from `mcp_service` context (`mcp_public_url`).

### Testing

Add unit coverage in `mcp_auth_proxy` (new test module or tests adjacent to the service):

1. Given a fixed `public_url` (e.g. `https://mcp-server.example.com`), metadata includes:
   - `resource` == `https://mcp-server.example.com/mcp`
   - `authorization_servers` contains `https://mcp-server.example.com`
   - `resource_name` == `Macro MCP`
2. Metadata does **not** include `scopes_supported`.

Prefer a pure domain unit test that constructs `McpAuthProxyServiceImpl` with a fake/in-memory inflight store and a dummy OAuth provider (or existing test doubles if present). Avoid requiring Redis/FusionAuth for this assertion.

### Verification commands (pre-push)

Per CONTRIBUTING:

```bash
cargo fmt
cargo test -p mcp_auth_proxy
just clippy   # or project-equivalent scoped clippy if preferred in review
```

### Contribution workflow

1. Open an upstream issue on `macro-inc/macro` describing the missing RFC 9728 `resource` field and Grok OAuth discovery failure.
2. Branch: `fix/mcp-protected-resource-metadata`.
3. PR title: `fix(mcp): add RFC 9728 resource to protected resource metadata`.
4. PR body: short what/why, link to issue, note that `scopes_supported` is intentionally omitted.
5. Target: upstream via the contributor’s fork (`diegohh0411/macro` → `macro-inc/macro`).

## Success criteria

- [ ] Protected resource metadata includes REQUIRED `resource` equal to `{public_url}/mcp`.
- [ ] Metadata includes RECOMMENDED `resource_name`.
- [ ] Metadata does not invent `scopes_supported`.
- [ ] Unit tests cover the above.
- [ ] After deploy, Grok OAuth discovery no longer fails solely because `resource` is missing (user can complete browser login; any later failures are separate bugs).

## Risks and follow-ups

| Risk | Mitigation |
|------|------------|
| Client expects `resource` without `/mcp` path | §3.3 + Grok/rmcp require equality with the MCP request URL, which includes `/mcp`. |
| Later OAuth steps still fail | Out of scope; file separately if observed after deploy. |
| Missing `scopes_supported` confuses some clients | RFC allows omission; clients should fall back when scope is absent from WWW-Authenticate (MCP scope selection strategy). |
| AS metadata still sparse | Follow-up PR for RFC 8414 fields such as `token_endpoint_auth_methods_supported: ["none"]`. |

## References

- [RFC 9728 — OAuth 2.0 Protected Resource Metadata](https://www.rfc-editor.org/rfc/rfc9728.html)
- Macro: `services/mcp_auth_proxy/src/domain/service.rs` (`protected_resource_metadata`)
- Macro client test expectation (resource field present): `crates/mcp_client/src/outbound/oauth/test.rs`
- Grok/rmcp validation: `rmcp` 2.1.0 `transport/auth.rs` (`validate_resource_metadata_resource`)
