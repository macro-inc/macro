//! Resolve each call's explicit actor before credentials or approvals.

use super::*;
use crate::domain::approval::{InProcessCall, refusal};
use crate::domain::model::{
    AgentSessionId, SessionGrant, disconnected_text, not_connected_text, tool_error_result,
    tool_result_response,
};
use agent_session::domain::model::TurnPrompter;
use ai_toolset::actor::{ToolActor, add_actor_schema};
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::{Value, json};

/// Preserve the original MCP session/callback capabilities for owner calls.
/// Other-account calls use independently authenticated, actor-keyed sessions.
pub(super) fn owner_call_arguments(
    grant: &SessionGrant,
    request: &Value,
) -> Result<Option<Value>, ai_toolset::actor::ActorError> {
    let prompter = grant
        .prompter
        .as_ref()
        .ok_or(ai_toolset::actor::ActorError::NoActiveTurn)?;
    let (actor, arguments) = ToolActor::take(&request["params"]["arguments"])?;
    let user = actor.resolve(&grant.owner, prompter.acting_user())?;
    Ok((user == &grant.owner).then_some(arguments))
}

impl<Sessions, Credentials, Tokens, Forward, Approvals>
    EgressServiceImpl<Sessions, Credentials, Tokens, Forward, Approvals>
where
    Sessions: SessionAuthority,
    Credentials: McpCredentials,
    Tokens: GithubTokens,
    Forward: Forwarder + 'static,
    Approvals: OwnerApprovals,
{
    #[tracing::instrument(skip_all, err, fields(session_id = %grant.session, ?destination))]
    pub(super) async fn actor_exchange(
        &self,
        token: &SessionToken,
        grant: &SessionGrant,
        destination: &McpDestination,
        mut request: Value,
    ) -> Result<ProxyResponse, EgressError> {
        let id = request["id"].clone();
        let listing = request["method"] == "tools/list";
        let requester = grant.prompter.as_ref().and_then(TurnPrompter::acting_user);
        let public = matches!(destination, McpDestination::Macro)
            && !listing
            && !spends_owner_access(
                MACRO_SERVER_SLUG,
                request["params"]["name"].as_str().unwrap_or_default(),
            );
        let macro_tools = matches!(destination, McpDestination::Macro);
        let (actor, user) = if listing || public {
            // Keep the session owner's configured catalog. Selecting requester
            // changes execution credentials, not which integrations are advertised.
            if public && let Some(arguments) = request["params"]["arguments"].as_object_mut() {
                arguments.remove(ai_toolset::actor::ACTING_AS);
            }
            (ToolActor::Owner, &grant.owner)
        } else {
            let (actor, arguments) = match ToolActor::take(&request["params"]["arguments"]) {
                Ok(selection) => selection,
                Err(error) => return Ok(tool_result_response(id, error.to_string())),
            };
            request["params"]["arguments"] = arguments;
            let user = match actor.resolve(&grant.owner, requester) {
                Ok(user) => user,
                Err(error) => return Ok(tool_result_response(id, error.to_string())),
            };
            (actor, user)
        };
        tracing::info!(session = %grant.session, ?actor, listing, "resolved MCP actor");
        let upstream = match self
            .resolve_upstream(grant, user, destination, listing)
            .await?
        {
            Ok(upstream) => upstream,
            Err(text) => return Ok(tool_result_response(id, text)),
        };
        let transport = self
            .actor_mcp
            .clone()
            .ok_or(EgressError::Unauthenticated("actor transport unavailable"))?;
        let session_id = grant.session;
        let acting_user = user.clone();
        if !listing {
            let current = self.sessions.authorize(token).await?;
            if current.prompter != grant.prompter {
                return Ok(tool_result_response(
                    id,
                    "The original turn ended; this tool did not run.".into(),
                ));
            }
        }
        exchange_result(
            transport.as_ref(),
            session_id,
            acting_user,
            upstream,
            request,
            listing,
            macro_tools,
        )
        .await
    }

    /// The upstream `user`'s connection reaches `destination` through, or the
    /// tool result that says why a call cannot run.
    async fn resolve_upstream(
        &self,
        grant: &SessionGrant,
        user: &MacroUserIdStr<'static>,
        destination: &McpDestination,
        listing: bool,
    ) -> Result<Result<UpstreamCall, String>, EgressError> {
        let resolution = match self.credentials.resolve(user, grant.agent, grant.session.as_uuid(), destination).await {
            Ok(resolution) => resolution,
            Err(EgressError::UnknownCustomServer(_)) if !listing => return Ok(Err(
                "This custom MCP server is not connected for the selected actor. Ask them to add or reconnect that server in Agents → Connections. Do not switch accounts unless they requested it.".into())),
            Err(error) => return Err(error),
        };
        Ok(match resolution {
            McpResolution::Connected(call) => Ok(call),
            McpResolution::Unconnected(call) if listing => Ok(call),
            McpResolution::Unconnected(_) => match destination {
                McpDestination::Connected(slug) => {
                    Err(not_connected_text(slug, &grant.display_name(slug)))
                }
                _ => Err("The selected actor has no connection for this tool.".into()),
            },
            McpResolution::Disconnected { call, .. } if listing => Ok(call),
            McpResolution::Disconnected { name, .. } => Err(disconnected_text(&name)),
        })
    }
}

