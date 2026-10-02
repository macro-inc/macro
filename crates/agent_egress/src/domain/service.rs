//! The service itself: verify, resolve, stamp, forward.

use http::header::AUTHORIZATION;
use http::{Method, Uri};
use http_body_util::{BodyExt, Full};

use crate::domain::error::EgressError;
use crate::domain::model::{
    EgressTarget, MAX_MCP_REQUEST_BYTES, McpDestination, McpResolution, ProxyRequest,
    ProxyResponse, SessionToken, TOOLS_CALL_METHOD, UpstreamCall, disconnected_tool_result,
    ensure_method_allowed, is_macro_staff, not_connected_tool_result, peek_json_rpc,
    sanitize_request_headers, sanitize_response_headers,
};
use crate::domain::ports::{Forwarder, GithubTokens, McpCredentials, SessionAuthority};

#[cfg(test)]
mod test;

/// Proxy one request on a sandbox's behalf.
pub trait EgressService: Send + Sync {
    /// Verify `token`, resolve `target` against the session owner's own
    /// connections, and pass `request` through with the upstream credential
    /// stamped on in place of the sandbox's.
    fn proxy(
        &self,
        token: &SessionToken,
        target: EgressTarget,
        request: ProxyRequest,
    ) -> impl Future<Output = Result<ProxyResponse, EgressError>> + Send;
}

/// The service, over its four ports.
pub struct EgressServiceImpl<Sessions, Credentials, Tokens, Forward> {
    sessions: Sessions,
    credentials: Credentials,
    tokens: Tokens,
    forward: Forward,
    preview_mcp: Option<(url::Url, bool)>,
}

impl<Sessions, Credentials, Tokens, Forward>
    EgressServiceImpl<Sessions, Credentials, Tokens, Forward>
where
    Sessions: SessionAuthority,
    Credentials: McpCredentials,
    Tokens: GithubTokens,
    Forward: Forwarder,
{
    /// Configure the fixed internal preview MCP destination. Cleartext is local-only.
    pub fn with_preview_mcp(
        mut self,
        url: url::Url,
        local_cleartext: bool,
    ) -> Result<Self, EgressError> {
        if !local_cleartext {
            crate::domain::model::UpstreamCall::bearer(
                url.clone(),
                crate::domain::model::BearerToken::new("validation"),
            )?;
        }
        self.preview_mcp = Some((url, local_cleartext));
        Ok(self)
    }

    /// Build the service over its adapters.
    pub fn new(
        sessions: Sessions,
        credentials: Credentials,
        tokens: Tokens,
        forward: Forward,
    ) -> Self {
        Self {
            sessions,
            credentials,
            tokens,
            forward,
            preview_mcp: None,
        }
    }
}

impl<Sessions, Credentials, Tokens, Forward> EgressService
    for EgressServiceImpl<Sessions, Credentials, Tokens, Forward>
