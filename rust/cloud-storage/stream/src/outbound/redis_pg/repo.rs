use crate::domain::*;
use async_stream::stream;
use async_trait::async_trait;
use futures::StreamExt;
use redis::{AsyncCommands, Client, RedisResult, Value, streams::StreamReadReply};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::OnceCell;
use tokio::sync::broadcast::{self, Receiver};
use tokio::task::JoinHandle;

const NOTIFY_CHANNEL: &str = "stream:notifications";
const NOTIFY_CHANNEL_BUFFER: usize = 1024;
/// TTL for a closed stream in Redis (60 seconds for consumers to finish reading)
const CLOSED_STREAM_TTL_SECS: i64 = 60;

#[derive(Serialize, Deserialize)]
#[serde(tag = "type", content = "value")]
enum StoredStreamItem {
    Value(serde_json::Value),
    End,
}

struct StreamNotifier {
    _listener: JoinHandle<()>,
    tx: broadcast::Sender<StreamId>,
}

impl StreamNotifier {
    pub async fn new(client: &Client) -> Self {
        // redis blocks the whole connection on pubsub so we need a new one
        // https://redis.io/docs/latest/develop/pubsub/
        let new_connection = client.clone();
        let (tx, _) = broadcast::channel(NOTIFY_CHANNEL_BUFFER);
        let listener = Self::spawn_subscriber(new_connection, tx.clone());
        Self {
            tx,
            _listener: listener,
        }
    }

    pub fn subscribe(&self) -> Receiver<StreamId> {
        self.tx.subscribe()
    }

    fn spawn_subscriber(client: Client, tx: broadcast::Sender<StreamId>) -> JoinHandle<()> {
        tracing::info!("Start notification subscriber");
        tokio::spawn(async move {
            loop {
                match client.get_async_pubsub().await {
                    Ok(mut pubsub) => {
                        if let Err(e) = pubsub.subscribe(NOTIFY_CHANNEL).await {
                            tracing::error!(err=?e,"failed to subscribe to notify channel");
                        }
                        let mut stream = pubsub.on_message();
                        while let Some(msg) = stream.next().await {
                            if let Ok(stream_id) = msg
                                        .get_payload::<String>()
                                        .map_err(StreamServiceError::from)
                                        .and_then(|payload| {
                                            serde_json::from_str::<StreamId>(&payload).map_err(Into::into)
                                        })
                                        .inspect_err(|err| tracing::error!(error=?err, "failed to get notification payload"))
                                    {
                                        tracing::debug!(stream_id=?stream_id, "notify new stream");
                                        let _ = tx.send(stream_id).inspect_err(
                                            |err| tracing::error!(error=?err, "failed to forward notification"),
                                        );
                                    }
                        }
                    }
                    Err(e) => {
                        tracing::error!(error=?e, "failed to connect to pubsub");
                        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                    }
                }
            }
        })
    }
}

impl Drop for StreamNotifier {
    fn drop(&mut self) {
        self._listener.abort();
    }
}

/// Redis + PostgreSQL backed stream service using Redis Streams for storage,
/// Pub/Sub for notifications, and PostgreSQL for active stream tracking.
#[derive(Clone)]
pub struct RedisPostgresStreamRepo {
    redis_client: Arc<Client>,
    pg_pool: sqlx::PgPool,
    notifier: Arc<OnceCell<StreamNotifier>>,
}

// block for 5 min max
const MAX_BLOCK_MS: usize = 1000 * 60 * 5;
const KEY: &str = "item";

impl RedisPostgresStreamRepo {
    /// Create a new Redis + PostgreSQL stream service.
    /// The `active_streams` table must already exist (created via macro_db_client migration).
    pub fn new(redis_client: Client, pg_pool: sqlx::PgPool) -> Self {
        Self {
            redis_client: Arc::new(redis_client),
            pg_pool,
            notifier: Arc::new(OnceCell::new()),
        }
    }

    /// Wrap self in an `Arc<dyn StreamRepo>`.
    pub fn obj(self) -> Arc<dyn StreamRepo> {
        Arc::new(self)
    }

    /// Delete stream data from redis and postgres.
    /// Internal / testing only. Streams are cleaned using TTL for prod.
    #[allow(unused)]
    pub async fn cleanup_stream(&self, id: &StreamId) -> Result<()> {
        let mut conn = self.redis_client.get_multiplexed_async_connection().await?;
        let _: () = conn
            .del(id.to_string())
            .await
            .map_err(|e| StreamServiceError::StorageError(e.to_string()))?;

        // Also clean up PostgreSQL entry
        let _ = super::queries::delete_active_stream(&self.pg_pool, &id.entity_id, &id.to_string())
            .await
            .inspect_err(|e| tracing::error!(error=?e, "failed to clean stream from postgres"));

        Ok(())
    }

