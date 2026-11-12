//! Reading a response body within the policy's size and time limits.

use std::time::Duration;

use bytes::{Bytes, BytesMut};
use futures::Stream;
use tokio::time::Instant;

use crate::error::FetchError;
use crate::policy::FetchPolicy;

/// A response body that fails once it passes the byte limit, stalls longer
/// than the idle limit, or runs past the fetch's total timeout. Limits apply
/// to bytes as they arrive, so a body that lies about (or omits) its
/// `Content-Length` is still cut off.
#[derive(Debug)]
pub struct SafeBody {
    response: reqwest::Response,
    max_bytes: u64,
    idle_timeout: Duration,
    deadline: Instant,
    received: u64,
    span: tracing::Span,
}

impl SafeBody {
    pub(crate) fn new(
        response: reqwest::Response,
        policy: &FetchPolicy,
        deadline: Instant,
    ) -> Self {
        let span = tracing::info_span!(
            "safe_fetch.body",
            safe_fetch.body_bytes = tracing::field::Empty,
            safe_fetch.error_kind = tracing::field::Empty,
        );

        Self {
            response,
            max_bytes: policy.max_body_bytes,
            idle_timeout: policy.body_idle_timeout,
            deadline,
            received: 0,
            span,
        }
    }

    /// The next chunk, or `None` at the end of the body.
    pub async fn next_chunk(&mut self) -> Result<Option<Bytes>, FetchError> {
        let result = self.read_chunk().await;

        match &result {
            Ok(Some(_)) => {}
            Ok(None) => {
                self.span.record("safe_fetch.body_bytes", self.received);
            }
            Err(error) => {
                self.span.record("safe_fetch.body_bytes", self.received);
                self.span.record("safe_fetch.error_kind", error.kind());
                tracing::warn!(parent: &self.span, error = %error, "safe fetch body read failed");
            }
        }

        result
    }

    /// Read the whole body into memory.
    pub async fn collect(mut self) -> Result<Bytes, FetchError> {
        let mut collected = BytesMut::new();
        while let Some(chunk) = self.next_chunk().await? {
            collected.extend_from_slice(&chunk);
        }
        Ok(collected.freeze())
    }

    /// The body as a stream that ends after its first error, for handing
    /// straight to a response body.
    pub fn into_stream(self) -> impl Stream<Item = Result<Bytes, FetchError>> + Send + 'static {
        futures::stream::unfold(Some(self), |state| async move {
            let mut body = state?;
            match body.next_chunk().await {
                Ok(Some(chunk)) => Some((Ok(chunk), Some(body))),
                Ok(None) => None,
                Err(error) => Some((Err(error), None)),
            }
        })
    }

    async fn read_chunk(&mut self) -> Result<Option<Bytes>, FetchError> {
        // Wait for whichever comes first: the idle limit for this chunk or the
        // deadline for the whole fetch, and report the one that fired.
        let idle_deadline = Instant::now() + self.idle_timeout;
        let wait_until = idle_deadline.min(self.deadline);

        let chunk = match tokio::time::timeout_at(wait_until, self.response.chunk()).await {
            Ok(chunk) => chunk.map_err(FetchError::from_reqwest)?,
            Err(_elapsed) if wait_until == self.deadline => return Err(FetchError::TotalTimeout),
            Err(_elapsed) => return Err(FetchError::BodyStalled),
        };

        let Some(chunk) = chunk else {
            return Ok(None);
        };

        let chunk_bytes = u64::try_from(chunk.len()).unwrap_or(u64::MAX);
        self.received = self.received.saturating_add(chunk_bytes);
        if self.received > self.max_bytes {
            return Err(FetchError::BodyTooLarge {
                limit: self.max_bytes,
            });
        }

        Ok(Some(chunk))
    }
}