impl<Sessions, Credentials, Tokens, Forward, Approvals> SessionMcpExchange
    for EgressServiceImpl<Sessions, Credentials, Tokens, Forward, Approvals>
where
    Sessions: SessionAuthority,
    Credentials: McpCredentials,
    Tokens: GithubTokens,
    Forward: Forwarder + 'static,
    Approvals: OwnerApprovals,
{
    /// The session's grant, read by id for an in-process caller that has
    /// authorized its own request against the session.
    async fn session_grant(&self, session: AgentSessionId) -> Result<SessionGrant, EgressError> {
        self.sessions.authorize_session(session).await
    }

    /// One `tools/list` or `tools/call` on a connected app or custom server as
    /// `user`, for an in-process caller that already settled which account
    /// the call spends and that it may spend it.
    ///
    /// The same credential resolution and independently authenticated
    /// transport as a sandbox's requester call, so an app the account has
    /// not connected, or whose grant died, answers with the same tool result.
    /// Returns the MCP `result` payload. Listing reads the owner's catalog,
    /// as every session's discovery does.
    #[tracing::instrument(skip_all, err, fields(session_id = %grant.session, ?destination))]
    async fn exchange_as(
        &self,
        grant: &SessionGrant,
        user: &MacroUserIdStr<'static>,
        destination: &McpDestination,
        request: Value,
    ) -> Result<Value, EgressError> {
        if !matches!(
            destination,
            McpDestination::Connected(_) | McpDestination::Custom(_)
        ) {
            return Err(EgressError::Unroutable(
                "only connected apps and custom servers are exchanged here".into(),
            ));
        }
        let listing = request["method"] == "tools/list";
        let user = if listing { &grant.owner } else { user };
        let upstream = match self
            .resolve_upstream(grant, user, destination, listing)
            .await?
        {
            Ok(upstream) => upstream,
            Err(text) => return Ok(tool_error_result(text)),
        };
        if !listing
            && let Some(text) = self
                .hold_owner_call(grant, user, destination, &request)
                .await?
        {
            return Ok(tool_error_result(text));
        }
        let transport = self
            .actor_mcp
            .clone()
            .ok_or(EgressError::Unauthenticated("actor transport unavailable"))?;
        match transport
            .exchange(grant.session, user.clone(), upstream, request)
            .await
        {
            Ok(result) => Ok(result),
            Err(error) if !listing => {
                tracing::warn!(?error, "actor MCP exchange failed");
                Ok(tool_error_result(UNKNOWN_OUTCOME.into()))
            }
            Err(error) => Err(error),
        }
    }
}

