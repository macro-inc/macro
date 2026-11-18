use models_opensearch::SearchIndex;
use opensearch::BulkParts;

use crate::{
    Result,
    agent_session::{response_error, stored_parent},
    error::{OpensearchClientError, OpensearchOperation},
};

/// Remove a session parent and all of its message children.
///
/// The parent and the children its record names go by id, which applies
/// before any refresh. Delete-by-query then removes the rest, such as children
/// written before parents kept records. It skips the ids just deleted, which
/// it may still see, proceeds past conflicts with children an earlier
/// reconcile deleted, and forces no refresh.
pub(crate) async fn delete_agent_session(
    client: &opensearch::OpenSearch,
    agent_session_id: &str,
    index_override: Option<&str>,
) -> Result<()> {
    let index = index_override.unwrap_or(SearchIndex::AgentSessions.as_ref());
    let operation = OpensearchOperation::DeleteAgentSession;

    let mut deleted: Vec<String> = stored_parent(client, index, agent_session_id)
        .await?
        .and_then(|parent| parent.indexed_messages())
        .map(|record| record.into_keys().collect())
        .unwrap_or_default();
    deleted.push(agent_session_id.to_owned());

    let body: Vec<String> = deleted
        .iter()
        .map(|id| {
            serde_json::json!({ "delete": { "_id": id, "routing": agent_session_id } }).to_string()
        })
        .collect();
    let response = client
        .bulk(BulkParts::Index(index))
        .body(body)
        .send()
        .await
        .map_err(|error| OpensearchClientError::request_failed(operation, &error))?;
    if !response.status_code().is_success() {
        return response_error(response, operation).await;
    }
    let response_body: serde_json::Value = response
        .json()
        .await
        .map_err(|error| OpensearchClientError::deserialization_failed(operation, &error))?;
    if response_body["errors"].as_bool() == Some(true) {
        return Err(OpensearchClientError::Unknown {
            details: response_body.to_string(),
            operation,
        });
    }

    let routing = [agent_session_id];
    let response = client
        .delete_by_query(opensearch::DeleteByQueryParts::Index(&[index]))
        .routing(&routing)
        .conflicts(opensearch::params::Conflicts::Proceed)
        .body(serde_json::json!({
            "query": { "bool": {
                "filter": [{ "term": { "agent_session_id": agent_session_id } }],
                "must_not": [{ "ids": { "values": deleted } }]
            } }
        }))
        .send()
        .await
        .map_err(|error| OpensearchClientError::request_failed(operation, &error))?;

    crate::agent_session::check_delete_response(response, operation).await
}
