//! Vocabulary: grants, slugs, targets, and the request rules the service
//! applies on the way through.
//!
//! The requests and responses themselves are `http::Request` and
//! `http::Response`. `http` is a vocabulary crate - types, no I/O, no
//! runtime, no server - which is why axum, reqwest, hyper and tower all
//! agree on it, and why using it here does not drag transport into the
//! domain. The alternative, hand-rolled header and method types, would mean
//! reimplementing case-insensitive lookup and header-value validation badly,
//! and converting at both edges for the privilege.

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as BASE64URL_NO_PAD;
use bytes::Bytes;
use http::header::{self, HeaderMap, HeaderName};
use http::{HeaderValue, Method};
use http_body_util::combinators::UnsyncBoxBody;
use macro_user_id::email::ReadEmailParts;
use macro_user_id::user_id::MacroUserIdStr;
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::fmt;
use url::Url;

use crate::domain::error::EgressError;

pub use agent_fold::domain::log::AgentSessionId;

#[cfg(test)]
mod test;

/// Whatever a body failed with. Type-erased because the domain neither
/// produces these nor inspects them - it carries a body from one adapter to
/// another.
pub type BoxError = Box<dyn std::error::Error + Send + Sync>;

/// A streaming body, in either direction.
///
/// Streamed rather than collected because both things this carries are
/// unbounded: MCP replies arrive as server-sent events that stay open for
/// the life of a tool call, and git's packfiles are as big as the
/// repository. Buffering either would turn a working proxy into a memory
/// leak.
///
/// A boxed `http_body::Body` rather than a bare stream because it is what
/// both edges already are: axum's body is exactly this shape, and reqwest's
/// response converts straight into `http::Response<reqwest::Body>`.
///
/// `UnsyncBoxBody` specifically, matching axum: a body is polled from one
/// task, so `Sync` buys nothing, and requiring it would mean wrapping every
/// request that comes in off the wire.
pub type ProxyBody = UnsyncBoxBody<Bytes, BoxError>;

/// A request on its way through.
pub type ProxyRequest = http::Request<ProxyBody>;

/// A response on its way back.
pub type ProxyResponse = http::Response<ProxyBody>;

/// The one secret a sandbox holds: proof that it is running a given session.
///
/// Opaque, and opaque all the way down: the token asserts nothing and is worth
/// exactly the row it is stored against. What a request may do comes from that
/// row, so there is no claim to drift out of step with the session and nothing
/// to sign or verify.
///
/// The value itself exists in two places and no others - the sandbox's
/// environment, and the response of the call that put it there. What is
/// persisted is [`SessionToken::hash`].
#[derive(Clone, PartialEq, Eq)]
pub struct SessionToken(String);

/// How many bytes of randomness a minted token carries.
///
/// 256 bits, which is the point past which guessing is not the attack anyone
/// would try.
const TOKEN_BYTES: usize = 32;

impl SessionToken {
    /// Wrap a token presented by a sandbox.
    pub fn new(token: impl Into<String>) -> Self {
        Self(token.into())
    }

    /// A fresh token for a sandbox about to be spawned.
    ///
    /// Unpredictability is the entire security property - there is no
    /// signature backing it up - so this draws from a cryptographically secure
    /// generator seeded by the operating system, never a reproducible one.
    pub fn mint() -> Self {
        let mut bytes = [0u8; TOKEN_BYTES];
        rand::rng().fill_bytes(&mut bytes);
        Self(BASE64URL_NO_PAD.encode(bytes))
    }

    /// The SHA-256 hash of this token, lowercase hex.
    ///
    /// What gets stored against a session, and what a presented token is
    /// looked up by. Storing the hash rather than the token is what keeps a
    /// database dump from yielding live credentials; the token has 256 bits of
    /// entropy, so there is nothing for a rainbow table to precompute and
    /// nothing a salt would add.
    pub fn hash(&self) -> String {
        Sha256::digest(self.0.as_bytes())
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    /// The token as presented.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

// Redacted: a proxy logs every request it handles, and the credential is on
// every one of them.
impl fmt::Debug for SessionToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SessionToken([REDACTED])")
    }
}

