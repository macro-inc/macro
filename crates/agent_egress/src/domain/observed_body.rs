//! A response body that writes down how it ended.
//!
//! The proxy answers a GET for an MCP event stream with the upstream's body
//! and hears nothing more about it: how long it stayed open, how much it
//! carried, and whether the upstream closed it or the sandbox went away all
//! happen after the handler has returned. When one session reopened a
//! stream 380 times in a row (prod, 2026-09-26) the logs could say only
//! that each open was proxied; not what the upstream answered, nor how
//! quickly each stream ended. This wrapper is what says so.

#[cfg(test)]
mod test;

use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::Instant;

use bytes::Bytes;
use http_body::{Body, Frame};

use crate::domain::model::{AgentSessionId, BoxError, ProxyBody};

/// Facts about the stream that are known when it opens, for the line
/// written when it ends.
#[derive(Debug, Clone)]
pub struct StreamIdentity {
    /// The session that opened it.
    pub session: AgentSessionId,
    /// The upstream it was opened on.
    pub upstream: String,
    /// The status the upstream answered with.
    pub status: u16,
    /// The upstream's `content-type`, `text/event-stream` for a live stream.
    pub content_type: Option<String>,
}

/// A body that logs its lifetime when it ends or is dropped.
pub struct ObservedBody {
    inner: ProxyBody,
    identity: StreamIdentity,
    opened_at: Instant,
    bytes: u64,
    frames: u64,
    /// Whether the upstream ended the body, as opposed to the sandbox
    /// dropping it - or the body failing - before that.
    ended: bool,
    failed: bool,
}

impl ObservedBody {
    /// Wrap `inner`, to be logged as `identity` when it ends.
    pub fn new(inner: ProxyBody, identity: StreamIdentity) -> Self {
        Self {
            inner,
            identity,
            opened_at: Instant::now(),
            bytes: 0,
            frames: 0,
            ended: false,
            failed: false,
        }
    }

    /// How the stream ended, in one word.
    fn outcome(&self) -> &'static str {
        if self.failed {
            "failed"
        } else if self.ended {
            "closed by upstream"
        } else {
            "dropped by sandbox"
        }
    }
}

impl Body for ObservedBody {
    type Data = Bytes;
    type Error = BoxError;

    fn poll_frame(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Self::Data>, Self::Error>>> {
        let polled = Pin::new(&mut self.inner).poll_frame(cx);
        match &polled {
            Poll::Ready(Some(Ok(frame))) => {
                self.frames += 1;
                if let Some(data) = frame.data_ref() {
                    self.bytes += data.len() as u64;
                }
            }
            Poll::Ready(Some(Err(_))) => self.failed = true,
            Poll::Ready(None) => self.ended = true,
            Poll::Pending => {}
        }
        polled
    }

    fn is_end_stream(&self) -> bool {
        self.inner.is_end_stream()
    }

    fn size_hint(&self) -> http_body::SizeHint {
        self.inner.size_hint()
    }
}

impl Drop for ObservedBody {
    fn drop(&mut self) {
        let open_ms = self.opened_at.elapsed().as_millis() as u64;
        tracing::info!(
            session = %self.identity.session,
            upstream = %self.identity.upstream,
            status = self.identity.status,
            content_type = self.identity.content_type.as_deref(),
            outcome = self.outcome(),
            open_ms,
            bytes = self.bytes,
            frames = self.frames,
            "MCP event stream ended"
        );
    }
}
