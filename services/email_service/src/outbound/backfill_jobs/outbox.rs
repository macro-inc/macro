//! Existing outbox transactions; publication order is owned by the domain.
use super::worker::BackfillSqs;
use email::domain::backfill_jobs::outbox::*;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

pub(crate) struct PgBackfillOutbox(pub PgPool);
pub(crate) struct PgOutboxTransaction(Transaction<'static, Postgres>);
impl BackfillOutboxRepository for PgBackfillOutbox {
    type Init = PgOutboxTransaction;
    type Completion = PgOutboxTransaction;
    type Crm = PgOutboxTransaction;
    async fn init(&self) -> anyhow::Result<Self::Init> {
        Ok(PgOutboxTransaction(self.0.begin().await?))
    }
    async fn completion(&self) -> anyhow::Result<Self::Completion> {
        Ok(PgOutboxTransaction(self.0.begin().await?))
    }
    async fn crm(&self) -> anyhow::Result<Self::Crm> {
        Ok(PgOutboxTransaction(self.0.begin().await?))
    }
}
impl OutboxTransaction for PgOutboxTransaction {
    async fn commit(self) -> anyhow::Result<()> {
        self.0.commit().await.map_err(Into::into)
    }
}
impl InitOutboxTransaction for PgOutboxTransaction {
    async fn next(&mut self) -> anyhow::Result<Option<EmailInitOutboxRow>> {
        Ok(sqlx::query_as!(
            EmailInitOutboxRow,
            r#"
            SELECT
                outbox.id,
                outbox.backfill_job_id,
                job.link_id AS "email_link_id!",
                -- Recovery jobs skip the priority pass: the mailbox is already
                -- populated, so there is no cold-start signal to seed.
                (job.threads_requested_limit IS NULL AND NOT job.is_recovery) AS "priority_pass!",
                job.is_recovery AS "refresh_existing!"
            FROM email_backfill_init_outbox outbox
            JOIN email_backfill_jobs job ON job.id = outbox.backfill_job_id
            WHERE outbox.published_at IS NULL
              AND job.status = 'InProgress'
              AND job.initialized_at IS NOT NULL
            ORDER BY outbox.created_at, outbox.id
            FOR UPDATE OF outbox SKIP LOCKED
            LIMIT 1
            "#,
        )
        .fetch_optional(&mut *self.0)
        .await?)
    }
    async fn published(&mut self, id: Uuid) -> anyhow::Result<()> {
        sqlx::query!(
            r#"
            UPDATE email_backfill_init_outbox
            SET published_at = now()
            WHERE id = $1
            "#,
            id,
        )
        .execute(&mut *self.0)
        .await?;
        Ok(())
    }
}
impl CompletionOutboxTransaction for PgOutboxTransaction {
    async fn next(&mut self) -> anyhow::Result<Option<EmailCompletionOutboxRow>> {
        Ok(sqlx::query_as!(
            EmailCompletionOutboxRow,
            r#"
            SELECT
                outbox.id,
                outbox.backfill_job_id,
                job.link_id AS "email_link_id?"
            FROM email_backfill_completion_outbox outbox
            JOIN email_backfill_jobs job ON job.id = outbox.backfill_job_id
            WHERE outbox.published_at IS NULL
              AND job.status = 'Complete'
            ORDER BY outbox.created_at, outbox.id
            FOR UPDATE OF outbox SKIP LOCKED
            LIMIT 1
            "#,
        )
        .fetch_optional(&mut *self.0)
        .await?)
    }
    async fn published(&mut self, id: Uuid, retire: bool) -> anyhow::Result<()> {
        if retire {
            sqlx::query!(
                r#"
                UPDATE email_backfill_completion_outbox
                SET published_at = COALESCE(published_at, now()),
                    completed_at = COALESCE(completed_at, now())
                WHERE id = $1
                "#,
                id,
            )
            .execute(&mut *self.0)
            .await?;
        } else {
            sqlx::query!(
                r#"
            UPDATE email_backfill_completion_outbox
            SET published_at = now()
            WHERE id = $1
            "#,
                id,
            )
            .execute(&mut *self.0)
            .await?;
        }
        Ok(())
    }
}
impl CrmOutboxTransaction for PgOutboxTransaction {
    async fn next(&mut self) -> anyhow::Result<Option<CrmOutboxRow>> {
        Ok(sqlx::query_as!(
            CrmOutboxRow,
            r#"SELECT o.team_id, o.user_id, o.traceparent FROM crm_email_backfill_outbox o
               ORDER BY o.requested_at, o.team_id, o.user_id
               FOR UPDATE OF o SKIP LOCKED LIMIT 1"#
        )
        .fetch_optional(&mut *self.0)
        .await?)
    }
    async fn enabled(&mut self, row: &CrmOutboxRow) -> anyhow::Result<bool> {
        Ok(sqlx::query_scalar!(
            r#"SELECT EXISTS (SELECT 1 FROM crm_email_consent c
               JOIN email_links l ON l.id = c.link_id AND l.macro_id = c.user_id AND l.is_primary AND l.deleting_at IS NULL
               WHERE c.team_id = $1 AND c.user_id = $2 AND c.enabled) AS "enabled!""#,
            row.team_id,
            row.user_id
        )
        .fetch_one(&mut *self.0)
        .await?)
    }
    async fn delete(&mut self, row: &CrmOutboxRow) -> anyhow::Result<()> {
        sqlx::query!(
            "DELETE FROM crm_email_backfill_outbox WHERE team_id = $1 AND user_id = $2",
            row.team_id,
            row.user_id
        )
        .execute(&mut *self.0)
        .await?;
        Ok(())
    }
}
impl BackfillOutboxPublisher for BackfillSqs {
    async fn publish(
        &self,
        message: models_email::service::backfill::BackfillPubsubMessage,
    ) -> anyhow::Result<()> {
        self.0.enqueue_email_backfill_message(message).await
    }
    fn adopt(&self, span: &tracing::Span, traceparent: Option<&str>) {
        sqs_client::email::trace_context::adopt(span, traceparent);
    }
}
#[cfg(test)]
mod crm;
