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

    /// Initialize backfill job progress in Redis
    pub async fn init_backfill_job_progress(
        &self,
        job_id: Uuid,
        total_threads: i32,
    ) -> anyhow::Result<()> {
        let key = Self::job_status_key(job_id);

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
    pub async fn incr_completed_threads(&self, job_id: Uuid) -> anyhow::Result<bool> {
        let key = Self::job_status_key(job_id);

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
        let key = Self::job_status_key(job_id);

        let mut redis_connection = self
            .inner
            .get_multiplexed_async_connection()
            .await
            .context("unable to connect to redis")?;

        redis_connection.del::<&str, ()>(&key).await?;

        Ok(())
    }

    /// Initialize backfill thread progress in Redis
    pub async fn init_backfill_thread_progress(
        &self,
        job_id: Uuid,
        thread_id: &str,
        total_messages: i32,
    ) -> anyhow::Result<()> {
        let key = Self::thread_status_key(job_id, thread_id);

        let mut redis_connection = self
            .inner
            .get_multiplexed_async_connection()
            .await
            .context("unable to connect to redis")?;

        redis_connection
            .hset_multiple::<&str, &str, i32, ()>(
                &key,
                &[
                    ("total_messages", total_messages),
                    ("completed_messages", 0),
                ],
            )
            .await?;

        Ok(())
    }

    /// Increment completed messages count and return true if thread is complete, deleting redis entry for thread if so
    pub async fn incr_completed_messages(
        &self,
        job_id: Uuid,
        thread_id: &str,
    ) -> anyhow::Result<bool> {
        let key = Self::thread_status_key(job_id, thread_id);

        let mut redis_connection = self
            .inner
            .get_multiplexed_async_connection()
            .await
            .context("unable to connect to redis")?;

        let script = r#"
        local key = KEYS[1]
        local completed = redis.call('HINCRBY', key, 'completed_messages', 1)
        local total = redis.call('HGET', key, 'total_messages')
        return {completed, total}
    "#;

        let result: Vec<i32> = redis::Script::new(script)
            .key(&key)
            .invoke_async(&mut redis_connection)
            .await?;

        let completed_messages = result[0];
        let total_messages = result[1];

        let thread_complete = completed_messages >= total_messages;

        if thread_complete {
            let redis_client = self.clone();
            let thread_id = thread_id.to_string();
            tokio::spawn(async move {
                if let Err(e) = redis_client
                    .delete_backfill_thread_progress(job_id, &thread_id)
                    .await
                {
                    tracing::error!(
                        "Failed to delete backfill thread progress for thread {}: {}",
                        thread_id,
                        e
                    );
                }
            });
        }

        Ok(thread_complete)
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
