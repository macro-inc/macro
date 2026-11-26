use std::collections::BTreeMap;

use crate::{
    OpensearchClient, Result, delete,
    error::{OpensearchClientError, OpensearchOperation},
    retry::resend_on_lost_connection,
    upsert,
};

pub use upsert::agent_session::{
    AgentSessionMessageAuthor, AgentSessionMessageDocument, AgentSessionReconcileWrites,
    ReconcileAgentSessionArgs,
};

/// Child id to content hash of each message child a parent's session holds.
pub(crate) type IndexedMessages = BTreeMap<String, String>;

/// A session's parent document as the index holds it.
pub(crate) struct StoredParent(serde_json::Value);

impl StoredParent {
    pub(crate) fn source(&self) -> &serde_json::Value {
        &self.0
    }

    /// The parent's record of its children; parents written before records
    /// were kept have none.
    pub(crate) fn indexed_messages(&self) -> Option<IndexedMessages> {
        serde_json::from_value(self.0.get("indexed_messages")?.clone()).ok()
    }

    /// Children a reconcile set out to change and did not confirm.
    pub(crate) fn pending_messages(&self) -> Vec<String> {
        self.0
            .get("pending_messages")
            .and_then(|pending| serde_json::from_value(pending.clone()).ok())
            .unwrap_or_default()
    }
}

/// Read a session's parent in real time, so it reflects the last write even
/// before a refresh. A missing parent reads as `None`. A missing index or
/// alias is an error: every delete that follows would create an index under
/// that name, which `require_alias` does not prevent for deletes.
#[tracing::instrument(skip_all)]
pub(crate) async fn stored_parent(
    client: &opensearch::OpenSearch,
    index: &str,
    agent_session_id: &str,
) -> Result<Option<StoredParent>> {
    let operation = OpensearchOperation::ReadAgentSessionParent;
    let response = client
        .get(opensearch::GetParts::IndexId(index, agent_session_id))
        .routing(agent_session_id)
        .send()
        .await
        .map_err(|error| OpensearchClientError::request_failed(operation, &error))?;
    let status_code = response.status_code();
    if status_code != opensearch::http::StatusCode::NOT_FOUND && !status_code.is_success() {
        return response_error(response, operation).await.map(|()| None);
    }
    let mut body: serde_json::Value = response
        .json()
        .await
        .map_err(|error| OpensearchClientError::deserialization_failed(operation, &error))?;
    if reports_error(&body) {
        return Err(OpensearchClientError::Unknown {
            details: body.to_string(),
            operation,
        });
    }
    Ok(body
        .get_mut("_source")
        .map(|source| StoredParent(source.take())))
}

/// A missing document reads `found: false`; a 404 that carries an error, such
/// as `index_not_found_exception`, is about the index itself.
fn reports_error(body: &serde_json::Value) -> bool {
    body.get("error").is_some()
}

/// Most leftover children one sweep finds. Leftovers are rare and few, and the
/// search runs on every reconcile, so its page stays small. A reconcile leaves
/// any beyond it to its next sweep; a session delete fails instead, so its
/// retry finds the rest before the parent goes.
pub(crate) const SWEEP_LIMIT: usize = 1_000;

/// Ids of a session's children other than `keep`, as of the last refresh.
#[tracing::instrument(skip_all)]
pub(crate) async fn unrecorded_children(
    client: &opensearch::OpenSearch,
    index: &str,
    agent_session_id: &str,
    keep: &[&str],
    operation: OpensearchOperation,
) -> Result<Vec<String>> {
    let routing = [agent_session_id];
    let response = client
        .search(opensearch::SearchParts::Index(&[index]))
        .routing(&routing)
        .body(serde_json::json!({
            "size": SWEEP_LIMIT,
            "_source": false,
            "query": { "bool": {
                "filter": [{ "term": { "agent_session_id": agent_session_id } }],
                "must_not": [{ "ids": { "values": keep } }]
            } }
        }))
        .send()
        .await
        .map_err(|error| OpensearchClientError::request_failed(operation, &error))?;
    if !response.status_code().is_success() {
        return response_error(response, operation)
            .await
            .map(|()| Vec::new());
    }
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|error| OpensearchClientError::deserialization_failed(operation, &error))?;
    Ok(body["hits"]["hits"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|hit| hit["_id"].as_str().map(str::to_owned))
        .collect())
}

/// A bulk action on one of a session's documents, fenced by `version`: the
/// index refuses it when the document already holds a later version, so a
/// delayed request from an earlier reconcile cannot overwrite a later one.
pub(crate) fn fenced_action(
    action: &str,
    id: &str,
    routing: &str,
    version: i64,
) -> serde_json::Value {
    serde_json::json!({ action: {
        "_id": id,
        "routing": routing,
        "version": version,
        "version_type": "external_gte",
    } })
}

/// Delete a session's documents by id under `version`, failing unless every
/// delete applied or found nothing to delete. An older version than a
/// document holds is refused, so a delayed delete cannot remove what a later
/// reconcile wrote.
#[tracing::instrument(skip_all, fields(deleted = ids.len()))]
pub(crate) async fn delete_by_id(
    client: &opensearch::OpenSearch,
    index: &str,
    agent_session_id: &str,
    ids: &[String],
    version: i64,
    operation: OpensearchOperation,
) -> Result<()> {
    let body: Vec<String> = ids
        .iter()
        .map(|id| fenced_action("delete", id, agent_session_id, version).to_string())
        .collect();
    let response = client
        .bulk(opensearch::BulkParts::Index(index))
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
    Ok(())
}

/// Report a failed status with its body as sent; a gateway error page is not JSON.
pub(crate) async fn response_error(
    response: opensearch::http::response::Response,
    operation: OpensearchOperation,
) -> Result<()> {
    let status_code = response.status_code();
    if status_code.is_success() {
        return Ok(());
    }
    let body = response
        .text()
        .await
        .map_err(|error| OpensearchClientError::deserialization_failed(operation, &error))?;
    tracing::error!(%status_code, %body, %operation, "agent-session OpenSearch operation failed");
    Err(OpensearchClientError::Unknown {
        details: body,
        operation,
    })
}

#[cfg(test)]
mod test;

impl OpensearchClient {
    /// Bring the searchable projection of one agent session in line with an
    /// authoritative folded snapshot, writing only what changed.
    #[tracing::instrument(skip(self, args), err)]
    pub async fn reconcile_agent_session(
        &self,
        args: &ReconcileAgentSessionArgs,
        index_override: Option<&str>,
    ) -> Result<AgentSessionReconcileWrites> {
        resend_on_lost_connection(|| {
            upsert::agent_session::reconcile_agent_session(&self.inner, args, index_override)
        })
        .await
    }

    /// Delete the parent and every folded-message child for an agent session.
    /// `version` orders the deletes after every write of earlier reconciles.
    #[tracing::instrument(skip(self), err)]
    pub async fn delete_agent_session(
        &self,
        agent_session_id: &str,
        index_override: Option<&str>,
        version: u64,
    ) -> Result<()> {
        resend_on_lost_connection(|| {
            delete::agent_session::delete_agent_session(
                &self.inner,
                agent_session_id,
                index_override,
                version,
            )
        })
        .await
    }
}
