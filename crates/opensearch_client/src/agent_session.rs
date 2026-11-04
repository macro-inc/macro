use crate::{
    OpensearchClient, Result, delete,
    error::{OpensearchClientError, OpensearchOperation},
    upsert,
};

pub use upsert::agent_session::{
    AgentSessionMessageAuthor, AgentSessionMessageDocument, ReconcileAgentSessionArgs,
};

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

/// Delete-by-query may report partial failure in an otherwise successful HTTP response.
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
        || body["version_conflicts"]
            .as_u64()
            .is_some_and(|count| count > 0)
        || body["failures"]
            .as_array()
            .is_some_and(|items| !items.is_empty())
}

#[cfg(test)]
mod test;

impl OpensearchClient {
    /// Replace the searchable projection of one agent session with an
    /// authoritative folded snapshot.
    #[tracing::instrument(skip(self, args), err)]
    pub async fn reconcile_agent_session(
        &self,
        args: &ReconcileAgentSessionArgs,
        index_override: Option<&str>,
    ) -> Result<()> {
        upsert::agent_session::reconcile_agent_session(&self.inner, args, index_override).await
    }

    /// Delete the parent and every folded-message child for an agent session.
    #[tracing::instrument(skip(self), err)]
    pub async fn delete_agent_session(
        &self,
        agent_session_id: &str,
        index_override: Option<&str>,
    ) -> Result<()> {
        delete::agent_session::delete_agent_session(&self.inner, agent_session_id, index_override)
            .await
    }
}
