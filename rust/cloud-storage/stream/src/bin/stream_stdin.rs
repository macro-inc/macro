use model_entity::EntityType;
use std::io::{self, BufRead};
use stream::domain::StreamId;
use stream::outbound::redis_pg::RedisPostgresStreamRepo;

const ENTITY_TYPE: EntityType = EntityType::Channel;
// battlefield channel
const ENTITY_ID: &str = "019467c2-49d0-7d99-b0b9-d535811a337d";
const STREAM_ID: &str = "stdin";

fn main() -> anyhow::Result<()> {
    let redis_url = std::env::var("DBURL")
        .or_else(|_| std::env::var("REDIS_URL"))
        .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://localhost/macrodb".to_string());

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;

    let stream_id = StreamId {
        entity_type: ENTITY_TYPE,
        entity_id: ENTITY_ID.to_string(),
        stream_id: STREAM_ID.to_string(),
    };

    rt.block_on(async move {
        let client = redis::Client::open(redis_url)?;
        let pool = sqlx::PgPool::connect(&database_url).await?;
        let service = RedisPostgresStreamRepo::new(client, pool);
        let _ = service.cleanup_stream(&stream_id).await;
        let stream_service = service.obj();

        let stdin = io::stdin();
        for line in stdin.lock().lines() {
            let line = line?;
            let line = line.trim_end().to_string();
            if line.is_empty() {
                continue;
            }
            stream_service
                .append(&stream_id, serde_json::Value::String(line))
                .await?;
        }

        Ok::<(), anyhow::Error>(())
    })?;

    Ok(())
}
