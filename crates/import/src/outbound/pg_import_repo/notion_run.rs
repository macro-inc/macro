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
    AdoptedRun, ImportSource, NotionJob, NotionSharing, ReviewedRun, RunReview, RunStatus,
    WrittenKind, WrittenObject,
};
use crate::domain::ports::{ImportError, NotionRunRepo, Result, WrittenObjects};

mod outage;

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
            kind: WrittenKind::from_str(&row.kind).unwrap_or(WrittenKind::Unsupported),
            object: row.object,
            macro_id: row.macro_id,
        })
    }
}

impl NotionRunRepo for PgImportRepo {
    fn for_source(&self, source: ImportSource) -> Self {
        Self {
            workspace_source: source,
            ..self.clone()
        }
    }

    #[tracing::instrument(skip(self, job, user), err)]
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
            NotionJob::TrackerPlan { sharing } => (
                Some(serde_json::json!({"tracker":true})),
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
            WHERE user_id = $1 AND source = $7 AND status IN ('running', 'importing')
              AND lease_owner IS NULL AND lease_expires_at IS NULL
            "#,
            user.as_ref(),
            owner,
            seconds(lease),
            scope,
            review_id,
            sharing,
            self.workspace_source.as_ref(),
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    #[tracing::instrument(skip(self, user), err)]
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
            WHERE user_id = $1 AND source = $4 AND status IN ('running', 'importing')
              AND lease_owner = $2
            "#,
            user.as_ref(),
            owner,
            seconds(lease),
            self.workspace_source.as_ref(),
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    #[tracing::instrument(skip(self, user), err)]
    async fn release_lease(&self, user: &MacroUserIdStr<'static>, owner: Uuid) -> Result<bool> {
        // Lapsed as of now, so the next adopter takes it straight away.
        let result = sqlx::query!(
            r#"
            UPDATE import_run
            SET lease_owner = NULL, lease_expires_at = NOW()
            WHERE user_id = $1 AND source = $3 AND lease_owner = $2
            "#,
            user.as_ref(),
            owner,
            self.workspace_source.as_ref(),
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    #[tracing::instrument(skip(self, user), err)]
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
                WHERE source = $6 AND status IN ('running', 'importing')
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
            WHERE run.user_id = stalled.user_id AND run.source = $6
            RETURNING run.user_id, run.status::text AS "status!", run.scope, run.sharing,
                      run.review_id,
                      run.adoptions
            "#,
            user.map(|user| user.as_ref().to_string()) as Option<String>,
            owner,
            seconds(lease),
            seconds(stale_after),
            i64::from(limit),
            self.workspace_source.as_ref(),
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
                (RunStatus::Running, Some(_), Some(sharing), _)
                    if self.workspace_source != ImportSource::Notion =>
                {
                    Some(NotionJob::TrackerPlan {
                        sharing: NotionSharing::from_str(&sharing)
                            .map_err(|_| anyhow::anyhow!("unknown import sharing: {sharing}"))?,
                    })
                }
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

    #[tracing::instrument(skip(self, event, user), fields(notified = tracing::field::Empty), err)]
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
            WHERE user_id = $1 AND source = $5 AND status::text = ANY($4::text[])
            RETURNING status::text AS "status!", error, review_id, review_session_id
            "#,
            user.as_ref(),
            to.as_ref(),
            error,
            &from,
            self.workspace_source.as_ref(),
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

    #[tracing::instrument(skip(self, user), err)]
    async fn root_folder(&self, user: &MacroUserIdStr<'static>) -> Result<Option<Uuid>> {
        let folder = sqlx::query_scalar!(
            r#"SELECT root_folder_id FROM import_run WHERE user_id = $1 AND source = $2"#,
            user.as_ref(),
            self.workspace_source.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(folder.flatten())
    }

    async fn personal_root_folder(&self, user: &MacroUserIdStr<'static>) -> Result<Option<Uuid>> {
        Ok(sqlx::query_scalar!(
            r#"
            SELECT personal_root_folder_id FROM import_run
            WHERE user_id = $1 AND source = $2
            "#,
            user.as_ref(),
            self.workspace_source.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await?
        .flatten())
    }

    async fn set_personal_root_folder(
        &self,
        user: &MacroUserIdStr<'static>,
        folder: Uuid,
    ) -> Result<()> {
        let updated = sqlx::query!(
            r#"
            UPDATE import_run
            SET personal_root_folder_id = $2, personal_folder_ids = '{}'::jsonb
            WHERE user_id = $1 AND source = $3
            "#,
            user.as_ref(),
            folder,
            self.workspace_source.as_ref(),
        )
        .execute(&self.pool)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(anyhow::anyhow!("personal mirror import run is missing").into());
        }
        Ok(())
    }

    async fn personal_folder(
        &self,
        user: &MacroUserIdStr<'static>,
        path: &[String],
    ) -> Result<Option<Uuid>> {
        let key = serde_json::to_string(path)?;
        let id = sqlx::query_scalar!(
            r#"
            SELECT personal_folder_ids ->> $3 AS folder FROM import_run
            WHERE user_id = $1 AND source = $2
            "#,
            user.as_ref(),
            self.workspace_source.as_ref(),
            key,
        )
        .fetch_optional(&self.pool)
        .await?
        .flatten();
        id.map(|id| {
            id.parse()
                .map_err(|error| anyhow::anyhow!("invalid personal folder id: {error}").into())
        })
        .transpose()
    }

    async fn set_personal_folder(
        &self,
        user: &MacroUserIdStr<'static>,
        path: &[String],
        folder: Uuid,
    ) -> Result<()> {
        let key = serde_json::to_string(path)?;
        let updated = sqlx::query!(
            r#"
            UPDATE import_run
            SET personal_folder_ids = jsonb_set(
                COALESCE(personal_folder_ids, '{}'::jsonb), ARRAY[$3], to_jsonb($4::text)
            )
            WHERE user_id = $1 AND source = $2
            "#,
            user.as_ref(),
            self.workspace_source.as_ref(),
            key,
            folder.to_string(),
        )
        .execute(&self.pool)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(anyhow::anyhow!("personal mirror import run is missing").into());
        }
        Ok(())
    }

    async fn set_shared_folder(
        &self,
        user: &MacroUserIdStr<'static>,
        import_id: Uuid,
        folder: Uuid,
    ) -> Result<()> {
        // Keep the source lookup on the item PK even with stale owner statistics.
        let updated = sqlx::query!(
            r#"
            INSERT INTO import_entity_written AS shared_folder (import_id, kind, object, macro_id)
            SELECT entity.id, 'folder', 'shared', $3
            FROM import_entity AS entity
            WHERE entity.id = $2 AND (SELECT entity.user_id OFFSET 0) = $1
            ON CONFLICT (import_id, kind, object) DO UPDATE SET macro_id = EXCLUDED.macro_id
            "#,
            user.as_ref(),
            import_id,
            folder,
        )
        .execute(&self.pool)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(
                anyhow::anyhow!("import item is missing or not owned by the caller").into(),
            );
        }
        Ok(())
    }

    async fn record_personal_relocation(
        &self,
        user: &MacroUserIdStr<'static>,
        import_id: Uuid,
        folder: Uuid,
    ) -> Result<()> {
        // Fence the tuple's owner check so stale statistics cannot drive this
        // one-item update through the user's entire ledger instead of its PK.
        let updated = sqlx::query!(
            r#"
            UPDATE import_entity AS entity
            SET metadata = jsonb_set(entity.metadata, '{personalFolderId}', to_jsonb($3::text))
            WHERE entity.id = $1 AND (SELECT entity.user_id OFFSET 0) = $2
            "#,
            import_id,
            user.as_ref(),
            folder.to_string(),
        )
        .execute(&self.pool)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(
                anyhow::anyhow!("import item is missing or not owned by the caller").into(),
            );
        }
        Ok(())
    }

    async fn record_separate_folder(
        &self,
        user: &MacroUserIdStr<'static>,
        import_id: Uuid,
        folder: Uuid,
        reason: crate::domain::ports::FolderSeparation,
    ) -> Result<()> {
        use crate::domain::ports::FolderSeparation;
        let visibility = match reason {
            FolderSeparation::PersonalFromShared => "personal",
            FolderSeparation::SharedFromPersonal | FolderSeparation::SharedAfterGrantRemoval => {
                "shared"
            }
        };
        let record =
            serde_json::json!({"visibility":visibility, "folderId":folder, "reason":reason});
        // Fence the tuple's owner check so stale statistics cannot drive this
        // one-item update through the user's entire ledger instead of its PK.
        let updated = sqlx::query!(
            r#"
            UPDATE import_entity AS entity
            SET metadata = jsonb_set(entity.metadata, '{separateFolder}', $3)
            WHERE entity.id = $1 AND (SELECT entity.user_id OFFSET 0) = $2
            "#,
            import_id,
            user.as_ref(),
            record,
        )
        .execute(&self.pool)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(
                anyhow::anyhow!("import item is missing or not owned by the caller").into(),
            );
        }
        Ok(())
    }

