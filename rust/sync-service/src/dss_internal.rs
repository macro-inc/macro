use tracing::error;
use worker::{Env, Fetch, Method, Request, RequestInit};

use crate::constants::header_names::MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY;

pub trait DssInternal {
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
}

impl DssInternal for DssInternalClient<'_> {
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
}
