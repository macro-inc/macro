use crate::{OpensearchClient, Result, delete, upsert};

pub use upsert::agent_session::{
    AgentSessionMessageAuthor, AgentSessionMessageDocument, ReconcileAgentSessionArgs,
};

/// Delete-by-query may report partial failure in an otherwise successful HTTP response.
pub(crate) async fn check_delete_response(
    response: opensearch::http::response::Response,
    method: &str,
) -> Result<()> {
    let status = response.status_code();
    let body: serde_json::Value = response.json().await.map_err(|error| {
        crate::error::OpensearchClientError::DeserializationFailed {
            details: error.to_string(),
            method: Some(method.to_owned()),
        }
    })?;
    if !status.is_success() || delete_failed(&body) {
        return Err(crate::error::OpensearchClientError::Unknown {
            details: body.to_string(),
            method: Some(method.to_owned()),
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