impl<Sessions, Credentials, Tokens, Forward, Approvals>
    EgressServiceImpl<Sessions, Credentials, Tokens, Forward, Approvals>
where
    Sessions: SessionAuthority,
    Approvals: OwnerApprovals,
{
    /// A call spending the owner's access in a turn somebody else prompted
    /// waits for the owner, one call at a time, the same as a sandbox's
    /// held call: the same approval record, announcement and standing
    /// approvals. So does a write the owner confirms, in any turn. `Some`
    /// with what to tell the model when it may not run.
    async fn hold_owner_call(
        &self,
        grant: &SessionGrant,
        user: &MacroUserIdStr<'static>,
        destination: &McpDestination,
        request: &Value,
    ) -> Result<Option<String>, EgressError> {
        if *user != grant.owner {
            return Ok(None);
        }
        let (server_slug, server_name) = match destination {
            McpDestination::Connected(slug) => (slug.as_str().to_owned(), grant.display_name(slug)),
            McpDestination::Custom(key) => {
                (format!("custom-{key}"), "custom MCP server".to_owned())
            }
            McpDestination::Macro | McpDestination::Preview => {
                return Err(EgressError::Unroutable(
                    "only connected apps and custom servers are exchanged here".into(),
                ));
            }
        };
        let tool = request["params"]["name"]
            .as_str()
            .unwrap_or_default()
            .to_owned();
        let Some(prompter) = grant.approval_prompter(&server_slug, &tool) else {
            return Ok(None);
        };
        let status = self
            .approvals
            .hold_in_process(InProcessCall {
                session: grant.session,
                owner: grant.owner.clone(),
                prompter: prompter.clone(),
                server_slug,
                server_name,
                tool_name: tool.clone(),
                arguments: request["params"]["arguments"].clone(),
            })
            .await?;
        let current = self.sessions.authorize_session(grant.session).await?;
        if current.prompter != grant.prompter {
            return Ok(Some(
                "The original turn ended; this tool did not run.".into(),
            ));
        }
        Ok(refusal(status, grant.owner.email_str(), &tool))
    }
}

/// What a failed call says: it may have run upstream before failing.
const UNKNOWN_OUTCOME: &str = "The selected account's tool could not complete. Its outcome may be unknown; check state before retrying writes.";

async fn exchange_result(
    transport: &dyn crate::domain::ports::ActorMcpTransport,
    session: crate::domain::model::AgentSessionId,
    actor: macro_user_id::user_id::MacroUserIdStr<'static>,
    upstream: UpstreamCall,
    request: Value,
    listing: bool,
    macro_tools: bool,
) -> Result<ProxyResponse, EgressError> {
    let id = request["id"].clone();
    let mut result = match transport.exchange(session, actor, upstream, request).await {
        Ok(result) => result,
        Err(error) if !listing => {
            tracing::warn!(?error, "actor MCP exchange failed");
            return Ok(tool_result_response(id, UNKNOWN_OUTCOME.into()));
        }
        Err(error) => return Err(error),
    };
    if listing && let Some(tools) = result["tools"].as_array_mut() {
        tools.retain(|tool| {
            !tool["inputSchema"]["properties"]
                .as_object()
                .is_some_and(|properties| properties.contains_key(ai_toolset::actor::ACTING_AS))
        });
        for tool in tools {
            if macro_tools
                && !spends_owner_access(
                    MACRO_SERVER_SLUG,
                    tool["name"].as_str().unwrap_or_default(),
                )
            {
                continue;
            }
            if let Some(schema) = tool["inputSchema"].as_object_mut() {
                add_actor_schema(schema);
            }
        }
    }
    let body = serde_json::to_vec(&json!({"jsonrpc": "2.0", "id": id, "result": result}))
        .map_err(|error| EgressError::Internal(rootcause::report!(error).into()))?;
    let mut response = ProxyResponse::new(full_body(body.into()));
    response.headers_mut().insert(
        http::header::CONTENT_TYPE,
        http::HeaderValue::from_static("application/json"),
    );
    Ok(response)
}
