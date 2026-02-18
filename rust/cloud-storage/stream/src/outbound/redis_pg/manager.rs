use crate::domain::{ItemStream, Result, StreamManager, StreamRepo};
use async_stream::stream;
use async_trait::async_trait;
use dashmap::DashMap;
use futures::stream::{SelectAll, StreamExt};
use std::sync::Arc;
use tokio::sync::oneshot;

/// Manages stream subscriptions backed by Redis and PostgreSQL.
pub struct RedisPostgresStreamManager {
    repo: Arc<dyn StreamRepo>,
    subscriptions: DashMap<String, oneshot::Sender<()>>,
}

impl RedisPostgresStreamManager {
    /// Create a new manager wrapping the given repo.
    pub fn new(repo: Arc<dyn StreamRepo>) -> Arc<Self> {
        Arc::new(Self {
            repo,
            subscriptions: DashMap::new(),
        })
    }
}

#[async_trait]
impl StreamManager for RedisPostgresStreamManager {
    #[tracing::instrument(err, skip(self))]
    async fn subscribe(&self, sender_id: String, entity_id: String) -> Result<ItemStream> {
        let repo = self.repo.clone();

        let active = repo.active_streams(&entity_id).await?;
        let mut notify_rx = repo.notify().await;

        let mut merged = SelectAll::new();
        for id in active {
            let s = repo.stream_from_beginning(&id).await?;
            merged.push(s);
        }

        let (cancel_tx, mut cancel_rx) = oneshot::channel::<()>();
        self.subscriptions.insert(sender_id, cancel_tx);

        let out = stream! {
            loop {
                tokio::select! {
                    _ = &mut cancel_rx => break,
                    item = merged.next(), if !merged.is_empty() => {
                        if let Some(item) = item {
                            yield item
                        }
                        // else: all current streams exhausted, keep listening
                    }
                    notification = notify_rx.recv() => {
                        match notification {
                            Ok(stream_id) if stream_id.entity_id == entity_id => {
                                match repo.stream_from_beginning(&stream_id).await {
                                    Ok(stream) => merged.push(stream),
                                    Err(e) => {
                                        tracing::error!(error=?e, "failed to stream from beginning");
                                    }
                                }
                            },
                            Ok(_) => continue,
                            Err(_) => break
                        }
                    }
                }
            }
        };

        Ok(Box::pin(out))
    }

    #[tracing::instrument(err, skip(self))]
    async fn unsubscribe(&self, sender_id: String) -> Result<()> {
        if let Some((_, cancel_tx)) = self.subscriptions.remove(&sender_id) {
            let _ = cancel_tx.send(());
        }
        Ok(())
    }
}
