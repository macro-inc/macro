use super::*;
use crate::domain::temporary_media::{MediaCopyRepository, MediaCopyWork};

#[async_trait]
impl MediaCopyRepository for PgMessagingRepository {
    async fn reserve_copy(&self, bucket: &str) -> PortResult<Uuid> {
        let id = Uuid::now_v7();
        sqlx::query!(
            "INSERT INTO meta_messaging_media_copy (id,bucket) VALUES ($1,$2)",
            id,
            bucket
        )
        .execute(&self.pool)
        .await
        .map_err(failure)?;
        Ok(id)
    }
    async fn claim_copies(&self) -> PortResult<Vec<MediaCopyWork>> {
        let token = Uuid::now_v7();
        let rows=sqlx::query!(r#"WITH candidates AS (
            SELECT id FROM meta_messaging_media_copy WHERE delete_after<=now() AND available_at<=now()
                AND (lease_until IS NULL OR lease_until<=now())
            ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 20
        ) UPDATE meta_messaging_media_copy c SET lease_id=$1,lease_until=now()+interval '5 minutes'
          FROM candidates w WHERE c.id=w.id RETURNING c.id,c.bucket"#,token)
            .fetch_all(&self.pool).await.map_err(failure)?;
        Ok(rows
            .into_iter()
            .map(|r| MediaCopyWork {
                lease: Lease { id: r.id, token },
                bucket: r.bucket,
            })
            .collect())
    }
    async fn settle_copy(&self, lease: &Lease, deleted: bool) -> PortResult<()> {
        let changed = if deleted {
            sqlx::query!("DELETE FROM meta_messaging_media_copy WHERE id=$1 AND lease_id=$2 AND lease_until>now()",lease.id,lease.token)
                .execute(&self.pool).await.map_err(failure)?.rows_affected()
        } else {
            sqlx::query!("UPDATE meta_messaging_media_copy SET lease_id=NULL,lease_until=NULL,available_at=now()+interval '30 seconds' WHERE id=$1 AND lease_id=$2 AND lease_until>now()",lease.id,lease.token)
                .execute(&self.pool).await.map_err(failure)?.rows_affected()
        };
        if changed != 1 {
            return Err(MessagingError::Conflict.into());
        }
        Ok(())
    }
}
