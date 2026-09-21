use models_opensearch::SearchIndex;
use opensearch::BulkParts;
use serde::Serialize;

use crate::{Result, date_format::EpochMillis, error::OpensearchClientError};

#[cfg(test)]
mod test;

const PARENT_RELATION: &str = "agent_session";
const CHILD_RELATION: &str = "message";

/// The two author sides of a folded conversation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, strum::Display)]
#[serde(rename_all = "lowercase")]
#[strum(serialize_all = "lowercase")]
pub enum AgentSessionMessageAuthor {
    /// A user's prompt.
    User,
    /// The agent's reply.
    Agent,
}

/// One folded message in an authoritative agent-session projection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentSessionMessageDocument {
    /// Stable turn number assigned by `agent_fold`.
    pub turn: u32,
    /// Stable author side (`user` or `agent`).
    pub author: AgentSessionMessageAuthor,
    /// Attributed user for a user-authored prompt, when known.
    pub author_user_id: Option<String>,
    /// Text flattened from the folded, renderable message vocabulary.
    pub content: String,
}

/// Complete searchable projection of one agent session.
#[derive(Debug, Clone)]
pub struct ReconcileAgentSessionArgs {
    /// Agent-session UUID.
    pub agent_session_id: String,
    /// User-facing session name.
    pub name: String,
    /// Owner recorded by the authoritative session row.
    pub owner_id: String,
    /// Agent persona behind the session.
    pub bot_id: String,
    /// Originating thread, when the session was opened from one.
    pub thread_id: Option<String>,
    /// Message that opened the session, when any.
    pub originating_message_id: Option<String>,
    /// Session creation time.
    pub created_at_millis: EpochMillis,
    /// Latest persisted session metadata time.
    pub updated_at_millis: EpochMillis,
    /// Opaque identity of this complete projection. Every document written by
    /// one reconcile carries it so obsolete children can be pruned.
    pub projection_generation: String,
    /// Every currently folded message, oldest first.
    pub messages: Vec<AgentSessionMessageDocument>,
}

#[derive(Serialize)]
struct ParentDocument<'a> {
    agent_session_id: &'a str,
    projection_generation: &'a str,
    name: &'a str,
    owner_id: &'a str,
    bot_id: &'a str,
    thread_id: Option<&'a str>,
    originating_message_id: Option<&'a str>,
    created_at_millis: EpochMillis,
    updated_at_millis: EpochMillis,
    agent_session_relation: &'static str,
}

#[derive(Serialize)]
struct ChildDocument<'a> {
    agent_session_id: &'a str,
    projection_generation: &'a str,
    message_turn: u32,
    author: AgentSessionMessageAuthor,
    author_user_id: Option<&'a str>,
    content: &'a str,
    agent_session_relation: ChildRelation<'a>,
}

#[derive(Serialize)]
struct ChildRelation<'a> {
    name: &'static str,
    parent: &'a str,
}

fn resolve_destination(index_override: Option<&str>) -> &str {
    index_override.unwrap_or(SearchIndex::AgentSessions.as_ref())
}

fn child_id(agent_session_id: &str, message: &AgentSessionMessageDocument) -> String {
    format!("{agent_session_id}:{}:{}", message.turn, message.author)
}

fn parent_document(args: &ReconcileAgentSessionArgs) -> ParentDocument<'_> {
    ParentDocument {
        agent_session_id: &args.agent_session_id,
        projection_generation: &args.projection_generation,
        name: &args.name,
        owner_id: &args.owner_id,
        bot_id: &args.bot_id,
        thread_id: args.thread_id.as_deref(),
        originating_message_id: args.originating_message_id.as_deref(),
        created_at_millis: args.created_at_millis,
        updated_at_millis: args.updated_at_millis,
        agent_session_relation: PARENT_RELATION,
    }
}

fn child_document<'a>(
    args: &'a ReconcileAgentSessionArgs,
    message: &'a AgentSessionMessageDocument,
) -> ChildDocument<'a> {
    ChildDocument {
        agent_session_id: &args.agent_session_id,
        projection_generation: &args.projection_generation,
        message_turn: message.turn,
        author: message.author,
        author_user_id: message.author_user_id.as_deref(),
        content: &message.content,
        agent_session_relation: ChildRelation {
            name: CHILD_RELATION,
            parent: &args.agent_session_id,
        },
    }
}

