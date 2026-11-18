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
}

/// Read a session's parent in real time, so it reflects the last write even
/// before a refresh. A missing parent, or a missing index, reads as `None`;
/// the writes that follow report a missing alias.
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
    if response.status_code() == opensearch::http::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !response.status_code().is_success() {
        return response_error(response, operation).await.map(|()| None);
    }
    let mut body: serde_json::Value = response
        .json()
        .await
        .map_err(|error| OpensearchClientError::deserialization_failed(operation, &error))?;
    Ok(body
        .get_mut("_source")
        .map(|source| StoredParent(source.take())))
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

/// Delete-by-query may report partial failure in an otherwise successful HTTP
/// response. Agent-session queries proceed past version conflicts: a
/// conflicting document was changed or deleted since the query's view, so
/// leaving it is the intended outcome, and conflicts are not failures.
pub(crate) async fn check_delete_response(
    response: opensearch::http::response::Response,
    operation: OpensearchOperation,
) -> Result<()> {
    if !response.status_code().is_success() {
        return response_error(response, operation).await;
    }
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|error| OpensearchClientError::deserialization_failed(operation, &error))?;
    if delete_failed(&body) {
        return Err(OpensearchClientError::Unknown {
            details: body.to_string(),
            operation,
        });
    }
    Ok(())
}

fn delete_failed(body: &serde_json::Value) -> bool {
    body["timed_out"].as_bool() == Some(true)
        || body["failures"]
            .as_array()
            .is_some_and(|items| !items.is_empty())
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
    #[tracing::instrument(skip(self), err)]
    pub async fn delete_agent_session(
        &self,
        agent_session_id: &str,
        index_override: Option<&str>,
    ) -> Result<()> {
        resend_on_lost_connection(|| {
            delete::agent_session::delete_agent_session(
                &self.inner,
                agent_session_id,
                index_override,
            )
        })
        .await
    }
}
