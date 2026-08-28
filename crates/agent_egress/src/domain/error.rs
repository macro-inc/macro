//! Failures a proxied call can end in.

use crate::domain::model::{McpServerSlug, RepoSlug};

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

    /// The owner has no server under this slug. Also covers a server the
    /// owner has since disabled or disconnected: from the sandbox's side
    /// those are the same fact, and distinguishing them would report on the
    /// owner's settings to code the model wrote.
    #[error("no connected MCP server named {0}")]
    UnknownServer(McpServerSlug),

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

    /// Our side broke: storage, decryption, configuration.
    #[error("egress failed: {0}")]
    Internal(rootcause::Report),
}
