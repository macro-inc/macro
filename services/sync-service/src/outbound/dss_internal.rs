use serde::Serialize;
use tracing::error;
use worker::{Env, Fetch, Method, Request, RequestInit};

use crate::constants::header_names::MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY;
use crate::domain::document::DocumentAttribution;

/// Why a document interaction was reported to DSS.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InteractionReason {
    /// A periodic save of pending content changes.
    Edited,
    /// The first peer joined the document session.
    FirstJoin,
    /// The last connected peer left the document session.
    LastLeave,
}

#[derive(Serialize)]
struct InteractionRequest {
    reason: InteractionReason,
}

pub trait DssInternal {
    /// Uploads the raw snapshot bytes for storage.
    async fn publish_shallow_snapshot(
        &self,
        document_id: &str,
        snapshot: &[u8],
    ) -> worker::Result<()>;

    /// Reports an interaction (join/leave/periodic edit).
    async fn publish_interaction(
        &self,
        document_id: &str,
        reason: InteractionReason,
    ) -> worker::Result<()>;

    /// Let the document backend resolve content type and notify its consumers.
    async fn publish_sync_content_updated(
        &self,
        document_id: &str,
        editors: Vec<DocumentAttribution>,
    ) -> worker::Result<()>;
}

pub struct DssInternalClient<'a> {
    env: &'a Env,
}

impl<'a> DssInternalClient<'a> {
    pub fn new(env: &'a Env) -> Self {
        Self { env }
    }

    fn dss_url(&self) -> worker::Result<String> {
        Ok(self.env.var("DSS_URL")?.to_string())
    }

    fn internal_auth_key(&self) -> worker::Result<String> {
        self.env
            .secret("DSS_INTERNAL_AUTH_KEY")
            .map(|value| value.to_string())
            .or_else(|_| {
                self.env
                    .var("DSS_INTERNAL_AUTH_KEY")
                    .map(|value| value.to_string())
            })
    }
}

impl DssInternal for DssInternalClient<'_> {
    async fn publish_sync_content_updated(
        &self,
        document_id: &str,
        editors: Vec<DocumentAttribution>,
    ) -> worker::Result<()> {
        let url = format!(
            "{}/internal/documents/{document_id}/sync-content-updated",
            self.dss_url()?,
        );
        let mut body = if editors.is_empty() {
            serde_json::json!({})
        } else {
            serde_json::json!({ "editors": editors })
        };
        loop {
            let mut request = Request::new_with_init(
                &url,
                RequestInit::new()
                    .with_method(Method::Post)
                    .with_body(Some(body.to_string().into())),
            )?;
            request.headers_mut()?.set(
                MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY,
                &self.internal_auth_key()?,
            )?;
            request
                .headers_mut()?
                .set("Content-Type", "application/json")?;
            let response = Fetch::Request(request).send().await?;
            match response.status_code() {
                200 => return Ok(()),
                422 if body.get("editors").is_some() => {
                    // Older DSS rejects unknown fields. Preserve search during
                    // mixed-version deployments by dropping optional activity hints.
                    body = serde_json::json!({});
                }
                status => {
                    return Err(worker::Error::from(format!(
                        "DSS sync-content notification returned {status}",
                    )));
                }
            }
        }
    }

    async fn publish_shallow_snapshot(
        &self,
        document_id: &str,
        snapshot: &[u8],
    ) -> worker::Result<()> {
        let url = format!(
            "{}/internal/documents/{}/snapshot",
            self.dss_url()?,
            document_id
        );
        let auth_key = self.internal_auth_key()?;

        let mut req = Request::new_with_init(
            &url,
            RequestInit::new()
                .with_method(Method::Put)
                .with_body(Some(snapshot.to_vec().into())),
        )?;
        req.headers_mut()?
            .set(MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY, &auth_key)?;
        req.headers_mut()?
            .set("Content-Type", "application/octet-stream")?;

        let resp = Fetch::Request(req).send().await?;
        if resp.status_code() != 200 {
            error!(
                document_id = document_id,
                status = resp.status_code(),
                "DSS snapshot upload failed"
            );
            return Err(worker::Error::from(format!(
                "DSS snapshot upload returned {}",
                resp.status_code()
            )));
        }

        tracing::trace!("snapshot uploaded to DSS");
        Ok(())
    }

    async fn publish_interaction(
        &self,
        document_id: &str,
        reason: InteractionReason,
    ) -> worker::Result<()> {
        let url = format!(
            "{}/internal/documents/{}/interaction",
            self.dss_url()?,
            document_id
        );
        let auth_key = self.internal_auth_key()?;

        let body = serde_json::to_vec(&InteractionRequest { reason })
            .map_err(|e| worker::Error::from(format!("failed to serialize interaction: {e}")))?;

        let mut req = Request::new_with_init(
            &url,
            RequestInit::new()
                .with_method(Method::Put)
                .with_body(Some(body.into())),
        )?;
        req.headers_mut()?
            .set(MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY, &auth_key)?;
        req.headers_mut()?.set("Content-Type", "application/json")?;

        let resp = Fetch::Request(req).send().await?;
        if resp.status_code() != 200 {
            error!(
                document_id = document_id,
                status = resp.status_code(),
                "DSS interaction upload failed"
            );
            return Err(worker::Error::from(format!(
                "DSS interaction upload returned {}",
                resp.status_code()
            )));
        }

        tracing::trace!("interaction uploaded to DSS");
        Ok(())
    }
}