/// An upstream credential, resolved on the owner's behalf and never seen by
/// the sandbox.
#[derive(Clone, PartialEq, Eq)]
pub struct BearerToken(String);

impl BearerToken {
    /// Wrap a token obtained for an upstream.
    pub fn new(token: impl Into<String>) -> Self {
        Self(token.into())
    }

    /// The token itself.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for BearerToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("BearerToken([REDACTED])")
    }
}

/// How an upstream wants to be told who is calling.
///
/// Two shapes because two upstreams disagree: MCP servers take an OAuth
/// bearer, and GitHub's git endpoints take Basic with the installation token
/// as the *password* - git's credential helper protocol has no other way to
/// carry one.
#[derive(Clone, PartialEq, Eq)]
pub enum UpstreamCredential {
    /// `Authorization: Bearer <token>`.
    Bearer(BearerToken),
    /// `Authorization: Basic base64(username:secret)`.
    Basic {
        /// The user half, which GitHub ignores beyond requiring one.
        username: String,
        /// The password half - the credential proper.
        secret: String,
    },
}

impl UpstreamCredential {
    /// This credential as an `Authorization` header value, marked sensitive
    /// so the http stack keeps it out of its own logging.
    ///
    /// The single place a credential becomes a header, so it is also the
    /// single place validation happens: a secret carrying a newline could
    /// otherwise inject a header of its own choosing into the upstream
    /// request, and `HeaderValue` is what refuses it.
    pub fn header_value(&self) -> Result<HeaderValue, EgressError> {
        let rendered = match self {
            Self::Bearer(token) => format!("Bearer {}", token.as_str()),
            Self::Basic { username, secret } => {
                format!("Basic {}", BASE64.encode(format!("{username}:{secret}")))
            }
        };

        let mut value = HeaderValue::from_str(&rendered).map_err(|error| {
            EgressError::Internal(rootcause::report!(
                "upstream credential is not a header value: {error}"
            ))
        })?;
        value.set_sensitive(true);
        Ok(value)
    }
}

impl fmt::Debug for UpstreamCredential {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Bearer(_) => f.write_str("Bearer([REDACTED])"),
            Self::Basic { username, .. } => write!(f, "Basic({username}, [REDACTED])"),
        }
    }
}

/// The email domain Macro staff live under.
const STAFF_EMAIL_DOMAIN: &str = "macro.com";

/// Whether a user belongs to the Macro staff domain.
///
/// The proxy is staff-only for now: every credential it stamps spends real
/// upstream access on the owner's behalf, and until that has earned broader
/// trust, "owned by somebody @macro.com" is the whole admission policy. In
/// the domain rather than deployment configuration so it cannot be switched
/// off by an unset env var.
pub fn is_macro_staff(user: &MacroUserIdStr<'_>) -> bool {
    user.email_part().domain_part() == STAFF_EMAIL_DOMAIN
}

/// What a verified session token entitles its holder to.
///
/// The owner is the whole authorization story: a session spends the
/// credentials of the person who opened it, and nobody else's.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionGrant {
    /// The session the sandbox is running.
    pub session: AgentSessionId,
    /// Whose connected servers it may reach.
    pub owner: MacroUserIdStr<'static>,
    /// The one repository this session works on. Git egress is pinned to it.
    pub repo: RepoSlug,
}

/// A GitHub repository, as `owner/name`.
///
/// Never parsed from a request: the sandbox does not name a repository, its
/// session does, and this is read off the session's row. That makes the two
/// segments our own configuration rather than sandbox input - but they still
/// get interpolated into a URL, so parsing them is what keeps a mistyped
/// repository from becoming a request somewhere else entirely.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct RepoSlug {
    owner: String,
    name: String,
}

