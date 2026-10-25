//! Postgres side of resumable Notion workspace imports: the lease on the
//! user's run, and what a write already created.

use std::str::FromStr;
use std::time::Duration;

use agent_session::domain::model::AgentSessionId;
use agent_session::domain::notifications::PendingNotification;
use import_notion::domain::model::ImportScope;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::{PgImportRepo, run_status_strings};
use crate::domain::models::{
    AdoptedRun, NotionJob, NotionSharing, ReviewedRun, RunReview, RunStatus, WrittenKind,
    WrittenObject,
};
use crate::domain::ports::{ImportError, NotionRunRepo, Result, WrittenObjects};

#[cfg(test)]
mod test;

fn seconds(duration: Duration) -> f64 {
    duration.as_secs_f64()
}

struct WrittenDbRow {
    import_id: Uuid,
    kind: String,
    object: String,
    macro_id: Uuid,
}

impl TryFrom<WrittenDbRow> for WrittenObject {
    type Error = ImportError;

    fn try_from(row: WrittenDbRow) -> Result<Self> {
        Ok(Self {
            import_id: row.import_id,
            kind: WrittenKind::from_str(&row.kind)
                .map_err(|_| anyhow::anyhow!("unknown written kind: {}", row.kind))?,
            object: row.object,
            macro_id: row.macro_id,
        })
    }
}

