use crate::domain::{StreamId, StreamRepo};
use crate::outbound::redis_pg::*;
use redis::Client;
use std::cell::RefCell;
use std::sync::Arc;

pub struct StreamGuard {
    pub service: RedisPostgresStreamRepo,
    stream_ids: RefCell<Vec<StreamId>>,
}

impl StreamGuard {
    pub async fn new(name: &str) -> (Arc<dyn StreamRepo>, StreamId, Self) {
        Self::new_with_stream_id(name, "stream").await
    }

    pub async fn new_with_stream_id(
        entity_id: &str,
        stream_id: &str,
    ) -> (Arc<dyn StreamRepo>, StreamId, Self) {
        let service = connect_from_env().await;
        let service_external = connect_from_env().await;
        let stream_id = test_stream_id(entity_id, stream_id);

        let guard = Self {
            service,
            stream_ids: RefCell::new(vec![stream_id.clone()]),
        };

        (service_external.obj(), stream_id, guard)
    }

    /// Add a stream ID to be cleaned up when this guard is dropped
    pub fn add_stream_id(&self, stream_id: StreamId) {
        self.stream_ids.borrow_mut().push(stream_id);
    }
}

impl Drop for StreamGuard {
    fn drop(&mut self) {
        let service = self.service.clone();
        let stream_ids = self.stream_ids.take();
        let _ = std::thread::spawn(move || {
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap()
                .block_on(async {
                    for stream_id in stream_ids {
                        let _ = tokio::time::timeout(
                            std::time::Duration::from_millis(100),
                            service.cleanup_stream(&stream_id),
                        )
                        .await;
                    }
                });
        })
        .join();
    }
}

pub async fn connect_from_env() -> RedisPostgresStreamRepo {
    let redis_url = std::env::var("REDIS_URL").expect("redis url");
    let client = Client::open(redis_url).expect("Failed to create Redis client");
    let database_url = std::env::var("DATABASE_URL").expect("database url");
    let pool = sqlx::PgPool::connect(&database_url)
        .await
        .expect("Failed to connect to postgres");
    RedisPostgresStreamRepo::new(client, pool)
}

pub fn test_stream_id(entity_id: &str, stream_id: &str) -> StreamId {
    StreamId {
        entity_type: model_entity::EntityType::Chat,
        entity_id: entity_id.into(),
        stream_id: stream_id.into(),
    }
}