/// The only host a configured repository URL may name.
///
/// A URL pointing anywhere else would name a repository this proxy has no
/// installation for and could not reach, so it is a configuration error rather
/// than a repository.
const GITHUB_HOST: &str = "github.com";

impl RepoSlug {
    /// The repository a configured GitHub URL names.
    ///
    /// Deliberately narrow: it must be `https://github.com/<owner>/<name>`,
    /// optionally with `.git` or a trailing slash, and nothing else. Both ends
    /// of a session read the same `repo_url` column - the harness to mint a
    /// sandbox's token, the proxy to decide which repository that sandbox's
    /// git traffic may reach - so a second, laxer reading of it in one of them
    /// would be a way for the two to disagree about which repository a session
    /// is. A URL that is nearly right is a configuration mistake worth failing
    /// on rather than guessing at.
    pub fn parse_github_url(repository_url: &str) -> Option<Self> {
        let url = Url::parse(repository_url).ok()?;
        if url.host_str() != Some(GITHUB_HOST) {
            return None;
        }

        let mut segments = url.path_segments()?;
        let owner = segments.next()?;
        let name = segments.next()?;
        // Anything after the repository name is not part of it. A trailing
        // empty segment is just a trailing slash.
        if segments.any(|segment| !segment.is_empty()) {
            return None;
        }

        Self::parse(owner, name.trim_end_matches(".git"))
    }

    /// Accept an owner and repository name read off a session's row.
    ///
    /// The charset is `[A-Za-z0-9._-]`, and the exclusions are the substance:
    /// these two segments get interpolated into
    /// `https://github.com/{owner}/{name}.git/`, so a segment containing `/`,
    /// `?`, `#`, `@` or `%` would not be a segment - it would be a path of its
    /// own, a query string, a fragment, URL userinfo, or an encoded version of
    /// any of those - and `@` in particular is what stops a claim value
    /// rewriting the URL's host through userinfo. Rejecting `.` and `..`
    /// outright closes the one traversal the charset alone still permits.
    pub fn parse(owner: &str, name: &str) -> Option<Self> {
        let acceptable = |segment: &str| {
            !segment.is_empty()
                && segment != "."
                && segment != ".."
                && segment.chars().all(|character| {
                    character.is_ascii_alphanumeric()
                        || character == '.'
                        || character == '_'
                        || character == '-'
                })
        };

        (acceptable(owner) && acceptable(name)).then(|| Self {
            owner: owner.to_owned(),
            name: name.to_owned(),
        })
    }

    /// The account or organization the repository lives under.
    pub fn owner(&self) -> &str {
        &self.owner
    }

    /// The repository's own name, without the owner.
    pub fn name(&self) -> &str {
        &self.name
    }
}

impl fmt::Display for RepoSlug {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}/{}", self.owner, self.name)
    }
}

/// The identifier a sandbox calls one of its owner's connected MCP servers by:
/// the Pipedream `app_slug`, verbatim.
///
/// Not derived from anything. Pipedream's app slug is already a stable,
/// URL-safe machine identifier (`google_drive`, `datadog`), so both ends use
/// it as-is: the provisioner advertises it in the session's server list and
/// the credential resolver matches it against the owner's rows by equality.
/// Nothing is normalized, so no two servers can ever meet at one name.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct McpServerSlug(String);

impl McpServerSlug {
    /// Accept a slug from a request path or a connection row.
    ///
    /// Rejects rather than repairs: the path-segment side of this is chosen
    /// by code the model wrote, and a slug that gets "cleaned up" into a
    /// different valid slug is a way to ask for a server other than the one
    /// named. The charset is Pipedream's own for app slugs.
    pub fn parse(segment: &str) -> Option<Self> {
        let valid = !segment.is_empty()
            && segment.chars().all(|character| {
                character.is_ascii_lowercase()
                    || character.is_ascii_digit()
                    || character == '-'
                    || character == '_'
            });

        valid.then(|| Self(segment.to_owned()))
    }

