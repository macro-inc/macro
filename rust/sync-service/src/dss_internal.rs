use serde::Deserialize;
use tracing::error;
use worker::{Env, Fetch, Method, Request, RequestInit};

use crate::constants::header_names::MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY;

pub trait DssInternal {
    /// Gets a presigned S3 PUT URL for uploading a shallow snapshot, then uploads the bytes.
    async fn publish_shallow_snapshot(
        &self,
        document_id: &str,
        snapshot: &[u8],
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
        Ok(self.env.var("DSS_INTERNAL_AUTH_KEY")?.to_string())
    }

    async fn get_snapshot_upload_url(&self, document_id: &str) -> worker::Result<String> {
        let url = format!(
            "{}/internal/documents/{}/snapshot_upload_url",
            self.dss_url()?,
            document_id
        );
        let auth_key = self.internal_auth_key()?;

        let mut req = Request::new_with_init(&url, RequestInit::new().with_method(Method::Get))?;
        req.headers_mut()?
            .set(MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY, &auth_key)?;

        let mut resp = Fetch::Request(req).send().await?;
        if resp.status_code() != 200 {
            return Err(worker::Error::from(format!(
                "DSS snapshot_upload_url returned {}",
                resp.status_code()
            )));
        }

        // It would be nice if we could share the type, but this is small enough
        // that hopefully it's NBD
        #[derive(Deserialize)]
        struct UrlResponse {
            url: String,
        }
        let body: UrlResponse = resp.json().await?;
        Ok(body.url)
    }
}

impl DssInternal for DssInternalClient<'_> {
    async fn publish_shallow_snapshot(
        &self,
        document_id: &str,
        snapshot: &[u8],
    ) -> worker::Result<()> {
        let upload_url = self.get_snapshot_upload_url(document_id).await?;
        tracing::trace!(upload_url = upload_url, "uploading snapshot to DSS");

        let req = Request::new_with_init(
            &upload_url,
            RequestInit::new()
                .with_method(Method::Put)
                .with_body(Some(snapshot.to_vec().into())),
        )?;
        req.headers().set("Content-Type", "application/octet-stream")?;
        tracing::trace!("sending snapshot to DSS");

        let resp = Fetch::Request(req).send().await?;
        if resp.status_code() != 200 {
            error!(
                document_id = document_id,
                status = resp.status_code(),
                "S3 snapshot PUT failed"
            );
            return Err(worker::Error::from(format!(
                "S3 snapshot PUT returned {}",
                resp.status_code()
            )));
        }

        tracing::trace!("snapshot uploaded to DSS");
        Ok(())
    }
}