    #[tracing::instrument(skip(self, user), err)]
    async fn set_root_folder(&self, user: &MacroUserIdStr<'static>, folder: Uuid) -> Result<()> {
        sqlx::query!(
            r#"UPDATE import_run SET root_folder_id = $2 WHERE user_id = $1 AND source = $3"#,
            user.as_ref(),
            folder,
            self.workspace_source.as_ref(),
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(skip(self, user), err)]
    async fn settle_importing(&self, user: &MacroUserIdStr<'static>, reason: &str) -> Result<u64> {
        let mut transaction = self.pool.begin().await?;
        let settled = sqlx::query_scalar!(
            r#"
            UPDATE import_entity AS mine
            SET status = 'staged', last_error = $2, team_id = NULL, waiting_on = NULL,
                updated_at = NOW()
            WHERE mine.user_id = $1 AND mine.source = $3 AND mine.status = 'importing'
              AND mine.metadata->'plan' IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM import_run
                  WHERE user_id = $1 AND source = $3 AND status = 'importing'
              )
              AND NOT EXISTS (
                  SELECT 1 FROM import_entity AS holder
                  WHERE holder.id = mine.waiting_on AND holder.status = 'importing'
              )
            RETURNING mine.id
            "#,
            user.as_ref(),
            reason,
            self.workspace_source.as_ref(),
        )
        .fetch_all(&mut *transaction)
        .await?;
        super::release_waiters(&mut transaction, &settled).await?;
        transaction.commit().await?;
        Ok(u64::try_from(settled.len()).unwrap_or(u64::MAX))
    }
}

