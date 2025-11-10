use crate::util::redis::RedisClient;
use anyhow::Context;
use redis::AsyncCommands;
use uuid::Uuid;

impl RedisClient {
    fn backfill_job_key(job_id: Uuid) -> String {
        format!("bf_status:{}", job_id)
    }

    /// Initialize backfill job progress in Redis
    pub async fn init_backfill_job_progress(
        &self,
        job_id: Uuid,
        total_threads: i32,
    ) -> anyhow::Result<()> {
        let key = Self::backfill_job_key(job_id);

        let mut redis_connection = self
            .inner
            .get_multiplexed_async_connection()
            .await
            .context("unable to connect to redis")?;

        redis_connection
            .hset_multiple::<&str, &str, i32, ()>(
                &key,
                &[("total_threads", total_threads), ("completed_threads", 0)],
            )
            .await?;

        Ok(())
    }

    /// Increment completed threads count and return true if job is complete, deleting redis entry for job if so
    pub async fn handle_completed_thread(&self, job_id: Uuid) -> anyhow::Result<bool> {
        let key = Self::backfill_job_key(job_id);

        let mut redis_connection = self
            .inner
            .get_multiplexed_async_connection()
            .await
            .context("unable to connect to redis")?;

        let script = r#"
        local key = KEYS[1]
        local completed = redis.call('HINCRBY', key, 'completed_threads', 1)
        local total = redis.call('HGET', key, 'total_threads')
        return {completed, total}
    "#;

        let result: Vec<i32> = redis::Script::new(script)
            .key(&key)
            .invoke_async(&mut redis_connection)
            .await?;

        let completed_threads = result[0];
        let total_threads = result[1];
        println!("completed threads: {}", completed_threads);

        let job_complete = completed_threads >= total_threads;

        if job_complete {
            let redis_client = self.clone();
            tokio::spawn(async move {
                if let Err(e) = redis_client.delete_backfill_job_progress(job_id).await {
                    tracing::error!(
                        "Failed to delete backfill job progress for job {}: {}",
                        job_id,
                        e
                    );
                }
            });
        }

        Ok(job_complete)
    }

    pub async fn delete_backfill_job_progress(&self, job_id: Uuid) -> anyhow::Result<()> {
        let key = Self::backfill_job_key(job_id);

        let mut redis_connection = self
            .inner
            .get_multiplexed_async_connection()
            .await
            .context("unable to connect to redis")?;

        redis_connection.del::<&str, ()>(&key).await?;

        Ok(())
    }
}
