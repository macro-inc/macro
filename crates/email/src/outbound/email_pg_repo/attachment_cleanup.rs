use super::EmailPgRepo;
use crate::domain::{attachment_cleanup::*, draft_attachments::AttachmentError};
use uuid::Uuid;

impl DraftObjectCleanupRepository for EmailPgRepo {
    async fn claim_object_cleanup(
        &self,
        lease_id: Uuid,
    ) -> Result<Option<ObjectCleanupLease>, AttachmentError> {
        let row=sqlx::query!(r#"
            WITH candidate AS (
                SELECT c.object_key FROM email_draft_object_cleanup c
                WHERE c.available_at <= now() AND (c.lease_until IS NULL OR c.lease_until < now())
                    AND NOT EXISTS (SELECT 1 FROM email_attachments_drafts a WHERE a.s3_key = c.object_key)
                    AND NOT EXISTS (SELECT 1 FROM email_attachment_blobs b WHERE b.object_key = c.object_key)
                    AND NOT EXISTS (SELECT 1 FROM email_mailbox_drafts d WHERE d.state NOT IN ('sent','deleted')
                        AND d.desired_content @> jsonb_build_object('_attachments',jsonb_build_object('uploads',jsonb_build_array(jsonb_build_object('s3_key',c.object_key)))))
                    AND NOT EXISTS (SELECT 1 FROM email_mailbox_drafts d WHERE d.state NOT IN ('sent','deleted')
                        AND d.checkpoint @> jsonb_build_object('prepared',jsonb_build_object('files',jsonb_build_array(jsonb_build_object('source',jsonb_build_object('kind','uploaded','key',c.object_key))))))
                    AND NOT EXISTS (SELECT 1 FROM email_mailbox_drafts d WHERE d.state NOT IN ('sent','deleted') AND d.lease_until > now()
                        AND d.claimed_content @> jsonb_build_object('_attachments',jsonb_build_object('uploads',jsonb_build_array(jsonb_build_object('s3_key',c.object_key)))))
                ORDER BY c.available_at LIMIT 1 FOR UPDATE OF c SKIP LOCKED
            ) UPDATE email_draft_object_cleanup c SET lease_id = $1,lease_until = now() + interval '5 minutes'
                FROM candidate WHERE c.object_key = candidate.object_key RETURNING c.object_key
        "#,lease_id).fetch_optional(&self.pool).await.map_err(|_|AttachmentError::Infrastructure)?;
        Ok(row.map(|row| ObjectCleanupLease {
            key: row.object_key,
            lease_id,
        }))
    }
    async fn finish_object_cleanup(
        &self,
        lease: &ObjectCleanupLease,
    ) -> Result<(), AttachmentError> {
        sqlx::query!(
            "DELETE FROM email_draft_object_cleanup WHERE object_key = $1 AND lease_id = $2",
            lease.key,
            lease.lease_id
        )
        .execute(&self.pool)
        .await
        .map_err(|_| AttachmentError::Infrastructure)?;
        Ok(())
    }
}
