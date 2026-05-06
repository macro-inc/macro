use crate::domain::{ItemStream, Result, StreamEvent, StreamManager, StreamRepo};
use async_stream::stream;
use async_trait::async_trait;
use dashmap::DashMap;
use futures::stream::{SelectAll, StreamExt};
use std::sync::Arc;
use tokio::sync::oneshot;

/// Manages stream subscriptions backed by Redis and PostgreSQL.
pub struct RedisPostgresStreamManager {
    repo: Arc<dyn StreamRepo>,
    subscriptions: DashMap<SubscriptionKey, oneshot::Sender<()>>,
}

#[derive(Debug, Clone, Eq, PartialEq, Hash)]
struct SubscriptionKey {
    sender_id: String,
    entity_id: String,
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
    fn repo(&self) -> Arc<dyn StreamRepo> {
        self.repo.clone()
    }

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
        let key = SubscriptionKey {
            sender_id,
            entity_id: entity_id.clone(),
        };
        self.subscriptions.insert(key, cancel_tx);

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
                            Ok(StreamEvent::Created(stream_id)) if stream_id.entity_id == entity_id => {
                                match repo.stream_from_beginning(&stream_id).await {
                                    Ok(stream) => merged.push(stream),
                                    Err(e) => {
                                        tracing::error!(error=?e, "failed to stream from beginning");
                                    }
                                }
                            },
                            Ok(_) => continue,
                            Err(e) => {
                                tracing::warn!(error=%e, %entity_id, "stream notify channel error, ending subscription");
                                break
                            }
                        }
                    }
                }
            }
        };

        Ok(Box::pin(out))
    }

    #[tracing::instrument(err, skip(self))]
    async fn unsubscribe(&self, sender_id: String, entity_id: String) -> Result<()> {
        if let Some((_, cancel_tx)) = self.subscriptions.remove(&SubscriptionKey {
            sender_id,
            entity_id,
        }) {
            let _ = cancel_tx.send(());
        }
        Ok(())
    }
}
