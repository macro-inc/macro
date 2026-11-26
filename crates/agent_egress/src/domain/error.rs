//! Failures a proxied call can end in.

use crate::domain::model::{CustomMcpServerKey, McpServerSlug, RepoSlug};

/// Everything that can stop a sandbox's request from reaching its upstream.
///
/// The variants are separated by what the caller should *do*, not by where
/// they arose: a sandbox that gets [`EgressError::UnknownServer`] should stop
/// dialling that slug, whereas one that gets [`EgressError::Upstream`] should
/// retry. Collapsing them would leave the agent guessing, and an agent that
/// guesses retries until its turn times out.
#[derive(Debug, thiserror::Error)]
pub enum EgressError {
    /// The request is not entitled to egress: no token, a token we do not
    /// know, or an owner the proxy does not admit.
    ///
    /// The reason is a `&'static str` on purpose: it names which gate
    /// refused, in our own fixed words, and can never quote anything the
    /// request carried - the response body rule (nothing request-derived
    /// reaches the model) holds by construction.
    #[error("not authorized: {0}")]
    Unauthenticated(&'static str),

    /// The token verified, but its session is closed or gone. Ending a
    /// session revokes its egress without waiting for the token to expire.
    #[error("session is no longer open")]
    SessionClosed,

    /// The request's path did not name anything this service serves - a slug
    /// that is not a slug, a repository path that is not one, a git endpoint
    /// outside the allowlist. Kept separate from
    /// [`EgressError::UnknownServer`] so the domain never has to invent a
    /// name for something that failed to parse.
    #[error("nothing is served at that path: {0}")]
    Unroutable(String),

    /// The slug names no catalog app. An app the owner has not connected
    /// is not this: its `tools/call` is answered with a result saying so.
    #[error("no MCP server named {0}")]
    UnknownServer(McpServerSlug),

    /// The key names none of the owner's usable custom servers. There is
    /// nothing to address without one: the URL *is* the connection, so a key
    /// that matches none - or one the owner turned off - has nowhere to go.
    #[error("no custom MCP server with key {0}")]
    UnknownCustomServer(CustomMcpServerKey),

    /// The session's agent was not given this app or server. The selected
    /// app list is a permission: a sandbox reaches only what its agent's
    /// author listed, whatever else the owner has connected.
    #[error("the agent was not given this MCP server")]
    OutOfScope,

    /// A request body the proxy had to read was bigger than it will read.
    /// Only reachable on the paths that look inside an MCP request; every
    /// other request streams through unread.
    #[error("request body exceeds what the proxy will read")]
    RequestTooLarge,

    /// We cannot mint a credential for the session's repository: our GitHub
    /// App is not installed on it, or the installation belongs to somebody
    /// with no connection to the session's owner. Not a refusal of anything
    /// the sandbox asked for - it never names a repository - but of the
    /// session's own configuration.
    #[error("no usable GitHub App installation for {0}")]
    RepoUnavailable(RepoSlug),

    /// The destination a credential was about to be stamped for is not
    /// https. Refused rather than downgraded: an MCP server's URL is typed in
    /// by a person, and stamping the owner's OAuth token onto a cleartext
    /// request would put that credential on the wire for anyone on the path to
    /// take.
    #[error("refusing to send a credential to {0} in cleartext")]
    InsecureUpstream(url::Url),

    /// A verb these routes have no use for. Refused rather than forwarded,
    /// so adding a route that needs one has to say so.
    #[error("method {0} is not allowed here")]
    MethodNotAllowed(http::Method),

    /// The upstream could not be reached, or answered in a way that broke
    /// the exchange. A non-2xx *status* is not this - statuses pass through
    /// to the caller untouched, because MCP and git both use them
    /// semantically.
    #[error("upstream request failed: {0}")]
    Upstream(rootcause::Report),

    /// The upstream refused the request with HTTP 429 before running it, so
    /// the same request may be sent again once `retry_after` (its
    /// `Retry-After` in seconds, when it sent one) has passed.
    #[error("upstream rate limited the request")]
    RateLimited {
        /// How long the upstream asked callers to wait.
        retry_after: Option<std::time::Duration>,
    },

    /// Our side broke: storage, decryption, configuration.
    #[error("egress failed: {0}")]
    Internal(rootcause::Report),
}