    async fn publish_item(
        conn: &mut redis::aio::MultiplexedConnection,
        id: &StreamId,
        item: &StoredStreamItem,
    ) -> Result<ItemId> {
        let json = serde_json::to_string(item).map_err(StreamServiceError::SerdeError)?;
        conn.xadd(id.to_string(), "*", &[(KEY, json)])
            .await
            .map_err(|e| StreamServiceError::StorageError(e.to_string()))
    }
}

#[async_trait]
impl StreamRepo for RedisPostgresStreamRepo {
    /// Create and append to stream or append to an existing stream.
    async fn append(&self, id: &StreamId, payload: serde_json::Value) -> Result<ItemId> {
        let mut conn = self.redis_client.get_multiplexed_async_connection().await?;

        let is_new: bool = !conn
            .exists(id.to_string())
            .await
            .map_err(|e| StreamServiceError::StorageError(e.to_string()))?;

        let item_id = Self::publish_item(&mut conn, id, &StoredStreamItem::Value(payload)).await?;

        // Refresh TTL on every append so stream stays alive while being written to
        let _: RedisResult<()> = conn
            .expire(id.to_string(), DEFAULT_STREAM_TIMEOUT.as_secs() as i64)
            .await
            .inspect_err(|e| tracing::error!(error=?e, "failed to set stream TTL"));

        if is_new {
            tracing::debug!(stream_id=?id, "New stream detected publishing notification");
            let notification = serde_json::to_string(id).expect("json");
            let _: RedisResult<()> = conn
                .publish(NOTIFY_CHANNEL, notification)
                .await
                .inspect_err(|e| tracing::error!(error=?e, "failed to publish new channel"));

            // Track in PostgreSQL
            let _ =
                super::queries::insert_active_stream(&self.pg_pool, &id.entity_id, &id.to_string())
                    .await
                    .inspect_err(
                        |e| tracing::error!(error=?e, "failed to track stream in postgres"),
                    );
        }

        Ok(item_id)
    }

    async fn stream_from_beginning(&self, id: &StreamId) -> Result<ItemStream> {
        let mut connection = self.redis_client.get_multiplexed_async_connection().await?;
        let stream_key = id.to_string();
        let stream_id_for_item = id.clone();

        let stream = stream! {
            let mut last_id = "0".to_string();

            'stream_loop: loop {
                let opts = redis::streams::StreamReadOptions::default().block(MAX_BLOCK_MS);

                let result: RedisResult<StreamReadReply> = connection
                    .xread_options(&[&stream_key], &[&last_id], &opts).await;

                match result {
                    Ok(reply) => {
                        for stream_key in reply.keys {
                            for entry in stream_key.ids {
                                last_id = entry.id.clone();

                                for (key, value) in entry.map {
                                    if key == KEY
                                        && let Value::BulkString(bytes) = value
                                    {
                                            match String::from_utf8(bytes) {
                                                Ok(json_str) => {
                                                    match serde_json::from_str::<StoredStreamItem>(&json_str) {
                                                        Ok(item) => match item {
                                                           StoredStreamItem::Value(payload)  => {

                                                               yield StreamItem::new(stream_id_for_item.clone(), payload)
                                                           }
                                                           StoredStreamItem::End => {
                                                               break 'stream_loop;
                                                           }
                                                        }
                                                        Err(e) => {
                                                            tracing::error!(error=?e, "failed to deserialize stream item");
                                                        }
                                                    }
                                                }
                                                Err(e) => {
                                                    tracing::error!(error=?e, "invalid UTF-8 in stream item");
                                                }
                                            }
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        tracing::error!(error=?e, "failed to read from stream");
                        break;
                    }
                }
            }
        };
        Ok(Box::pin(stream))
    }

    async fn close(&self, id: &StreamId) -> Result<()> {
        let mut conn = self.redis_client.get_multiplexed_async_connection().await?;
        Self::publish_item(&mut conn, id, &StoredStreamItem::End).await?;

        let _: RedisResult<()> = conn
            .expire(id.to_string(), CLOSED_STREAM_TTL_SECS)
            .await
            .inspect_err(|e| tracing::error!(error=?e, "failed to set closed stream TTL"));

        // Remove from PostgreSQL tracking
        let _ = super::queries::delete_active_stream(&self.pg_pool, &id.entity_id, &id.to_string())
            .await
            .inspect_err(|e| tracing::error!(error=?e, "failed to remove stream from postgres"));

        Ok(())
    }

    async fn active_streams(&self, entity_id: &str) -> Result<Vec<StreamId>> {
        super::queries::get_active_stream_keys(&self.pg_pool, entity_id)
            .await
            .map_err(|e| StreamServiceError::StorageError(e.to_string()))?
            .into_iter()
            .map(StreamId::try_from)
            .collect::<Result<Vec<_>>>()
            .map_err(|e| StreamServiceError::StorageError(e.to_string()))
    }

    async fn notify(&self) -> Receiver<StreamId> {
        self.notifier
            .get_or_init(|| StreamNotifier::new(&self.redis_client))
            .await
            .subscribe()
    }
}