impl WrittenObjects for PgImportRepo {
    #[tracing::instrument(skip_all, fields(items = import_ids.len()), err)]
    async fn confirmed_notion_writes(
        &self,
        user: &MacroUserIdStr<'static>,
        import_ids: &[Uuid],
    ) -> Result<crate::domain::models::ConfirmedNotionWrites> {
        use crate::domain::models::ConfirmedNotionWrites;

        if import_ids.is_empty() {
            return Ok(ConfirmedNotionWrites::default());
        }
        let mut tx = self.pool.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '15s'")
            .execute(&mut *tx)
            .await?;
        // Keep the owned PK lookup driven by the passed IDs even when the
        // custom plan knows the complete array is large.
        let counts = sqlx::query!(
            r#"
            SELECT COALESCE(sum(output.writes) FILTER (WHERE kinds.kind = 'document' AND owned.finished), 0)::bigint AS "documents!",
                COALESCE(sum(output.writes) FILTER (WHERE kinds.kind = 'database' AND owned.finished), 0)::bigint AS "databases!",
                COALESCE(sum(output.writes) FILTER (WHERE kinds.kind = 'row'), 0)::bigint AS "database_rows!",
                COALESCE(sum(output.writes) FILTER (WHERE kinds.kind = 'row' AND NOT owned.finished), 0)::bigint AS "partial_database_rows!",
                COALESCE(sum(output.writes) FILTER (WHERE kinds.kind = 'tasks_folder' AND owned.finished), 0)::bigint AS "task_lists!",
                COALESCE(sum(output.writes) FILTER (WHERE kinds.kind = 'task'), 0)::bigint AS "tasks!",
                COALESCE(sum(output.writes) FILTER (WHERE kinds.kind = 'task' AND NOT owned.finished), 0)::bigint AS "partial_tasks!"
            FROM unnest($2::uuid[]) AS wanted(id)
            CROSS JOIN LATERAL (
                SELECT entity.id, entity.status = 'imported' AS finished
                FROM import_entity AS entity
                WHERE entity.id = wanted.id AND entity.user_id = $1
                  AND entity.source = 'notion' AND entity.status <> 'discarded'
                OFFSET 0
            ) AS owned
            CROSS JOIN (
                VALUES ('document', $3::text), ('database', $4::text), ('row', $5::text),
                    ('tasks_folder', $6::text), ('task', $7::text)
            ) AS kinds(kind, marker)
            CROSS JOIN LATERAL (
                SELECT count(*) AS writes
                FROM import_entity_written AS written
                WHERE written.import_id = owned.id AND written.kind = kinds.marker
            ) AS output
            "#,
            user.as_ref(),
            import_ids,
            WrittenKind::Document.as_ref(),
            WrittenKind::Database.as_ref(),
            WrittenKind::Row.as_ref(),
            WrittenKind::TasksFolder.as_ref(),
            WrittenKind::Task.as_ref(),
        )
        .fetch_one(&mut *tx)
        .await?;
        tx.commit().await?;
        let count = |value| u32::try_from(value).map_err(anyhow::Error::from);
        Ok(ConfirmedNotionWrites {
            documents: count(counts.documents)?,
            databases: count(counts.databases)?,
            database_rows: count(counts.database_rows)?,
            partial_database_rows: count(counts.partial_database_rows)?,
            task_lists: count(counts.task_lists)?,
            tasks: count(counts.tasks)?,
            partial_tasks: count(counts.partial_tasks)?,
        })
    }
    #[tracing::instrument(skip_all, fields(import_id = %import_id, review_id = %review_id, facts = facts.len()), err)]
    async fn replace_database_outage(
        &self,
        user: &MacroUserIdStr<'static>,
        import_id: Uuid,
        review_id: Uuid,
        expected: Option<&str>,
        facts: &[WrittenObject],
    ) -> Result<()> {
        self.replace_outage_snapshot(user, import_id, review_id, expected, facts)
            .await
    }