    /// The slug as it appears in a path and in the session's server list.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for McpServerSlug {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// Which half of git's smart-HTTP protocol a request is doing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GitService {
    /// Reading: clone and fetch.
    UploadPack,
    /// Writing: push.
    ReceivePack,
}

impl GitService {
    /// The name git uses for this service on the wire.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::UploadPack => "git-upload-pack",
            Self::ReceivePack => "git-receive-pack",
        }
    }

    fn parse(name: &str) -> Option<Self> {
        match name {
            "git-upload-pack" => Some(Self::UploadPack),
            "git-receive-pack" => Some(Self::ReceivePack),
            _ => None,
        }
    }
}

/// The git endpoints a sandbox may reach.
///
/// An allowlist of the three smart-HTTP routes, which is also what shuts off
/// the dumb-HTTP object endpoints (`objects/…`, `info/packs`): those serve
/// loose objects and packs by name, so a client that can walk them can read
/// history the smart protocol would have negotiated away, and they are
/// unnecessary against GitHub, which always speaks smart HTTP.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GitEndpoint {
    /// The reference advertisement that opens every clone, fetch, and push.
    InfoRefs {
        /// Which service the client is about to run.
        service: GitService,
    },
    /// The fetch negotiation and packfile.
    UploadPack,
    /// The push negotiation and packfile.
    ReceivePack,
}

impl GitEndpoint {
    /// Recognize an endpoint from the path after `<owner>/<repo>.git/` and
    /// the request's query string.
    ///
    /// Rejects rather than repairs, and rejects a mismatch too: `info/refs`
    /// without a recognized `service` query is the dumb protocol's entry
    /// point, so it is not an endpoint we serve.
    pub fn parse(path: &str, query: Option<&str>) -> Option<Self> {
        match path {
            "info/refs" => {
                let service = query?
                    .split('&')
                    .find_map(|pair| pair.strip_prefix("service="))?;
                Some(Self::InfoRefs {
                    service: GitService::parse(service)?,
                })
            }
            "git-upload-pack" => Some(Self::UploadPack),
            "git-receive-pack" => Some(Self::ReceivePack),
            _ => None,
        }
    }

    /// The path and query this endpoint appends to a repository's git URL.
    pub fn path_and_query(&self) -> String {
        match self {
            Self::InfoRefs { service } => format!("info/refs?service={}", service.as_str()),
            Self::UploadPack => "git-upload-pack".to_owned(),
            Self::ReceivePack => "git-receive-pack".to_owned(),
        }
    }
}

/// Where a proxied request is headed.
///
/// An enum rather than a URL because the sandbox never supplies a
/// destination - it names something, and this crate decides what that
/// resolves to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EgressTarget {
    /// An MCP server the session may dial.
    McpServer(McpDestination),
    /// A git operation against the session's own repository.
    ///
    /// Carries no repository: the session has exactly one, and it comes from
    /// the grant. There is nothing here for a sandbox to name, so there is
    /// nothing to check.
    GitHubGit {
        /// Which of the three smart-HTTP routes.
        endpoint: GitEndpoint,
    },
}

impl EgressTarget {
    /// What to call this target in a log line.
    pub fn name(&self) -> String {
        match self {
            Self::McpServer(McpDestination::Macro) => "macro".to_owned(),
            Self::McpServer(McpDestination::Connected(slug)) => slug.as_str().to_owned(),
            Self::GitHubGit { endpoint } => format!("git {}", endpoint.path_and_query()),
        }
    }
}

/// Which MCP server a request names.
///
/// Macro's own server and the owner's connected apps live on different
/// routes (`/mcp-macro` vs `/mcp/{slug}`), so they can never collide: there
/// is no reserved word to shadow, and no connected app a name could hide.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum McpDestination {
    /// Macro's own MCP server, available to every session.
    Macro,
    /// One of the owner's Pipedream-connected apps.
    Connected(McpServerSlug),
}

