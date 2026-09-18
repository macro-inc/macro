//! Outbound adapter for the AI editing worker.

use crate::domain::ports::editing::{EditMode, EditResult, EditUsage, EditingWorkerService};
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
    #[cfg(feature = "ai_tools")]
    #[tracing::instrument(skip_all, fields(document_id), err)]
    async fn spreadsheet(
        &self,
        document_id: &str,
        document_token: &DocumentPermissionToken,
        request: &crate::domain::spreadsheet::SpreadsheetRequest,
    ) -> anyhow::Result<crate::domain::spreadsheet::SpreadsheetResponse> {
        let mut headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);
        let response = self
            .client
            .post(format!("{}/spreadsheet", self.worker_url))
            .headers(headers)
            .timeout(std::time::Duration::from_secs(45))
            .json(&serde_json::json!({
                "documentId": document_id,
                "documentToken": document_token.as_str(),
                "request": request,
            }))
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            let body = response
                .json::<serde_json::Value>()
                .await
                .unwrap_or_default();
            let message = body.get("error").and_then(serde_json::Value::as_str)
                .unwrap_or("Spreadsheet operation failed. Read the workbook again before retrying an edit.");
            anyhow::bail!("{message} (HTTP {status})");
        }
        Ok(response.json().await?)
    }

    #[tracing::instrument(skip_all, fields(document_id), err)]
    async fn edit(
        &self,
        document_id: &str,
        document_token: &DocumentPermissionToken,
        instructions: &str,
        mode: EditMode,
    ) -> anyhow::Result<EditResult> {
        let request_body = serde_json::json!({
            "documentToken": document_token.as_str(),
            "documentId": document_id,
            "prompt": instructions,
            "mode": match mode {
                EditMode::Supervised => "supervised",
                EditMode::Fast => "fast",
            },
            "models": {
                "supervisor": [
                    { "provider": "anthropic", "model": "claude-opus-4-8" },
                    { "provider": "anthropic", "model": "claude-sonnet-4-6" },
                    { "provider": "openai", "model": "gpt-5.5" },
                ],
                "interpret": [
                    { "provider": "cerebras", "model": "zai-glm-4.7" },
                    { "provider": "anthropic", "model": "claude-sonnet-4-6" },
                ],
                // gpt-5.5 leads the coding chain on testbench evidence: replaying
                // the same 16 prod sessions in the animated (production)
                // configuration, against the cerebras/haiku chain it cut the
                // coder retry rate from 37% to 9% (coders retrying 16 -> 2),
                // runCode calls -63%, input tokens -61%, cost -35%, and judged
                // quality improved (fully correct 12/16 -> 14/16, purpose met
                // 14/16 -> 15/16) with no damaging sessions either way.
                //
                // haiku stays as the fallback: OpenAI throttles hard under
                // concurrency, and a throttled bench run at 4-way parallelism
                // timed out on 24 of 40 cases where a serial run had none.
                "coding": [
                    { "provider": "openai", "model": "gpt-5.5" },
                    { "provider": "anthropic", "model": "claude-haiku-4-5" },
                ],
                // The fast path's single model; mirrors the web client's chain
                // (apps/web ai-editing-worker/client.ts). Gemini 3.8 Flash ran
                // a real inline edit in 1.5-5 s with no thinking tokens where
                // 3.7 Flash took 3.8-5.4 s; Haiku is the provider-error fallback.
                "fast": [
                    { "provider": "google", "model": "gemini-3.8-flash" },
                    { "provider": "anthropic", "model": "claude-haiku-4-5" },
                ],
            },
            "interpret": false,
        });

        // Propagate the current trace so the worker's spans join this
        // service's trace instead of rooting their own.
        let mut headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);

        let edit_resp = self
            .client
            .post(format!("{}/edit", self.worker_url))
            .headers(headers)
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

        let mut headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);

        let resp = self
            .client
            .delete(format!("{}/traces/{}", self.worker_url, document_id))
            .headers(headers)
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
