//! Extension traits for StreamRepo.

use super::StreamId;
use super::traits::*;
use futures::StreamExt;
use std::sync::Arc;
use std::time::Duration;

pub trait StreamManagerExt: StreamRepo {
    /// Create a durable stream from an async stream.
    /// Consumes the async stream and closes the durable stream when it ends.
    fn from_async_stream(
        self: Arc<Self>,
        id: StreamId,
        stream: PayloadStream,
        timeout: Option<Duration>,
    ) -> tokio::task::JoinHandle<()>;
}

impl<S> StreamManagerExt for S
where
    S: StreamRepo + ?Sized,
{
    /// Create a durable stream from an async stream
    /// Consume async stream and close the durable stream when it ends
    fn from_async_stream(
        self: Arc<Self>,
        id: StreamId,
        mut stream: PayloadStream,
        timeout: Option<Duration>,
    ) -> tokio::task::JoinHandle<()> {
        tokio::spawn({
            async move {
                let _ =
                    tokio::time::timeout(timeout.unwrap_or(DEFAULT_STREAM_TIMEOUT), async move {
                        while let Some(payload) = stream.next().await {
                            if let Err(e) = self.append(&id, payload).await {
                                tracing::error!(error=?e,"failed to append to stream");
                                return;
                            }
                        }
                        let _ = self.close(&id).await.inspect_err(
                            |e| tracing::error!(error=?e, "failed to mark stream as closed stream"),
                        );
                    })
                    .await
                    .inspect_err(|e| tracing::error!(error=?e, "stream timed out"));
            }
        })
    }
}
