//! EditDocument tool — applies AI-driven edits to a document via the editing worker.

use ai_toolset::{
    AsyncTool, AsyncToolCollection, RequestContext, ServiceContext, ToolCallError, ToolResult,
};
use async_trait::async_trait;
use reqwest::Client;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

const DSS_AUTH_HEADER: &str = "x-document-storage-service-auth-key";
const DSS_USER_ID_HEADER: &str = "x-document-storage-service-user-id";

/// Service context for the EditDocument tool.
#[derive(Clone)]
pub struct EditDocumentToolContext {
    /// Base URL of the document storage service, used to fetch permission tokens.
    pub dss_url: String,
    /// Internal auth key for the document storage service.
    pub dss_auth_key: String,
    /// Base URL of the AI editing worker.
    pub worker_url: String,
    /// Shared HTTP client.
    pub client: Arc<Client>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(
    title = "EditDocument",
    description = "Apply AI-driven edits to a Macro document in place. Use this when the user wants to make changes to the content of an existing document — rewriting sections, inserting new content, applying formatting, or restructuring. Returns the number of edits applied."
)]
pub struct EditDocument {
    #[schemars(description = "The ID of the document to edit.")]
    pub document_id: String,
    #[schemars(
        description = "Natural language instructions describing the changes to make to the document."
    )]
    pub instructions: String,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct EditDocumentResponse {
    /// Number of individual edit operations applied to the document.
    pub edits_applied: usize,
    pub usage: Option<EditUsage>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct EditUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
}

#[async_trait]
impl AsyncTool<EditDocumentToolContext> for EditDocument {
    type Output = EditDocumentResponse;

    #[tracing::instrument(skip_all, fields(document_id = %self.document_id), err)]
    async fn call(
        &self,
        ctx: ServiceContext<EditDocumentToolContext>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        // Fetch a permission token from DSS on behalf of the calling user.
        let token_resp = ctx
            .client
            .post(format!(
                "{}/documents/permissions_token/{}",
                ctx.dss_url, self.document_id
            ))
            .header(DSS_AUTH_HEADER, &ctx.dss_auth_key)
            .header(DSS_USER_ID_HEADER, request_context.user_id.to_string())
            .send()
            .await
            .map_err(|e| ToolCallError {
                description: "could not reach document service".into(),
                internal_error: e.into(),
            })?;

        let status = token_resp.status();
        if status.as_u16() == 403 || status.as_u16() == 404 {
            return Err(ToolCallError {
                description: "document not found or you don't have edit access".into(),
                internal_error: anyhow::anyhow!("DSS returned {status}"),
            });
        }
        if !status.is_success() {
            return Err(ToolCallError {
                description: "failed to get document permission token".into(),
                internal_error: anyhow::anyhow!("DSS returned {status}"),
            });
        }

        let token_body: serde_json::Value = token_resp.json().await.map_err(|e| ToolCallError {
            description: "invalid response from document service".into(),
            internal_error: e.into(),
        })?;
        let token = token_body["token"]
            .as_str()
            .ok_or_else(|| ToolCallError {
                description: "document service returned no token".into(),
                internal_error: anyhow::anyhow!("missing 'token' field in DSS response"),
            })?
            .to_string();

        // Call the editing worker, retrying transient 5xx (e.g. the worker
        // hot-reloading mid-request, or an upstream model provider blip).
        let request_body = serde_json::json!({
            "token": token,
            "documentId": self.document_id,
            "prompt": self.instructions,
            "models": {
                "supervisor": { "provider": "cerebras", "model": "zai-glm-4.7" },
                "interpret": { "provider": "cerebras", "model": "gpt-oss-120b" },
                "coding": { "provider": "cerebras", "model": "gpt-oss-120b" },
            },
            "interpret": true,
        });

        const MAX_ATTEMPTS: u32 = 3;
        let mut last_status = None;
        let mut body = None;
        for attempt in 1..=MAX_ATTEMPTS {
            let edit_resp = ctx
                .client
                .post(format!("{}/edit", ctx.worker_url))
                .json(&request_body)
                .send()
                .await
                .map_err(|e| ToolCallError {
                    description: "could not reach editing service".into(),
                    internal_error: e.into(),
                })?;

            let status = edit_resp.status();
            if status.is_success() {
                body = Some(edit_resp.json::<serde_json::Value>().await.map_err(|e| {
                    ToolCallError {
                        description: "invalid response from editing service".into(),
                        internal_error: e.into(),
                    }
                })?);
                break;
            }

            last_status = Some(status);
            if status.is_server_error() && attempt < MAX_ATTEMPTS {
                tokio::time::sleep(std::time::Duration::from_millis(500 * attempt as u64)).await;
                continue;
            }
            break;
        }

        let Some(body) = body else {
            let status = last_status.expect("loop ran at least once");
            return Err(ToolCallError {
                description: "editing service returned an error".into(),
                internal_error: anyhow::anyhow!("worker returned {status}"),
            });
        };

        Ok(EditDocumentResponse {
            edits_applied: body["ops"].as_array().map(|a| a.len()).unwrap_or(0),
            usage: serde_json::from_value(body["usage"].clone()).ok(),
        })
    }
}

/// Create the editing toolset.
pub fn edit_document_toolset() -> AsyncToolCollection<EditDocumentToolContext> {
    AsyncToolCollection::new().add_tool::<EditDocument, _>()
}
