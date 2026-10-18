//! Bounded raw-envelope cleanup. Native message, revision and acceptance ledgers
//! are independent tables and are never touched by receipt retention.

use super::*;
use crate::domain::retention::{
    CLEANUP_BATCH_SIZE, MAX_RECEIPT_DAYS, ReceiptCleanup, SUCCESSFUL_RAW_DAYS,
};

impl PgMessagingRepository {
    pub(super) async fn cleanup_receipts_impl(&self) -> PortResult<ReceiptCleanup> {
        let oauth_deleted=sqlx::query!("DELETE FROM meta_messaging_oauth WHERE state_sha256 IN (SELECT state_sha256 FROM meta_messaging_oauth WHERE expires_at<=now() ORDER BY expires_at LIMIT $1 FOR UPDATE SKIP LOCKED)",CLEANUP_BATCH_SIZE)
            .execute(&self.pool).await.map_err(failure)?.rows_affected();
        let cleared=sqlx::query!(r#"WITH candidates AS (
            SELECT id,status FROM meta_messaging_receipt
            WHERE payload_cleared_at IS NULL
              AND NOT (status='processing' AND COALESCE(lease_until>now(),false))
              AND ((NOT (status='complete' AND decode_failures=0) AND created_at<=now()-make_interval(days=>$2))
                OR (status='complete' AND decode_failures=0 AND completed_at<=now()-make_interval(days=>$3)))
            ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT $1
        ) UPDATE meta_messaging_receipt r SET payload='null'::jsonb,payload_cleared_at=now(),
            status=CASE WHEN c.status IN ('pending','processing') THEN 'failed' ELSE r.status END,
            error_code=CASE WHEN c.status IN ('pending','processing') THEN 'receipt_retention_expired' ELSE r.error_code END,
            lease_id=NULL,lease_until=NULL
          FROM candidates c WHERE r.id=c.id
          RETURNING c.status IN ('pending','processing') AS "expired!"
        "#,CLEANUP_BATCH_SIZE,MAX_RECEIPT_DAYS,SUCCESSFUL_RAW_DAYS)
            .fetch_all(&self.pool).await.map_err(failure)?;
        let deleted = sqlx::query!(
            r#"WITH candidates AS (
            SELECT id FROM meta_messaging_receipt WHERE created_at<=now()-make_interval(days=>$2)
              AND payload_cleared_at IS NOT NULL
              AND NOT (status='processing' AND COALESCE(lease_until>now(),false))
            ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT $1
        ) DELETE FROM meta_messaging_receipt r USING candidates c WHERE r.id=c.id"#,
            CLEANUP_BATCH_SIZE,
            MAX_RECEIPT_DAYS
        )
        .execute(&self.pool)
        .await
        .map_err(failure)?
        .rows_affected();
        Ok(ReceiptCleanup {
            oauth_deleted,
            payloads_cleared: cleared.len() as u64,
            work_expired: cleared.iter().filter(|row| row.expired).count() as u64,
            receipts_deleted: deleted,
        })
    }
}