where
    Sessions: SessionAuthority,
    Credentials: McpCredentials,
    Tokens: GithubTokens,
    Forward: Forwarder,
{
    #[tracing::instrument(skip_all, err, fields(
        destination = ?target,
        method = %request.method(),
        session = tracing::field::Empty,
        owner = tracing::field::Empty,
        upstream_status = tracing::field::Empty,
    ))]
    async fn proxy(
        &self,
        token: &SessionToken,
        target: EgressTarget,
        mut request: ProxyRequest,
    ) -> Result<ProxyResponse, EgressError> {
        ensure_method_allowed(request.method())?;

        // Authorize before resolving: resolution reads the owner's connected
        // servers, and an unverified token must not be able to probe which
        // of those exist.
        let grant = self.sessions.authorize(token).await?;
        let span = tracing::Span::current();
        span.record("session", tracing::field::display(&grant.session));
        span.record("owner", tracing::field::display(&grant.owner));

        // Workspace and Git egress remain staff-only. Session-scoped preview tools
        // are available to every session owner, like the internal MCP tools.
        if !matches!(&target, EgressTarget::McpServer(McpDestination::Preview))
            && !is_macro_staff(&grant.owner)
        {
            tracing::warn!(owner = %grant.owner, "refusing egress for a session owned outside macro.com");
            return Err(EgressError::Unauthenticated(
                "the session owner is not Macro staff",
            ));
        }

        let call = match &target {
            EgressTarget::McpServer(McpDestination::Preview) => {
                let (url, local) = self.preview_mcp.as_ref().ok_or_else(|| {
                    EgressError::Unroutable("preview service is not configured".into())
                })?;
                // Unlike user tools, this tool must retain the authenticated session identity.
                // The destination is deployment configuration, never supplied by an agent.
                let bearer = crate::domain::model::BearerToken::new(token.as_str());
                if *local {
                    crate::domain::model::UpstreamCall::bearer_over_local_cleartext(
                        url.clone(),
                        bearer,
                    )
                } else {
                    crate::domain::model::UpstreamCall::bearer(url.clone(), bearer)?
                }
            }

            EgressTarget::McpServer(
                destination @ (McpDestination::Macro
                | McpDestination::Connected(_)
                | McpDestination::Custom(_)),
            ) => {
                let (call, answer): (UpstreamCall, Option<Answer>) = match self
                    .credentials
                    .resolve(&grant.owner, destination)
                    .await?
                {
                    McpResolution::Connected(call) => (call, None),
                    // The owner has no grant for this app, but it can
                    // still be addressed for them: the handshake and tool
                    // listing go through, and a tool call is answered
                    // here with a result the model can act on. Only a
                    // Pipedream app resolves this way; Macro's own server
                    // has no grant to lack, and a custom server with no
                    // row is refused by its resolver outright.
                    McpResolution::Unconnected(call) => match destination {
                        McpDestination::Connected(slug) => {
                            let name = grant.display_name(slug);
                            let slug = slug.clone();
                            let answer: Answer = Box::new(move |id| {
                                tracing::info!(
                                    app = %slug,
                                    "answering tools/call for an app the owner has not connected"
                                );
                                not_connected_tool_result(&slug, &name, id)
                            });
                            (call, Some(answer))
                        }
                        _ => (call, None),
                    },
                    // The owner connected this server once and the grant
                    // has since died. Same treatment: the handshake is
                    // forwarded bare, in case the server allows it, and a
                    // tool call is answered with how to reconnect.
                    McpResolution::Disconnected { call, name } => {
                        let answer: Answer = Box::new(move |id| {
                            tracing::info!(
                                server = %name,
                                "answering tools/call for a server whose grant has died"
                            );
                            disconnected_tool_result(&name, id)
                        });
                        (call, Some(answer))
                    }
                };
                match answer {
                    None => call,
                    Some(answer) => match Self::answer_unconnected(answer, request).await? {
                        Unconnected::Answered(response) => return Ok(response),
                        Unconnected::Forward(forwarded) => {
                            request = forwarded;
                            call
                        }
                    },
                }
            }
            EgressTarget::GitHubGit { endpoint } => {
                // The repository is the grant's, never the request's: a
                // session works on exactly one, and the sandbox has no way to
                // name another because there is no place in the route to put
                // one.
                let repo = grant.repo.as_ref().ok_or(EgressError::Unauthenticated(
                    "the session has no repository for git access",
                ))?;
                let base = self.tokens.resolve(&grant.owner, repo).await?;

                // The endpoint comes from the allowlist, not from the port, so
                // no credential adapter can widen what the sandbox reaches.
                let url = base
                    .url()
                    .join(&endpoint.path_and_query())
                    .map_err(|error| {
                        EgressError::Internal(rootcause::report!(
                            "git endpoint is not a url: {error}"
                        ))
                    })?;
                base.redirected_to(url)?
            }
        };

        tracing::info!(
            session = %grant.session,
            owner = %grant.owner,
            upstream = %target.name(),
            method = %request.method(),
            "proxying",
        );

        *request.uri_mut() = call.url().as_str().parse::<Uri>().map_err(|error| {
            EgressError::Internal(rootcause::report!("upstream url is not a uri: {error}"))
        })?;

        // Strip first, stamp second, and never the other way round: the
        // sandbox's own `Authorization` is this session's token, and the
        // strip list contains `authorization` precisely so that no request
        // can carry it upstream. Doing it in this order means the header the
        // upstream sees is the one resolved for the owner, whatever the
        // sandbox sent.
        sanitize_request_headers(request.headers_mut());
        if let Some(authorization) = call.authorization().header_value()? {
            request.headers_mut().insert(AUTHORIZATION, authorization);
        }
        // Scoping headers are half of the credential - for Pipedream they are
        // what says whose account the bearer spends - so they get the same
        // treatment: stamped from the resolved call after the strip, never
        // taken from the request.
        for (name, value) in call.scope_headers() {
            request.headers_mut().insert(name.clone(), value.clone());
        }

        let mut response = self.forward.forward(request).await?;
        sanitize_response_headers(response.headers_mut());

        let status = response.status();
        tracing::Span::current().record("upstream_status", status.as_u16());
        if status.is_success() {
            tracing::debug!(%status, "upstream answered");
        } else {
            tracing::warn!(
                session = %grant.session,
                upstream = %target.name(),
                %status,
                "upstream answered with a failure status"
            );
        }

        Ok(response)
    }
}

