//! Stateless CRDT editing through the existing Cloudflare AI editing worker.
use crate::domain::{
    authoring::{AuthoringError, Code, ports::AuthoringEditor},
    collaboration::MAXIMUM_DOCUMENT_BYTES,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use models_forms::FormLayout;

/// HTTP adapter for the shared worker's Forms codec endpoint.
pub struct WorkerFormEditor {
    client: reqwest::Client,
    endpoint: String,
}
impl WorkerFormEditor {
    /// Reuse the host's configured AI editing worker origin.
    pub fn new(client: reqwest::Client, worker_url: String) -> Self {
        Self {
            client,
            endpoint: format!("{}/forms", worker_url.trim_end_matches('/')),
        }
    }
}
fn unavailable() -> AuthoringError {
    AuthoringError::new(
        Code::Unavailable,
        "form",
        "The AI editing worker could not prepare this edit. Retry the request.",
    )
}
impl AuthoringEditor for WorkerFormEditor {
    #[tracing::instrument(skip_all, err)]
    async fn prepare_edit(
        &self,
        snapshot: &[u8],
        layout: &FormLayout,
    ) -> Result<Vec<u8>, AuthoringError> {
        if snapshot.len() > MAXIMUM_DOCUMENT_BYTES {
            return Err(unavailable());
        }
        let mut headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);
        let mut response = self
            .client
            .post(&self.endpoint)
            .headers(headers)
            .timeout(std::time::Duration::from_secs(30))
            .json(&serde_json::json!({ "snapshot": STANDARD.encode(snapshot), "layout": layout }))
            .send()
            .await
            .map_err(|_| unavailable())?
            .error_for_status()
            .map_err(|_| unavailable())?;
        let mut update = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| unavailable())? {
            if update.len() + chunk.len() > MAXIMUM_DOCUMENT_BYTES {
                return Err(unavailable());
            }
            update.extend_from_slice(&chunk);
        }
        Ok(update)
    }
}
