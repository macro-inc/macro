//! Extension traits for StreamRepo.

use super::StreamId;
use super::traits::*;
use futures::StreamExt;
use std::sync::Arc;
use std::time::Duration;

const DEFAULT_CLOSE_DELAY: std::time::Duration = std::time::Duration::from_secs(60);

pub trait StreamRepoExt: StreamRepo {
    /// Create a durable stream from an async stream.
    /// Consumes the async stream and closes the durable stream when it ends.
    /// If `close_delay` is provided, waits that duration before closing.
    fn from_async_stream(
        self: Arc<Self>,
        id: StreamId,
        stream: PayloadStream,
        timeout: Option<Duration>,
        close_delay: Option<Duration>,
    );
}

impl<S> StreamRepoExt for S
where
    S: StreamRepo + ?Sized,
{
    /// Create a durable stream from an async stream.
    /// Consume async stream and close the durable stream when it ends.
    /// If `close_delay` is provided, waits that duration before closing.
    fn from_async_stream(
        self: Arc<Self>,
        id: StreamId,
        mut stream: PayloadStream,
        timeout: Option<Duration>,
        close_delay: Option<Duration>,
    ) {
        let writer = self.clone();
        let writer_id = id.clone();
        tokio::spawn(async move {
            let consumed =
                tokio::time::timeout(timeout.unwrap_or(DEFAULT_STREAM_TIMEOUT), async move {
                    while let Some(payload) = stream.next().await {
                        if let Err(e) = writer.append(&writer_id, payload).await {
                            tracing::error!(error=?e, "failed to append to stream");
                            break;
                        }
                    }
                })
                .await;

            if consumed.is_ok() {
                tokio::time::sleep(close_delay.unwrap_or(DEFAULT_CLOSE_DELAY)).await;
            } else {
                tracing::error!("stream timed out");
            }

            let _ = self
                .close(&id)
                .await
                .inspect_err(|e| tracing::error!(error=?e, "failed to mark stream as closed"));
        });
    }
}
