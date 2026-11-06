use models_opensearch::SearchIndex;

use crate::{
    Result,
    error::{OpensearchClientError, OpensearchOperation},
};

/// Remove a session parent and all of its message children.
pub(crate) async fn delete_agent_session(
    client: &opensearch::OpenSearch,
    agent_session_id: &str,
    index_override: Option<&str>,
) -> Result<()> {
    let index = index_override.unwrap_or(SearchIndex::AgentSessions.as_ref());
    let routing = [agent_session_id];
    let response = client
        .delete_by_query(opensearch::DeleteByQueryParts::Index(&[index]))
        .routing(&routing)
        .body(serde_json::json!({
            "query": { "term": { "agent_session_id": agent_session_id } }
        }))
        .refresh(true)
        .send()
        .await
        .map_err(|error| {
            OpensearchClientError::request_failed(OpensearchOperation::DeleteAgentSession, &error)
        })?;

    crate::agent_session::check_delete_response(response, OpensearchOperation::DeleteAgentSession)
        .await
}