fn serialization_error(method: &str, error: impl std::fmt::Display) -> OpensearchClientError {
    OpensearchClientError::DeserializationFailed {
        details: error.to_string(),
        method: Some(method.to_owned()),
    }
}

async fn response_error(
    response: opensearch::http::response::Response,
    method: &str,
) -> Result<()> {
    let status_code = response.status_code();
    if status_code.is_success() {
        return Ok(());
    }
    let body = response
        .text()
        .await
        .map_err(|error| serialization_error(method, error))?;
    tracing::error!(%status_code, %body, "agent-session OpenSearch operation failed");
    Err(OpensearchClientError::Unknown {
        details: body,
        method: Some(method.to_owned()),
    })
}

/// Write the current parent and children, then remove documents from older
/// projections. Callers serialize reconciles by session id.
pub(crate) async fn reconcile_agent_session(
    client: &opensearch::OpenSearch,
    args: &ReconcileAgentSessionArgs,
    index_override: Option<&str>,
) -> Result<()> {
    let index = resolve_destination(index_override);
    let routing = args.agent_session_id.as_str();

    let parent = client
        .index(opensearch::IndexParts::IndexId(
            index,
            &args.agent_session_id,
        ))
        .routing(routing)
        // Normal writes must never auto-create an index under the alias name.
        // Backfills may explicitly target a pre-provisioned physical index.
        .require_alias(index_override.is_none())
        .body(parent_document(args))
        .refresh(opensearch::params::Refresh::WaitFor)
        .send()
        .await
        .map_err(|error| serialization_error("reconcile_agent_session_parent", error))?;
    response_error(parent, "reconcile_agent_session_parent").await?;

    if !args.messages.is_empty() {
        let mut body = Vec::with_capacity(args.messages.len() * 2);
        for message in &args.messages {
            body.push(
                serde_json::to_string(&serde_json::json!({
                    "index": {
                        "_id": child_id(&args.agent_session_id, message),
                        "routing": routing,
                    }
                }))
                .map_err(|error| serialization_error("reconcile_agent_session_bulk", error))?,
            );
            body.push(
                serde_json::to_string(&child_document(args, message))
                    .map_err(|error| serialization_error("reconcile_agent_session_bulk", error))?,
            );
        }

        let response = client
            .bulk(BulkParts::Index(index))
            .require_alias(index_override.is_none())
            .body(body)
            .refresh(opensearch::params::Refresh::WaitFor)
            .send()
            .await
            .map_err(|error| serialization_error("reconcile_agent_session_bulk", error))?;
        let status_code = response.status_code();
        if !status_code.is_success() {
            return response_error(response, "reconcile_agent_session_bulk").await;
        }
        let response_body: serde_json::Value = response
            .json()
            .await
            .map_err(|error| serialization_error("reconcile_agent_session_bulk", error))?;
        if response_body["errors"].as_bool() == Some(true) {
            tracing::error!(body=?response_body, "agent-session bulk reconcile had failed items");
            return Err(OpensearchClientError::Unknown {
                details: response_body.to_string(),
                method: Some("reconcile_agent_session_bulk".to_owned()),
            });
        }
    }

    let prune_query = serde_json::json!({
        "query": {
            "bool": {
                "filter": [{ "term": { "agent_session_id": &args.agent_session_id } }],
                "must_not": [{
                    "term": { "projection_generation": &args.projection_generation }
                }]
            }
        }
    });
    let routing_values = [routing];
    let response = client
        .delete_by_query(opensearch::DeleteByQueryParts::Index(&[index]))
        .routing(&routing_values)
        .body(prune_query)
        .refresh(true)
        .send()
        .await
        .map_err(|error| serialization_error("reconcile_agent_session_prune", error))?;
    crate::agent_session::check_delete_response(response, "reconcile_agent_session_prune").await
}
