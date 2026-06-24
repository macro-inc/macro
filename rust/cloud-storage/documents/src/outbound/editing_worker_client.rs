//! Outbound adapter for the AI editing worker.

use crate::domain::ports::editing::{EditResult, EditUsage, EditingWorkerService};
use reqwest::Client;
use std::sync::Arc;

const DSS_AUTH_HEADER: &str = "x-document-storage-service-auth-key";
const DSS_USER_ID_HEADER: &str = "x-document-storage-service-user-id";

/// Reqwest-backed client for the AI editing worker.
#[derive(Clone)]
pub struct ReqwestEditingWorkerClient {
    dss_url: String,
    dss_auth_key: String,
    worker_url: String,
    client: Arc<Client>,
}

impl ReqwestEditingWorkerClient {
    /// Construct a new client.
    pub fn new(
        dss_url: String,
        dss_auth_key: String,
        worker_url: String,
        client: Arc<Client>,
    ) -> Self {
        Self {
            dss_url,
            dss_auth_key,
            worker_url,
            client,
        }
    }
}

impl EditingWorkerService for ReqwestEditingWorkerClient {
    #[tracing::instrument(skip_all, fields(document_id), err)]
    async fn edit(
        &self,
        document_id: &str,
        user_id: &str,
        instructions: &str,
    ) -> anyhow::Result<EditResult> {
        let token_resp = self
            .client
            .post(format!(
                "{}/documents/permissions_token/{}",
                self.dss_url, document_id
            ))
            .header(DSS_AUTH_HEADER, &self.dss_auth_key)
            .header(DSS_USER_ID_HEADER, user_id)
            .send()
            .await?;

        let status = token_resp.status();
        anyhow::ensure!(
            status.as_u16() != 403 && status.as_u16() != 404,
            "document not found or you don't have edit access"
        );
        anyhow::ensure!(
            status.is_success(),
            "failed to get document permission token: {status}"
        );

        let token_body: serde_json::Value = token_resp.json().await?;
        let token = token_body["token"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("missing 'token' field in DSS response"))?
            .to_string();

        let request_body = serde_json::json!({
            "token": token,
            "documentId": document_id,
            "prompt": instructions,
            "models": {
                "supervisor": { "provider": "anthropic", "model": "claude-haiku-4-5-20251001" },
                "interpret": { "provider": "anthropic", "model": "claude-sonnet-4-6" },
                "coding": { "provider": "cerebras", "model": "gpt-oss-120b" },
            },
            "interpret": true,
        });

        const MAX_ATTEMPTS: u32 = 3;
        let mut last_status = None;
        let mut body = None;
        for attempt in 1..=MAX_ATTEMPTS {
            let edit_resp = self
                .client
                .post(format!("{}/edit", self.worker_url))
                .json(&request_body)
                .send()
                .await?;

            let status = edit_resp.status();
            if status.is_success() {
                body = Some(edit_resp.json::<serde_json::Value>().await?);
                break;
            }

            last_status = Some(status);
            if status.is_server_error() && attempt < MAX_ATTEMPTS {
                tokio::time::sleep(std::time::Duration::from_millis(500 * attempt as u64)).await;
                continue;
            }
            break;
        }

        let body = body.ok_or_else(|| {
            anyhow::anyhow!(
                "editing worker returned {}",
                last_status.expect("loop ran at least once")
            )
        })?;

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
        })
    }
}