impl NotionRunRepo for PgImportRepo {
    #[tracing::instrument(skip(self, job), err)]
    async fn take_run(
        &self,
        user: &MacroUserIdStr<'static>,
        owner: Uuid,
        lease: Duration,
        job: &NotionJob,
    ) -> Result<bool> {
        let (scope, sharing, review_id) = match job {
            NotionJob::Plan { scope, sharing } => (
                Some(serde_json::to_value(scope)?),
                Some(sharing.as_ref()),
                None,
            ),
            NotionJob::Write { review_id } => (None, None, Some(*review_id)),
        };
        let result = sqlx::query!(
            r#"
            UPDATE import_run
            SET lease_owner = $2,
                lease_expires_at = NOW() + ($3::double precision * interval '1 second'),
                scope = $4, review_id = $5, sharing = $6, updated_at = NOW()
            WHERE user_id = $1 AND source = 'notion' AND status IN ('running', 'importing')
              AND lease_owner IS NULL AND lease_expires_at IS NULL
            "#,
            user.as_ref(),
            owner,
            seconds(lease),
            scope,
            review_id,
            sharing,
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    #[tracing::instrument(skip(self), err)]
    async fn renew_lease(
        &self,
        user: &MacroUserIdStr<'static>,
        owner: Uuid,
        lease: Duration,
    ) -> Result<bool> {
        let result = sqlx::query!(
            r#"
            UPDATE import_run
            SET lease_expires_at = NOW() + ($3::double precision * interval '1 second'),
                updated_at = NOW()
            WHERE user_id = $1 AND source = 'notion' AND status IN ('running', 'importing')
              AND lease_owner = $2
            "#,
            user.as_ref(),
            owner,
            seconds(lease),
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    #[tracing::instrument(skip(self), err)]
    async fn release_lease(&self, user: &MacroUserIdStr<'static>, owner: Uuid) -> Result<bool> {
        // Lapsed as of now, so the next adopter takes it straight away.
        let result = sqlx::query!(
            r#"
            UPDATE import_run
            SET lease_owner = NULL, lease_expires_at = NOW()
            WHERE user_id = $1 AND source = 'notion' AND lease_owner = $2
            "#,
            user.as_ref(),
            owner,
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    #[tracing::instrument(skip(self), err)]
    async fn adopt_stalled_runs(
        &self,
        user: Option<&MacroUserIdStr<'static>>,
        owner: Uuid,
        lease: Duration,
        stale_after: Duration,
        limit: u16,
    ) -> Result<Vec<AdoptedRun>> {
        let rows = sqlx::query!(
            r#"
            WITH stalled AS (
                SELECT user_id FROM import_run
                WHERE source = 'notion' AND status IN ('running', 'importing')
                  AND ($1::text IS NULL OR user_id = $1)
                  AND (lease_expires_at < NOW()
                       OR (lease_expires_at IS NULL
                           AND updated_at < NOW() - ($4::double precision * interval '1 second')))
                ORDER BY updated_at
                LIMIT $5
                FOR UPDATE SKIP LOCKED
            )
            UPDATE import_run AS run
            SET lease_owner = $2,
                lease_expires_at = NOW() + ($3::double precision * interval '1 second'),
                adoptions = run.adoptions + 1,
                updated_at = NOW()
            FROM stalled
            WHERE run.user_id = stalled.user_id AND run.source = 'notion'
            RETURNING run.user_id, run.status::text AS "status!", run.scope, run.sharing,
                      run.review_id,
                      run.adoptions
            "#,
            user.map(|user| user.as_ref().to_string()) as Option<String>,
            owner,
            seconds(lease),
            seconds(stale_after),
            i64::from(limit),
        )
        .fetch_all(&self.pool)
        .await?;
        let mut adopted = Vec::with_capacity(rows.len());
        for row in rows {
            let user = MacroUserIdStr::parse_from_str(&row.user_id)
                .map_err(|error| anyhow::anyhow!("unparseable import run user: {error:?}"))?
                .into_owned();
            let status = RunStatus::from_str(&row.status)
                .map_err(|_| anyhow::anyhow!("unknown run status: {}", row.status))?;
            let job = match (status, row.scope, row.sharing, row.review_id) {
                (RunStatus::Running, Some(scope), Some(sharing), _) => Some(NotionJob::Plan {
                    scope: serde_json::from_value::<ImportScope>(scope)?,
                    sharing: NotionSharing::from_str(&sharing)
                        .map_err(|_| anyhow::anyhow!("unknown notion sharing: {sharing}"))?,
                }),
                (RunStatus::Importing, _, _, Some(review_id)) => {
                    Some(NotionJob::Write { review_id })
                }
                _ => None,
            };
            adopted.push(AdoptedRun {
                user,
                status,
                job,
                adoptions: u16::try_from(row.adoptions).unwrap_or(0),
            });
        }
        Ok(adopted)
    }

    #[tracing::instrument(skip(self, event), fields(notified = tracing::field::Empty), err)]
    async fn transition_reviewed_run<Event>(
        &self,
        user: &MacroUserIdStr<'static>,
        from: &[RunStatus],
        to: RunStatus,
        error: Option<&str>,
        event: Event,
    ) -> Result<Option<ReviewedRun>>
    where
        Event: FnOnce(&ReviewedRun) -> Option<PendingNotification> + Send,
    {
        let from = run_status_strings(from);
        let mut transaction = self.pool.begin().await?;
        let Some(row) = sqlx::query!(
            r#"
            UPDATE import_run
            SET status = CASE WHEN status = 'dismissed' THEN status
                              ELSE $2::text::import_run_status END,
                error = CASE WHEN status = 'dismissed' THEN error ELSE $3 END,
                updated_at = NOW(), lease_owner = NULL, lease_expires_at = NULL
            WHERE user_id = $1 AND source = 'notion' AND status::text = ANY($4::text[])
            RETURNING status::text AS "status!", error, review_id, review_session_id
            "#,
            user.as_ref(),
            to.as_ref(),
            error,
            &from,
        )
        .fetch_optional(&mut *transaction)
        .await?
        else {
            return Ok(None);
        };
        let run = ReviewedRun {
            status: RunStatus::from_str(&row.status)
                .map_err(|_| anyhow::anyhow!("unknown run status: {}", row.status))?,
            error: row.error,
            review: row
                .review_id
                .zip(row.review_session_id)
                .map(|(review_id, session_id)| RunReview {
                    review_id,
                    session_id: AgentSessionId::new_from_uuid(session_id),
                }),
        };
        let pending = event(&run);
        tracing::Span::current().record("notified", pending.is_some());
        if let (Some(pending), Some(notifications)) = (pending, &self.notifications) {
            notifications
                .produce(&mut *transaction, &pending)
                .await
                .map_err(|error| ImportError::Db(rootcause::report!(error).into_dynamic()))?;
        }
        transaction.commit().await?;
        Ok(Some(run))
    }

    #[tracing::instrument(skip(self), err)]
    async fn root_folder(&self, user: &MacroUserIdStr<'static>) -> Result<Option<Uuid>> {
        let folder = sqlx::query_scalar!(
            r#"SELECT root_folder_id FROM import_run WHERE user_id = $1 AND source = 'notion'"#,
            user.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(folder.flatten())
    }

    #[tracing::instrument(skip(self), err)]
    async fn set_root_folder(&self, user: &MacroUserIdStr<'static>, folder: Uuid) -> Result<()> {
        sqlx::query!(
            r#"UPDATE import_run SET root_folder_id = $2 WHERE user_id = $1 AND source = 'notion'"#,
            user.as_ref(),
            folder,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn settle_importing(&self, user: &MacroUserIdStr<'static>, reason: &str) -> Result<u64> {
        let mut transaction = self.pool.begin().await?;
        let settled = sqlx::query_scalar!(
            r#"
            UPDATE import_entity AS mine
            SET status = 'staged', last_error = $2, team_id = NULL, waiting_on = NULL,
                updated_at = NOW()
            WHERE mine.user_id = $1 AND mine.source = 'notion' AND mine.status = 'importing'
              AND mine.metadata->'plan' IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM import_run
                  WHERE user_id = $1 AND source = 'notion' AND status = 'importing'
              )
              AND NOT EXISTS (
                  SELECT 1 FROM import_entity AS holder
                  WHERE holder.id = mine.waiting_on AND holder.status = 'importing'
              )
            RETURNING mine.id
            "#,
            user.as_ref(),
            reason,
        )
        .fetch_all(&mut *transaction)
        .await?;
        super::release_waiters(&mut transaction, &settled).await?;
        transaction.commit().await?;
        Ok(u64::try_from(settled.len()).unwrap_or(u64::MAX))
    }
}

impl WrittenObjects for PgImportRepo {
    #[tracing::instrument(skip(self, import_ids), fields(rows = import_ids.len()), err)]
    async fn written(
        &self,
        user: &MacroUserIdStr<'static>,
        import_ids: &[Uuid],
    ) -> Result<Vec<WrittenObject>> {
        let rows = sqlx::query_as!(
            WrittenDbRow,
            r#"
            SELECT written.import_id, written.kind, written.object, written.macro_id
            FROM import_entity_written AS written
            JOIN import_entity AS entity ON entity.id = written.import_id
            WHERE entity.user_id = $1 AND written.import_id = ANY($2::uuid[])
            "#,
            user.as_ref(),
            import_ids,
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(WrittenObject::try_from).collect()
    }

    #[tracing::instrument(skip(self, objects), fields(objects = objects.len()), err)]
    async fn record_written(
        &self,
        user: &MacroUserIdStr<'static>,
        objects: &[WrittenObject],
    ) -> Result<Vec<WrittenObject>> {
        if objects.is_empty() {
            return Ok(Vec::new());
        }
        let import_ids: Vec<Uuid> = objects.iter().map(|object| object.import_id).collect();
        let kinds: Vec<String> = objects
            .iter()
            .map(|object| object.kind.as_ref().to_string())
            .collect();
        let names: Vec<String> = objects.iter().map(|object| object.object.clone()).collect();
        let macro_ids: Vec<Uuid> = objects.iter().map(|object| object.macro_id).collect();
        // The final SELECT sees the table as it was before the insert, so an
        // object comes back either as inserted now or as recorded earlier.
        let rows = sqlx::query_as!(
            WrittenDbRow,
            r#"
            WITH input AS (
                SELECT * FROM UNNEST($2::uuid[], $3::text[], $4::text[], $5::uuid[])
                    AS input(import_id, kind, object, macro_id)
            ),
            inserted AS (
                INSERT INTO import_entity_written (import_id, kind, object, macro_id)
                SELECT input.import_id, input.kind, input.object, input.macro_id
                FROM input
                JOIN import_entity AS entity ON entity.id = input.import_id AND entity.user_id = $1
                ON CONFLICT (import_id, kind, object) DO NOTHING
                RETURNING import_id, kind, object, macro_id
            )
            SELECT import_id AS "import_id!", kind AS "kind!", object AS "object!",
                   macro_id AS "macro_id!"
            FROM inserted
            UNION ALL
            SELECT written.import_id, written.kind, written.object, written.macro_id
            FROM import_entity_written AS written
            JOIN input USING (import_id, kind, object)
            JOIN import_entity AS entity ON entity.id = written.import_id AND entity.user_id = $1
            "#,
            user.as_ref(),
            &import_ids,
            &kinds,
            &names,
            &macro_ids,
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(WrittenObject::try_from).collect()
    }
}
