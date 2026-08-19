#![deny(missing_docs)]
//! Credential-stamping egress for agent sandboxes.
//!
//! An agent session runs in a sandbox executing model-authored code with
//! every permission allowed. Anything handed to that sandbox has been handed
//! to the model, so the sandbox holds exactly one secret: a short-lived
//! session token minted by the harness. Every upstream credential - the
//! owner's MCP OAuth grants today, GitHub App installation tokens next -
//! stays here, and is stamped onto requests as they pass through.
//!
//! That is the whole point of the indirection. A proxy that only forwarded
//! bytes would be pointless; this one is the single place where "which
//! upstream, on whose behalf, with which credential" is decided, and so also
//! the single place where it can be scoped, refused, and logged.
//!
//! One request, end to end:
//!
//! 1. the sandbox calls the proxy, presenting its session token
//! 2. [`ports::SessionAuthority`] turns that token into a
//!    [`model::SessionGrant`] - which session, and whose credentials it may
//!    spend - or refuses it because the token is bad, expired, or the session
//!    has since closed
//! 3. one of two credential ports resolves the destination:
//!    [`ports::McpCredentials`] finds the named server among *that owner's*
//!    connected servers and produces a fresh bearer token, or
//!    [`ports::GithubTokens`] mints an installation token scoped to the
//!    session's own repository
//! 4. the service strips the sandbox's own credentials from the request and
//!    hands it to [`ports::Forwarder`] with the upstream one stamped on
//!
//! Steps 2 and 3 are the substance and live in
//! [`service::EgressServiceImpl`]. Step 4's byte-shovelling is deliberately a
//! port: forwarding is transport mechanics, and keeping it outside lets the
//! decisions be tested without a socket.
//!
//! The sandbox never names a destination, and that is the property everything
//! else rests on. For MCP it names a server slug, which resolves only through
//! the owner's own rows, so it cannot ask to reach somewhere its owner never
//! connected. For git it names nothing at all: the repository comes from the
//! session's grant, and the endpoint from a three-entry allowlist.

/// Domain models, ports, errors, and the service that decides what gets
/// stamped onto which upstream.
pub mod domain;

/// Adapters the sandbox reaches this crate through.
pub mod inbound;

/// Adapters this crate reaches the rest of the world through.
pub mod outbound;

pub use domain::{error, model, ports, service};
