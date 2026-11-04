use crate::util::redis::RedisClient;
use anyhow::Context;
use redis::AsyncCommands;
use uuid::Uuid;

impl RedisClient {
    fn job_status_key(job_id: Uuid) -> String {
        format!("bf_job_status:{}", job_id)
    }

    fn thread_status_key(job_id: Uuid, thread_id: &str) -> String {
        format!("bf_thread_status:{}:{}", job_id, thread_id)
    }

    pub async fn delete_backfill_job_progress(&self, job_id: Uuid) -> anyhow::Result<()> {
        let key = Self::job_status_key(job_id);

        let mut redis_connection = self
            .inner
            .get_multiplexed_async_connection()
            .await
            .context("unable to connect to redis")?;

        redis_connection.del::<&str, ()>(&key).await?;

        Ok(())
    }

    pub async fn delete_backfill_thread_progress(
        &self,
        job_id: Uuid,
        thread_id: &str,
    ) -> anyhow::Result<()> {
        let key = Self::thread_status_key(job_id, thread_id);

        let mut redis_connection = self
            .inner
            .get_multiplexed_async_connection()
            .await
            .context("unable to connect to redis")?;

        redis_connection.del::<&str, ()>(&key).await?;

        Ok(())
    }
}