/// What became of a request to a server the owner has no live grant for.
enum Unconnected {
    /// The proxy answered it itself; nothing goes upstream.
    Answered(ProxyResponse),
    /// Forward it, addressed for the owner, so the handshake and tool listing
    /// work. The body has been read and put back.
    Forward(ProxyRequest),
}

/// How a `tools/call` with the given JSON-RPC id is answered in the
/// upstream's place.
type Answer = Box<dyn FnOnce(serde_json::Value) -> ProxyResponse + Send>;

impl<Sessions, Credentials, Tokens, Forward>
    EgressServiceImpl<Sessions, Credentials, Tokens, Forward>
where
    Sessions: SessionAuthority,
    Credentials: McpCredentials,
    Tokens: GithubTokens,
    Forward: Forwarder,
{
    /// A server the owner has no live grant for: forward everything except
    /// `tools/call`.
    ///
    /// `initialize`, `tools/list`, notifications, the GET event stream and
    /// DELETE all go to the upstream addressed for the owner, so the agent's
    /// client completes its handshake and sees the server's real tools from
    /// the first turn. A `tools/call` is answered here with `answer` - a tool
    /// result that names the server and how to connect it - and the moment
    /// the owner does, the same advertised server resolves as connected and
    /// calls flow through, with nothing re-attached.
    async fn answer_unconnected(
        answer: Answer,
        request: ProxyRequest,
    ) -> Result<Unconnected, EgressError> {
        if *request.method() != Method::POST {
            return Ok(Unconnected::Forward(request));
        }
        let (parts, mut body) = request.into_parts();
        let mut bytes = Vec::new();
        while let Some(frame) = body.frame().await {
            let frame = frame.map_err(|error| {
                EgressError::Internal(rootcause::report!(
                    "could not read an MCP request body: {error}"
                ))
            })?;
            if let Ok(data) = frame.into_data() {
                if bytes.len() + data.len() > MAX_MCP_REQUEST_BYTES {
                    return Err(EgressError::RequestTooLarge);
                }
                bytes.extend_from_slice(&data);
            }
        }
        let bytes = bytes::Bytes::from(bytes);

        if let Some(call) = peek_json_rpc(&bytes)
            && call.method == TOOLS_CALL_METHOD
        {
            return Ok(Unconnected::Answered(answer(call.id)));
        }

        Ok(Unconnected::Forward(ProxyRequest::from_parts(
            parts,
            Full::new(bytes)
                .map_err(|never| match never {})
                .boxed_unsync(),
        )))
    }
}