/// A resolved destination and the credential to reach it with.
///
/// The fields are private and the constructors validate, so a credential
/// paired with a destination nobody checked cannot be built. Both upstreams
/// here are reached over the public internet, and one of the two URLs -
/// Pipedream's MCP endpoint - is deployment configuration, so "https" is not
/// an assumption this crate is entitled to make.
#[derive(Clone, Debug)]
pub struct UpstreamCall {
    url: Url,
    authorization: UpstreamCredential,
    scope: Vec<(HeaderName, HeaderValue)>,
}

impl UpstreamCall {
    /// A call authorized by a bearer token.
    pub fn bearer(url: Url, token: BearerToken) -> Result<Self, EgressError> {
        Self::new(url, UpstreamCredential::Bearer(token))
    }

    /// A call authorized by a bearer token, permitted over cleartext http.
    ///
    /// The one sanctioned exception to the https rule, for a destination that
    /// never leaves the machine: a local dev stack's own Macro MCP server,
    /// dialed across the compose bridge. TLS there would be theater - the
    /// bytes never touch a wire anyone else can see - and the alternative,
    /// looping through a public tunnel for a same-host hop, only *adds* an
    /// internet round trip to the same cleartext segment.
    ///
    /// The composition root must gate every call to this on
    /// `ENVIRONMENT=local`. It is named this way so a grep for it audits that.
    pub fn bearer_over_local_cleartext(url: Url, token: BearerToken) -> Self {
        Self {
            url,
            authorization: UpstreamCredential::Bearer(token),
            scope: Vec::new(),
        }
    }

    /// A call authorized by Basic credentials.
    pub fn basic(
        url: Url,
        username: impl Into<String>,
        secret: impl Into<String>,
    ) -> Result<Self, EgressError> {
        Self::new(
            url,
            UpstreamCredential::Basic {
                username: username.into(),
                secret: secret.into(),
            },
        )
    }

    fn new(url: Url, authorization: UpstreamCredential) -> Result<Self, EgressError> {
        if url.scheme() != "https" {
            return Err(EgressError::InsecureUpstream(url));
        }

        Ok(Self {
            url,
            authorization,
            scope: Vec::new(),
        })
    }

    /// The same call with scoping headers attached. Already-typed headers,
    /// so there is nothing left to validate: a value that could smuggle a
    /// newline is unrepresentable as a `HeaderValue`, refused wherever the
    /// adapter built it.
    ///
    /// Scoping headers are part of the credential story, not decoration:
    /// Pipedream decides *whose* connected account a request spends from
    /// `x-pd-external-user-id` alone, so these pairs must come from the same
    /// resolution that produced the token - never from the request.
    #[must_use]
    pub fn scoped_by(mut self, headers: HeaderMap) -> Self {
        self.scope.extend(
            headers
                .iter()
                .map(|(name, value)| (name.clone(), value.clone())),
        );
        self
    }

    /// Where the request goes.
    pub fn url(&self) -> &Url {
        &self.url
    }

    /// What gets stamped as `Authorization`.
    pub fn authorization(&self) -> &UpstreamCredential {
        &self.authorization
    }

    /// Headers stamped alongside the credential, scoping what it may spend.
    pub fn scope_headers(&self) -> &[(HeaderName, HeaderValue)] {
        &self.scope
    }

    /// The same call with `url` replaced, revalidated.
    ///
    /// Used to append a git endpoint to the repository base an adapter
    /// returned. Going back through the constructor rather than assigning is
    /// the point: the replacement is checked exactly as the original was.
    pub fn redirected_to(self, url: Url) -> Result<Self, EgressError> {
        let scope = self.scope;
        let mut call = Self::new(url, self.authorization)?;
        call.scope = scope;
        Ok(call)
    }
}

