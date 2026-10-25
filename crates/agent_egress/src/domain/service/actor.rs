//! Resolve each call's explicit actor before credentials or approvals.

use super::*;
use crate::domain::model::{SessionGrant, tool_result_response};
use agent_session::domain::model::TurnPrompter;
use ai_toolset::actor::{ToolActor, add_actor_schema};
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
        let resolution = match self.credentials.resolve(user, destination).await {
            Ok(resolution) => resolution,
            Err(EgressError::UnknownCustomServer(_)) if !listing => return Ok(tool_result_response(id,
                "This custom MCP server is not connected for the selected actor. Ask them to add or reconnect that server in Agents → Connections. Do not switch accounts unless they requested it.".into())),
            Err(error) => return Err(error),
        };
        let upstream = match resolution {
            McpResolution::Connected(call) => call,
            McpResolution::Unconnected(call) if listing => call,
            McpResolution::Unconnected(_) => {
                if let McpDestination::Connected(slug) = destination {
                    return Ok(not_connected_tool_result(
                        slug,
                        &grant.display_name(slug),
                        id,
                    ));
                }
                return Ok(tool_result_response(
                    id,
                    "The selected actor has no connection for this tool.".into(),
                ));
            }
            McpResolution::Disconnected { call, .. } if listing => call,
            McpResolution::Disconnected { name, .. } => {
                return Ok(disconnected_tool_result(&name, id));
            }
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
}

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
            return Ok(tool_result_response(id, "The selected account's tool could not complete. Its outcome may be unknown; check state before retrying writes.".into()));
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