    #[tracing::instrument(skip_all, fields(import_id = %import_id), err)]
    async fn clear_database_reservation_failures(
        &self,
        user: &MacroUserIdStr<'static>,
        import_id: Uuid,
    ) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '15s'")
            .execute(&mut *tx)
            .await?;
        // Share the outage CAS lock, then obtain a fresh snapshot for deletion.
        sqlx::query_scalar!(
            r#"SELECT entity.id
               FROM import_entity AS entity
               WHERE entity.id = $2
                 AND (SELECT entity.user_id = $1 AND entity.source = 'notion'
                      AND entity.kind = 'data_source' OFFSET 0)
               FOR UPDATE OF entity"#,
            user.as_ref(),
            import_id,
        )
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| anyhow::anyhow!("import item is missing or not owned by the caller"))?;
        let owned = sqlx::query_scalar!(
            r#"
WITH owned AS MATERIALIZED (
    SELECT entity.id FROM import_entity AS entity
    WHERE entity.id = $2 AND (SELECT entity.user_id OFFSET 0) = $1
      AND entity.source = 'notion' AND entity.kind = 'data_source'
), removed AS (
    DELETE FROM import_entity_written AS written USING owned
    WHERE written.import_id = owned.id AND written.kind = 'database_reservation_failure'
    RETURNING written.import_id
)
SELECT EXISTS (SELECT 1 FROM owned) AS "owned!"
        "#,
            user.as_ref(),
            import_id
        )
        .fetch_one(&mut *tx)
        .await?;
        if !owned {
            return Err(
                anyhow::anyhow!("import item is missing or not owned by the caller").into(),
            );
        }
        tx.commit().await?;
        Ok(())
    }

    #[tracing::instrument(skip_all, fields(review_id = %review, sources = import_ids.len(), included = included.len()), err)]
    async fn replace_dependency_inclusions(
        &self,
        user: &MacroUserIdStr<'static>,
        review: Uuid,
        import_ids: &[Uuid],
        included: &[Uuid],
    ) -> Result<()> {
        let mut ids = import_ids.to_vec();
        ids.sort_unstable();
        ids.dedup();
        let mut selected = included.to_vec();
        selected.sort_unstable();
        selected.dedup();
        if !selected.iter().all(|id| ids.binary_search(id).is_ok()) {
            return Err(crate::domain::ports::ImportError::NotReady(
                "The approved dependency selection does not match this review.",
            ));
        }
        if ids.is_empty() {
            return Ok(());
        }
        let mut tx = self.pool.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '15s'")
            .execute(&mut *tx)
            .await?;
        // The lateral fence keeps each ownership check behind its requested PK.
        // Lock in id order so concurrent approvals replace one another atomically.
        let locked = sqlx::query_scalar!(
            r#"SELECT owned.id AS "id!"
               FROM (SELECT id FROM UNNEST($3::uuid[]) AS wanted(id) ORDER BY id) AS wanted
               JOIN LATERAL (
                   SELECT entity.id FROM import_entity AS entity
                   WHERE entity.id = wanted.id AND (SELECT entity.user_id OFFSET 0) = $1
                     AND entity.review_id = $2 AND entity.source = 'notion'
                     AND entity.kind = 'data_source' AND entity.status = 'staged'
                   OFFSET 0 FOR UPDATE OF entity
               ) AS owned ON true"#,
            user.as_ref(),
            review,
            &ids,
        )
        .fetch_all(&mut *tx)
        .await?;
        if locked.len() != ids.len() {
            return Err(crate::domain::ports::ImportError::NotReady(
                "This import review changed; reload it before approving.",
            ));
        }
        let scope = review.to_string();
        sqlx::query!(
            r#"DELETE FROM import_entity_written
               WHERE import_id = ANY($1::uuid[]) AND kind = 'dependency_included' AND object = $2"#,
            &locked,
            &scope,
        )
        .execute(&mut *tx)
        .await?;
        sqlx::query!(
            r#"INSERT INTO import_entity_written (import_id, kind, object, macro_id)
               SELECT selected.import_id, 'dependency_included', $1, $3
               FROM UNNEST($2::uuid[]) AS selected(import_id)
               ON CONFLICT (import_id, kind, object) DO NOTHING"#,
            &scope,
            &selected,
            review,
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }

    #[tracing::instrument(skip(self, user), err)]
    async fn record_task_notice(
        &self,
        user: &MacroUserIdStr<'static>,
        import_id: Uuid,
        task_id: Uuid,
        reason: crate::domain::ports::TaskImportNoticeReason,
    ) -> Result<()> {
        let payload =
            serde_json::to_string(&crate::domain::ports::TaskImportNotice { task_id, reason })?;
        let owned = sqlx::query_scalar!(
            r#"
WITH owned AS MATERIALIZED (
    SELECT entity.id FROM import_entity AS entity
    WHERE entity.id = $2 AND (SELECT entity.user_id OFFSET 0) = $1
), inserted AS (
    INSERT INTO import_entity_written (import_id, kind, object, macro_id)
    SELECT owned.id, 'task_notice', $3, $4 FROM owned
    ON CONFLICT (import_id, kind, object) DO NOTHING
    RETURNING import_id
)
SELECT EXISTS (SELECT 1 FROM owned) AS "owned!"
        "#,
            user.as_ref(),
            import_id,
            payload,
            task_id
        )
        .fetch_one(&self.pool)
        .await?;
        if !owned {
            return Err(
                anyhow::anyhow!("import item is missing or not owned by the caller").into(),
            );
        }
        Ok(())
    }

    #[tracing::instrument(skip(self, user, import_ids), fields(items=import_ids.len()), err)]
    async fn task_notice_counts(
        &self,
        user: &MacroUserIdStr<'static>,
        import_ids: &[Uuid],
    ) -> Result<Vec<crate::domain::ports::TaskImportNoticeCount>> {
        if import_ids.is_empty() {
            return Ok(Vec::new());
        }
        let ids: Vec<_> = import_ids
            .iter()
            .copied()
            .collect::<std::collections::HashSet<_>>()
            .into_iter()
            .collect();
        let rows = sqlx::query!(
            r#"
SELECT written.import_id, written.object::jsonb ->> 'reason' AS reason,
    count(DISTINCT written.macro_id) AS "count!",
    bool_and((written.object::jsonb - ARRAY['task_id', 'reason']) = '{}'::jsonb
        AND (written.object::jsonb ->> 'task_id')::uuid = written.macro_id) AS valid
FROM UNNEST($2::uuid[]) AS wanted(import_id)
JOIN import_entity AS entity ON entity.id = wanted.import_id
    AND (SELECT entity.user_id OFFSET 0) = $1
JOIN import_entity_written AS written ON written.import_id = entity.id
    AND written.kind = 'task_notice'
GROUP BY written.import_id, written.object::jsonb ->> 'reason'
        "#,
            user.as_ref(),
            &ids
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                anyhow::ensure!(row.valid == Some(true), "invalid task notice identity");
                let reason = row
                    .reason
                    .ok_or_else(|| anyhow::anyhow!("task notice reason is missing"))?;
                Ok(crate::domain::ports::TaskImportNoticeCount {
                    import_id: row.import_id,
                    reason: serde_json::from_value(serde_json::Value::String(reason))?,
                    count: u32::try_from(row.count).map_err(anyhow::Error::from)?,
                })
            })
            .collect::<anyhow::Result<Vec<_>>>()
            .map_err(Into::into)
    }

    #[tracing::instrument(skip(self, user), err)]
    async fn clear_task_notices(
        &self,
        user: &MacroUserIdStr<'static>,
        import_id: Uuid,
    ) -> Result<()> {
        let owned = sqlx::query_scalar!(
            r#"
WITH owned AS MATERIALIZED (
    SELECT entity.id FROM import_entity AS entity
    WHERE entity.id = $2 AND (SELECT entity.user_id OFFSET 0) = $1
), removed AS (
    DELETE FROM import_entity_written AS written USING owned
    WHERE written.import_id = owned.id AND written.kind = 'task_notice'
    RETURNING written.import_id
)
SELECT EXISTS (SELECT 1 FROM owned) AS "owned!"
        "#,
            user.as_ref(),
            import_id
        )
        .fetch_one(&self.pool)
        .await?;
        if !owned {
            return Err(
                anyhow::anyhow!("import item is missing or not owned by the caller").into(),
            );
        }
        Ok(())
    }

    #[tracing::instrument(skip_all, fields(source_id = %source, database_id = %database), err)]
    async fn database_mapping(
        &self,
        user: &MacroUserIdStr<'static>,
        source: &import_notion::domain::model::NotionId,
        database: Uuid,
    ) -> Result<Option<crate::domain::ports::RecordedDatabaseMapping>> {
        let table = sqlx::query!(
            r#"
            SELECT table_marker.macro_id, COALESCE(holder.metadata->'warnings', '[]'::jsonb) AS "warnings!"
            FROM import_entity AS holder
            JOIN import_entity_written AS database_marker ON database_marker.import_id = holder.id
                AND database_marker.kind = 'database' AND database_marker.object = ''
            JOIN import_entity_written AS table_marker ON table_marker.import_id = holder.id
                AND table_marker.kind = 'table' AND table_marker.object = ''
            WHERE holder.source = 'notion' AND holder.kind = 'data_source'
                AND holder.foreign_id = $2 AND holder.status = 'imported'
                AND holder.entity_type = 'database' AND holder.entity_id = $3::uuid::text
                AND database_marker.macro_id = $3
                AND (holder.user_id = $1 OR holder.team_id = (SELECT team_id FROM team_user WHERE user_id = $1))
            "#,
            user.as_ref(), source.as_str(), database,
        ).fetch_optional(&self.pool).await?;
        Ok(
            table.map(|row| crate::domain::ports::RecordedDatabaseMapping {
                table: models_databases::TableId::from_uuid(row.macro_id),
                warnings: crate::domain::models::FidelityWarning::decode_entries(&row.warnings),
            }),
        )
    }

    #[tracing::instrument(skip_all, fields(import_id = %import_id, warnings = warnings.len() as i64), err)]
    async fn record_warnings(
        &self,
        user: &MacroUserIdStr<'static>,
        import_id: Uuid,
        warnings: &[crate::domain::models::FidelityWarning],
    ) -> Result<()> {
        if warnings.is_empty() {
            return Ok(());
        }
        let warnings = serde_json::json!(warnings);
        let changed = sqlx::query!(
            r#"
            UPDATE import_entity
            SET metadata = jsonb_set(metadata, '{warnings}', (
                SELECT COALESCE(jsonb_agg(DISTINCT loss), '[]'::jsonb)
                FROM jsonb_array_elements(COALESCE(metadata->'warnings', '[]'::jsonb) || $3::jsonb) AS loss
            )), updated_at = NOW()
            WHERE id = $2 AND user_id = $1 AND metadata->'plan' IS NOT NULL
            "#,
            user.as_ref(), import_id, warnings,
        ).execute(&self.pool).await?;
        if changed.rows_affected() != 1 {
            return Err(ImportError::Other(anyhow::anyhow!(
                "warning ledger row unavailable"
            )));
        }
        Ok(())
    }

    #[tracing::instrument(skip(self, import_ids, user), fields(rows = import_ids.len()), err)]
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

    #[tracing::instrument(skip(self, objects, user), fields(objects = objects.len()), err)]
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
                JOIN import_entity AS entity ON entity.id = input.import_id
                    AND (SELECT entity.user_id OFFSET 0) = $1
                ON CONFLICT (import_id, kind, object) DO NOTHING
                RETURNING import_id, kind, object, macro_id
            )
            SELECT import_id AS "import_id!", kind AS "kind!", object AS "object!",
                   macro_id AS "macro_id!"
            FROM inserted
            UNION ALL
            SELECT written.import_id, written.kind, written.object, written.macro_id
            FROM input
            JOIN LATERAL (
                SELECT written.import_id, written.kind, written.object, written.macro_id
                FROM import_entity_written AS written
                WHERE written.import_id = input.import_id AND written.kind = input.kind
                  AND written.object = input.object
                OFFSET 0
            ) AS written ON true
            JOIN import_entity AS entity ON entity.id = written.import_id
                AND (SELECT entity.user_id OFFSET 0) = $1
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
