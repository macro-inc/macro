//! Outbound adapter for the AI editing worker.

use crate::domain::ports::editing::{EditResult, EditUsage, EditingWorkerService};
use macro_sync_service_jwt::DocumentPermissionToken;
use reqwest::Client;
use std::sync::Arc;

/// Reqwest-backed client for the AI editing worker.
#[derive(Clone)]
pub struct ReqwestEditingWorkerClient {
    worker_url: String,
    client: Arc<Client>,
    internal_auth_key: Option<String>,
}

impl ReqwestEditingWorkerClient {
    /// Construct a new client.
    pub fn new(worker_url: String, client: Arc<Client>) -> Self {
        Self {
            worker_url,
            client,
            internal_auth_key: None,
        }
    }

    /// Construct a client backed by a fresh default reqwest client.
    pub fn from_url(worker_url: String) -> Self {
        Self::new(worker_url, Arc::new(Client::new()))
    }

    /// Set the internal auth key used to authenticate `delete_traces` calls.
    pub fn with_internal_auth_key(mut self, internal_auth_key: Option<String>) -> Self {
        self.internal_auth_key = internal_auth_key;
        self
    }
}

impl EditingWorkerService for ReqwestEditingWorkerClient {
    #[tracing::instrument(skip_all, fields(document_id), err)]
    async fn edit(
        &self,
        document_id: &str,
        document_token: &DocumentPermissionToken,
        instructions: &str,
    ) -> anyhow::Result<EditResult> {
        let request_body = serde_json::json!({
            "documentToken": document_token.as_str(),
            "documentId": document_id,
            "prompt": instructions,
            // Each role lists models tried in order: Cerebras primary, with an
            // Anthropic fallback so edits keep working if Cerebras is rate-limited
            // or down.
            "models": {
                "supervisor": [
                    { "provider": "anthropic", "model": "claude-opus-4-8" },
                    { "provider": "openai", "model": "gpt-5.5" },
                ],
                "interpret": [
                    { "provider": "cerebras", "model": "zai-glm-4.7" },
                    { "provider": "anthropic", "model": "claude-sonnet-4-6" },
                ],
                "coding": [
                    { "provider": "cerebras", "model": "gpt-oss-120b" },
                    { "provider": "anthropic", "model": "claude-haiku-4-5" },
                ],
                // Snippet composition: fast/cheap by default, escalating to a
                // strong prose model when the supervisor marks a spec
                // `effort: "high"`.
                "snippet": [
                    { "provider": "cerebras", "model": "gpt-oss-120b" },
                    { "provider": "anthropic", "model": "claude-haiku-4-5" },
                ],
                "snippetHigh": [
                    { "provider": "anthropic", "model": "claude-sonnet-4-6" },
                    { "provider": "cerebras", "model": "gpt-oss-120b" },
                ],
            },
            "interpret": false,
        });

        let edit_resp = self
            .client
            .post(format!("{}/edit", self.worker_url))
            .json(&request_body)
            .send()
            .await?;

        let status = edit_resp.status();
        if !status.is_success() {
            // The worker returns `{ "error": "..." }` with the real cause; surface
            // it instead of just the status so failures are debuggable.
            let body = edit_resp.text().await.unwrap_or_default();
            anyhow::bail!("editing worker returned {}: {}", status, body);
        }

        let body = edit_resp.json::<serde_json::Value>().await?;

        // The worker reports `usage` as an array of per-model entries
        // (`{ model, inputTokens, outputTokens }`, camelCase) — one per model it
        // ran (supervisor, interpret, coder).
        let usage = body["usage"]
            .as_array()
            .map(|entries| {
                entries
                    .iter()
                    .map(|e| EditUsage {
                        model: e["model"].as_str().unwrap_or_default().to_owned(),
                        input_tokens: e["inputTokens"].as_u64().unwrap_or(0) as u32,
                        output_tokens: e["outputTokens"].as_u64().unwrap_or(0) as u32,
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(EditResult {
            edits_applied: body["ops"].as_array().map(|a| a.len()).unwrap_or(0),
            usage,
            clarification: body["clarification"].as_str().map(str::to_owned),
        })
    }

    #[tracing::instrument(skip_all, fields(document_id), err)]
    async fn delete_traces(&self, document_id: &str) -> anyhow::Result<()> {
        let Some(internal_auth_key) = self.internal_auth_key.as_deref() else {
            anyhow::bail!("editing worker client has no internal auth key configured");
        };

        let resp = self
            .client
            .delete(format!("{}/traces/{}", self.worker_url, document_id))
            .header("x-internal-auth-key", internal_auth_key)
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("editing worker returned {}: {}", status, body);
        }

        Ok(())
    }
}