/// The methods a sandbox may use.
///
/// An allowlist, not a translation of HTTP: MCP's streamable transport POSTs
/// requests, GETs the event stream, and DELETEs the session when it is done.
/// Anything else is refused rather than forwarded, so a new route has to say
/// out loud that it needs a new verb.
pub fn ensure_method_allowed(method: &Method) -> Result<(), EgressError> {
    match *method {
        Method::GET | Method::POST | Method::DELETE => Ok(()),
        _ => Err(EgressError::MethodNotAllowed(method.clone())),
    }
}

/// Headers that must not be forwarded upstream.
///
/// Two kinds, and the distinction matters. `authorization` and `cookie` are
/// the sandbox's own credentials for *us*: forwarding them would hand a
/// third-party MCP server a token that spends this session's egress. The
/// rest are hop-by-hop headers, which by definition describe the connection
/// that just ended, not the one about to begin - `host` most of all, since a
/// forwarded `host` sends the upstream a name that isn't its own.
const STRIPPED_REQUEST_HEADERS: &[HeaderName] = &[
    header::AUTHORIZATION,
    header::COOKIE,
    header::HOST,
    header::CONNECTION,
    header::PROXY_AUTHENTICATE,
    header::PROXY_AUTHORIZATION,
    header::TE,
    header::TRAILER,
    header::TRANSFER_ENCODING,
    header::UPGRADE,
    header::CONTENT_LENGTH,
];

/// Headers not to pass back to the sandbox.
///
/// The hop-by-hop set again, plus three that are about not handing the
/// sandbox things it must not have. `set-cookie`: cookies an upstream tries to
/// set belong to a session between it and this proxy, and letting them reach
/// the sandbox would leak state the sandbox has no business keeping.
/// `authorization` and `proxy-authorization`: these are not normally response
/// headers at all, which is exactly why they are here - an upstream that
/// echoes back the header it received would hand the owner's credential to
/// model-authored code, and the whole point of this crate is that the sandbox
/// never sees one. Not dead weight; do not tidy them away.
const STRIPPED_RESPONSE_HEADERS: &[HeaderName] = &[
    header::AUTHORIZATION,
    header::PROXY_AUTHORIZATION,
    header::CONNECTION,
    header::PROXY_AUTHENTICATE,
    header::TE,
    header::TRAILER,
    header::TRANSFER_ENCODING,
    header::UPGRADE,
    header::CONTENT_LENGTH,
    header::SET_COOKIE,
];

/// The prefix of Pipedream's scoping headers, all of which are stripped in
/// both directions.
///
/// These headers *are* the authorization: `x-pd-external-user-id` alone
/// decides whose connected account a request spends. The ones this proxy
/// stamps would overwrite a sandbox's copy anyway; the prefix strip is for
/// the ones it does not stamp, so a scoping header Pipedream understands and
/// we have never heard of cannot ride through from model-authored code - and,
/// on the way back, so an upstream that echoes its scoping metadata does not
/// report it to the sandbox.
const STRIPPED_SCOPING_PREFIX: &str = "x-pd-";

/// Drop everything the upstream must not see.
///
/// Everything MCP needs to work across a proxy survives: `mcp-session-id`
/// identifies the server's session, `last-event-id` resumes a dropped event
/// stream, and `accept` is how a client asks for one.
pub fn sanitize_request_headers(headers: &mut HeaderMap) {
    strip(headers, STRIPPED_REQUEST_HEADERS);
    strip_scoping(headers);
}

/// Drop everything the sandbox must not see.
pub fn sanitize_response_headers(headers: &mut HeaderMap) {
    strip(headers, STRIPPED_RESPONSE_HEADERS);
    strip_scoping(headers);
}

fn strip_scoping(headers: &mut HeaderMap) {
    let scoping: Vec<HeaderName> = headers
        .keys()
        .filter(|name| name.as_str().starts_with(STRIPPED_SCOPING_PREFIX))
        .cloned()
        .collect();
    strip(headers, &scoping);
}

fn strip(headers: &mut HeaderMap, stripped: &[HeaderName]) {
    for name in stripped {
        // `remove` takes one; a header sent twice needs draining.
        while headers.remove(name).is_some() {}
    }
}
