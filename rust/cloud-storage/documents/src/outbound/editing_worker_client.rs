//! Outbound adapter for the AI editing worker.

use crate::domain::ports::editing::{EditResult, EditUsage, EditingWorkerService};
use reqwest::Client;
use std::sync::Arc;

/// Reqwest-backed client for the AI editing worker.
#[derive(Clone)]
pub struct ReqwestEditingWorkerClient {
    worker_url: String,
    client: Arc<Client>,
}

impl ReqwestEditingWorkerClient {
    /// Construct a new client.
    pub fn new(worker_url: String, client: Arc<Client>) -> Self {
        Self { worker_url, client }
    }

    /// Construct a client backed by a fresh default reqwest client.
    pub fn from_url(worker_url: String) -> Self {
        Self::new(worker_url, Arc::new(Client::new()))
    }
}

impl EditingWorkerService for ReqwestEditingWorkerClient {
    #[tracing::instrument(skip_all, fields(document_id), err)]
    async fn edit(
        &self,
        document_id: &str,
        user_token: &str,
        instructions: &str,
    ) -> anyhow::Result<EditResult> {
        let request_body = serde_json::json!({
            "userToken": user_token,
            "documentId": document_id,
            "prompt": instructions,
            "models": {
                "supervisor": { "provider": "anthropic", "model": "claude-haiku-4-5-20251001" },
                "interpret": { "provider": "anthropic", "model": "claude-sonnet-4-6" },
                "coding": { "provider": "cerebras", "model": "gpt-oss-120b" },
            },
            "interpret": true,
        });

        let edit_resp = self
            .client
            .post(format!("{}/edit", self.worker_url))
            .json(&request_body)
            .send()
            .await?;

        let status = edit_resp.status();
        if !status.is_success() {
            anyhow::bail!("editing worker returned {}", status);
        }

        let body = edit_resp.json::<serde_json::Value>().await?;

        Ok(EditResult {
            edits_applied: body["ops"].as_array().map(|a| a.len()).unwrap_or(0),
            usage: body["usage"].as_object().map(|_| EditUsage {
                input_tokens: body["usage"]["input_tokens"]
                    .as_u64()
                    .unwrap_or(0) as u32,
                output_tokens: body["usage"]["output_tokens"]
                    .as_u64()
                    .unwrap_or(0) as u32,
            }),
            clarification: body["clarification"].as_str().map(str::to_owned),
        })
    }
}
