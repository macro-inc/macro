//! Authenticated search-processing backfill adapter. The HTTP receipt is a job
//! identity, NOT a signal that source publication or OpenSearch indexing finished.

use std::time::Duration;

use reqwest::{
    Client, Response, StatusCode, Url,
    header::{HeaderMap, HeaderValue},
};
use serde::{Deserialize, de::DeserializeOwned};
use uuid::Uuid;

use crate::domain::{
    models::{ImportError, SearchBackfill, SearchState},
    ports::{PortResult, SearchBackfillClient},
};

#[cfg(test)]
mod test;

const RESPONSE_BYTES: usize = 64 * 1024;

/// Scoped HTTP client for the existing search-processing internal backfill API.
#[derive(Clone)]
pub struct HttpSearchBackfill {
    client: Client,
    base: Url,
}

impl HttpSearchBackfill {
    /// Validate configuration at composition time. Redirects are disabled so an
    /// internal authorization header cannot be forwarded to another origin.
    pub fn new(base: &str, internal_key: &str) -> PortResult<Self> {
        let base = Url::parse(&format!("{}/", base.trim_end_matches('/')))
            .map_err(|_| ImportError::InvalidInput)?;
        if !matches!(base.scheme(), "http" | "https")
            || base.query().is_some()
            || base.fragment().is_some()
            || !base.username().is_empty()
            || base.password().is_some()
            || internal_key.is_empty()
        {
            return Err(ImportError::InvalidInput.into());
        }
        let mut headers = HeaderMap::new();
        let mut key = HeaderValue::from_str(internal_key).map_err(|_| ImportError::InvalidInput)?;
        key.set_sensitive(true);
        headers.insert("x-internal-auth-key", key);
        let client = Client::builder()
            .default_headers(headers)
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|_| ImportError::Internal)?;
        Ok(Self { client, base })
    }

    fn endpoint(&self, path: &str) -> PortResult<Url> {
        self.base
            .join(&format!("internal/backfill/{path}"))
            .map_err(|_| ImportError::Internal.into())
    }
}

impl SearchBackfillClient for HttpSearchBackfill {
    async fn submit(&self, request: &SearchBackfill) -> PortResult<Uuid> {
        // None/omitted scope would backfill the entire deployment. Fail closed.
        if request.channel_ids.is_empty()
            || request.channel_ids.len() > 50
            || request
                .channel_ids
                .iter()
                .any(|id| id.is_nil() || id.is_max())
        {
            return Err(ImportError::InvalidInput.into());
        }
        let response = self
            .client
            .post(self.endpoint("channels")?)
            .json(
                &serde_json::json!({"channel_ids": request.channel_ids, "deletion_filter": "any"}),
            )
            .send()
            .await
            .map_err(|_| ImportError::Retryable)?;
        if response.status() != StatusCode::ACCEPTED {
            return Err(ImportError::Retryable.into());
        }
        let receipt: Accepted = decode(response).await?;
        valid_receipt(receipt.job_id)?;
        Ok(receipt.job_id)
    }

    async fn progress(&self, receipt: Uuid) -> PortResult<SearchState> {
        valid_receipt(receipt)?;
        let response = self
            .client
            .get(self.endpoint(&receipt.to_string())?)
            .send()
            .await
            .map_err(|_| ImportError::Retryable)?;
        if response.status() == StatusCode::NOT_FOUND {
            // Expired/lost registry entry: the domain resubmits the same scope.
            return Ok(SearchState::Failed);
        }
        if response.status() != StatusCode::OK {
            return Err(ImportError::Retryable.into());
        }
        let snapshot: Snapshot = decode(response).await?;
        if snapshot.job_id != receipt {
            return Err(ImportError::Retryable.into());
        }
        match snapshot.status {
            Status::Running => Ok(SearchState::Submitted {
                receipt_id: receipt,
            }),
            Status::Completed => Ok(SearchState::Completed),
            Status::Failed | Status::Cancelled => Ok(SearchState::Failed),
        }
    }
}

fn valid_receipt(receipt: Uuid) -> PortResult<()> {
    if receipt.is_nil() || receipt.is_max() {
        return Err(ImportError::Retryable.into());
    }
    Ok(())
}

async fn decode<T: DeserializeOwned>(mut response: Response) -> PortResult<T> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| ImportError::Retryable)? {
        if bytes.len() + chunk.len() > RESPONSE_BYTES {
            return Err(ImportError::Retryable.into());
        }
        bytes.extend_from_slice(&chunk);
    }
    // Never retain provider errors/bodies in public progress or logs.
    serde_json::from_slice(&bytes).map_err(|_| ImportError::Retryable.into())
}

#[derive(Deserialize)]
struct Accepted {
    job_id: Uuid,
}

#[derive(Deserialize)]
struct Snapshot {
    job_id: Uuid,
    status: Status,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum Status {
    Running,
    Completed,
    Failed,
    Cancelled,
}
