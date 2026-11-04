//! Postgres side of Notion workspace plans: staging a plan, the user's
//! sharing choices, and the team's claim on each object it writes.

use std::collections::HashMap;

use agent_session::domain::model::AgentSessionId;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::{ImportEntityDbRow, PgImportRepo, run_status_strings};
use crate::domain::models::{ImportEntity, ImportSource, RunStatus, ScanCounts, TeamClaim};
use crate::domain::ports::{NotionPlanRepo, PlanRow, Result};

#[cfg(test)]
mod test;

/// Attempts at a claim before giving up: a teammate claiming the same object
/// at the same moment makes an attempt fail on the team's unique index, and
/// the next attempt sees their claim.
const CLAIM_ATTEMPTS: u8 = 3;

fn is_unique_violation(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .is_some_and(|error| error.is_unique_violation())
}

impl NotionPlanRepo for PgImportRepo {
    #[tracing::instrument(skip(self, rows), fields(rows = rows.len()), err)]
    async fn replace_plan(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        rows: &[PlanRow],
    ) -> Result<Vec<ImportEntity>> {
        let mut transaction = self.pool.begin().await?;
        // Locked until the plan is staged, so a review attached meanwhile
        // waits and then ties these rows too.
        let review_id = sqlx::query_scalar!(
            r#"
            SELECT review_id FROM import_run
            WHERE user_id = $1 AND source = $2 AND status = 'running'
            FOR UPDATE
            "#,
            user.as_ref(),
            source.as_ref(),
        )
        .fetch_optional(&mut *transaction)
        .await?
        .flatten();
        sqlx::query!(
            r#"
            WITH RECURSIVE retained AS (
                SELECT entity.id, entity.parent_id
                FROM import_entity AS entity
                WHERE entity.user_id = $1 AND entity.source = $2
                  AND EXISTS (
                      SELECT 1 FROM import_entity_written AS written
                      WHERE written.import_id = entity.id
                  )
                UNION
                SELECT parent.id, parent.parent_id
                FROM import_entity AS parent
                JOIN retained AS child ON child.parent_id = parent.id
                WHERE parent.user_id = $1 AND parent.source = $2
            )
            DELETE FROM import_entity
            WHERE user_id = $1 AND source = $2 AND status = 'staged'
              AND metadata->'plan' IS NOT NULL
              AND id NOT IN (SELECT id FROM retained)
            "#,
            user.as_ref(),
            source.as_ref(),
        )
        .execute(&mut *transaction)
        .await?;

        let mut ids: HashMap<&str, Uuid> = HashMap::with_capacity(rows.len());
        let mut staged = Vec::with_capacity(rows.len());
        for row in rows {
            let parent_id = row
                .parent_foreign_id
                .as_deref()
                .and_then(|parent| ids.get(parent).copied());
            let inserted = sqlx::query_as!(
                ImportEntityDbRow,
                r#"
                INSERT INTO import_entity
                    (user_id, source, kind, foreign_id, status, initiator, metadata, parent_id,
                     review_id)
                VALUES ($1, $2, $3, $4, 'staged', 'chat', $5, $6, $7)
                ON CONFLICT (user_id, source, foreign_id) DO UPDATE
                SET kind = EXCLUDED.kind, metadata = EXCLUDED.metadata,
                    parent_id = EXCLUDED.parent_id, status = 'staged',
                    review_id = EXCLUDED.review_id, last_error = NULL, updated_at = NOW()
                WHERE import_entity.status IN ('staged', 'discarded')
                RETURNING id, user_id, team_id, source, kind, foreign_id, parent_id, review_id,
                          status, initiator, metadata, entity_id, entity_type, last_error,
                          waiting_on, created_at, updated_at
                "#,
                user.as_ref(),
                source.as_ref(),
                row.kind.as_ref(),
                row.foreign_id,
                row.metadata,
                parent_id,
                review_id,
            )
            .fetch_optional(&mut *transaction)
            .await?;
            let id = match inserted {
                Some(inserted) => {
                    let entity = ImportEntity::try_from(inserted)?;
                    let id = entity.id;
                    staged.push(entity);
                    id
                }
                // Already importing or imported: children still hang under it.
                None => {
                    sqlx::query_scalar!(
                        r#"
                        SELECT id FROM import_entity
                        WHERE user_id = $1 AND source = $2 AND foreign_id = $3
                        "#,
                        user.as_ref(),
                        source.as_ref(),
                        row.foreign_id,
                    )
                    .fetch_one(&mut *transaction)
                    .await?
                }
            };
            ids.insert(row.foreign_id.as_str(), id);
        }
        transaction.commit().await?;
        Ok(staged)
    }

    #[tracing::instrument(skip(self, rows), fields(rows = rows.len()), err)]
    async fn update_plan_rows(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        rows: &[PlanRow],
    ) -> Result<u64> {
        if rows.is_empty() {
            return Ok(0);
        }
        let foreign_ids: Vec<String> = rows.iter().map(|row| row.foreign_id.clone()).collect();
        let metadata: Vec<serde_json::Value> =
            rows.iter().map(|row| row.metadata.clone()).collect();
        let result = sqlx::query!(
            r#"
            UPDATE import_entity AS entity
            SET metadata = decided.metadata, updated_at = NOW()
            FROM UNNEST($3::text[], $4::jsonb[]) AS decided(foreign_id, metadata)
            WHERE entity.user_id = $1 AND entity.source = $2
              AND entity.foreign_id = decided.foreign_id
              AND entity.status = 'staged' AND entity.metadata->'plan' IS NOT NULL
            "#,
            user.as_ref(),
            source.as_ref(),
            &foreign_ids,
            &metadata,
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected())
    }

    #[tracing::instrument(skip(self), err)]
    async fn attach_review(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        review_id: Uuid,
        session_id: AgentSessionId,
    ) -> Result<u64> {
        let mut transaction = self.pool.begin().await?;
        // First, so a plan being staged right now finishes before the rows
        // are tied (it holds the run), or stages them with this review.
        sqlx::query!(
            r#"
            UPDATE import_run
            SET review_id = CASE WHEN status = 'running' THEN $3 ELSE review_id END,
                review_session_id = CASE WHEN status = 'running' THEN $4
                                         ELSE COALESCE(review_session_id, $4) END
            WHERE user_id = $1 AND source = $2 AND status IN ('running', 'ready')
            "#,
            user.as_ref(),
            source.as_ref(),
            review_id,
            session_id.as_uuid(),
        )
        .execute(&mut *transaction)
        .await?;
        let result = sqlx::query!(
            r#"
            UPDATE import_entity
            SET review_id = $3, updated_at = NOW()
            WHERE user_id = $1 AND source = $2 AND status = 'staged'
              AND metadata->'plan' IS NOT NULL AND review_id IS NULL
            "#,
            user.as_ref(),
            source.as_ref(),
            review_id,
        )
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(result.rows_affected())
    }

    #[tracing::instrument(skip(self), err)]
    async fn transition_run(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        from: &[RunStatus],
        to: RunStatus,
        error: Option<&str>,
    ) -> Result<bool> {
        let from = run_status_strings(from);
        let result = sqlx::query!(
            r#"
            UPDATE import_run
            SET status = $3::text::import_run_status, error = $4, updated_at = NOW(),
                lease_owner = NULL, lease_expires_at = NULL
            WHERE user_id = $1 AND source = $2 AND status::text = ANY($5::text[])
            "#,
            user.as_ref(),
            source.as_ref(),
            to.as_ref(),
            error,
            &from,
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    #[tracing::instrument(skip(self), fields(pages = scanned.pages, data_sources = scanned.data_sources), err)]
    async fn record_scan(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        scanned: ScanCounts,
    ) -> Result<bool> {
        let pages = i32::try_from(scanned.pages).unwrap_or(i32::MAX);
        let data_sources = i32::try_from(scanned.data_sources).unwrap_or(i32::MAX);
        let result = sqlx::query!(
            r#"
            UPDATE import_run
            SET scanned_pages = $3, scanned_data_sources = $4
            WHERE user_id = $1 AND source = $2 AND status = 'running'
            "#,
            user.as_ref(),
            source.as_ref(),
            pages,
            data_sources,
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    #[tracing::instrument(skip(self, foreign_ids), fields(objects = foreign_ids.len()), err)]
    async fn team_copies(
        &self,
        user: &MacroUserIdStr<'static>,
        foreign_ids: &[String],
    ) -> Result<Vec<ImportEntity>> {
        if foreign_ids.is_empty() {
            return Ok(Vec::new());
        }
        let rows = sqlx::query_as!(
            ImportEntityDbRow,
            r#"
            SELECT id, user_id, team_id, source, kind, foreign_id, parent_id, review_id, status,
                   initiator, metadata, entity_id, entity_type, last_error, waiting_on, created_at,
                   updated_at
            FROM import_entity
            WHERE source = $3 AND foreign_id = ANY($2::text[])
              AND status IN ('importing', 'imported')
              AND user_id <> $1
              AND team_id IS NOT NULL
              AND team_id = (SELECT team_id FROM team_user WHERE user_id = $1)
            "#,
            user.as_ref(),
            foreign_ids,
            self.workspace_source.as_ref(),
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(ImportEntity::try_from).collect()
    }

    #[tracing::instrument(skip(self, shared, personal), fields(shared = shared.len(), personal = personal.len()), err)]
    async fn set_plan_sharing(
        &self,
        user: &MacroUserIdStr<'static>,
        shared: &[Uuid],
        personal: &[Uuid],
    ) -> Result<u64> {
        if shared.is_empty() && personal.is_empty() {
            return Ok(0);
        }
        let result = sqlx::query!(
            r#"
            UPDATE import_entity
            SET metadata = jsonb_set(metadata, '{plan,shared}', to_jsonb(id = ANY($2::uuid[]))),
                updated_at = NOW()
            WHERE user_id = $1 AND status = 'staged' AND metadata->'plan' IS NOT NULL
              AND (id = ANY($2::uuid[]) OR id = ANY($3::uuid[]))
            "#,
            user.as_ref(),
            shared,
            personal,
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected())
    }

    #[tracing::instrument(skip(self, ids, shared), fields(rows = ids.len(), shared = shared.len()), err)]
    async fn claim_importing(
        &self,
        user: &MacroUserIdStr<'static>,
        ids: &[Uuid],
        shared: &[Uuid],
        team_id: Option<Uuid>,
    ) -> Result<Vec<ImportEntity>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let mut attempt = 1;
        let rows = loop {
            let claimed = sqlx::query_as!(
                ImportEntityDbRow,
                r#"
                UPDATE import_entity AS mine
                SET status = 'importing', last_error = NULL, waiting_on = NULL, updated_at = NOW(),
                    team_id = CASE
                        WHEN $4::uuid IS NOT NULL AND mine.id = ANY($3::uuid[]) AND NOT EXISTS (
                            SELECT 1 FROM import_entity AS other
                            WHERE other.source = mine.source AND other.team_id = $4
                              AND other.foreign_id = mine.foreign_id
                              AND other.status IN ('importing', 'imported')
                              AND other.id <> mine.id
                        ) THEN $4
                        ELSE NULL
                    END
                WHERE mine.user_id = $1 AND mine.id = ANY($2::uuid[]) AND mine.status = 'staged'
                RETURNING mine.id, mine.user_id, mine.team_id, mine.source, mine.kind,
                          mine.foreign_id, mine.parent_id, mine.review_id, mine.status,
                          mine.initiator, mine.metadata, mine.entity_id, mine.entity_type,
                          mine.last_error, mine.waiting_on, mine.created_at, mine.updated_at
                "#,
                user.as_ref(),
                ids,
                shared,
                team_id,
            )
            .fetch_all(&self.pool)
            .await;
            match claimed {
                Ok(rows) => break rows,
                Err(error) if is_unique_violation(&error) && attempt < CLAIM_ATTEMPTS => {
                    tracing::info!(
                        attempt,
                        "a teammate claimed the same notion object; claiming again"
                    );
                    attempt += 1;
                }
                Err(error) => return Err(error.into()),
            }
        };
        rows.into_iter().map(ImportEntity::try_from).collect()
    }

    #[tracing::instrument(skip(self), err)]
    async fn claim_team_object(
        &self,
        user: &MacroUserIdStr<'static>,
        import_id: Uuid,
        team_id: Uuid,
        claim: bool,
    ) -> Result<TeamClaim> {
        let mut attempt = 1;
        loop {
            match self
                .try_claim_team_object(user, import_id, team_id, claim)
                .await
            {
                Ok(outcome) => return Ok(outcome),
                Err(error) if is_unique_violation(&error) && attempt < CLAIM_ATTEMPTS => {
                    tracing::info!(
                        attempt,
                        "a teammate claimed the same notion object; checking again"
                    );
                    attempt += 1;
                }
                Err(error) => return Err(error.into()),
            }
        }
    }

    #[tracing::instrument(skip(self), err)]
    async fn wait_on(
        &self,
        user: &MacroUserIdStr<'static>,
        import_id: Uuid,
        holder: Uuid,
    ) -> Result<bool> {
        let mut transaction = self.pool.begin().await?;
        // Holding the holder's row keeps it from being imported or released
        // until this row is waiting, so whichever comes second sees the other.
        let writing = sqlx::query_scalar!(
            r#"
            SELECT id FROM import_entity
            WHERE id = $1 AND status = 'importing' AND team_id IS NOT NULL
            FOR SHARE
            "#,
            holder,
        )
        .fetch_optional(&mut *transaction)
        .await?;
        if writing.is_none() {
            return Ok(false);
        }
        let result = sqlx::query!(
            r#"
            UPDATE import_entity SET waiting_on = $3, updated_at = NOW()
            WHERE user_id = $1 AND id = $2 AND status = 'importing'
            "#,
            user.as_ref(),
            import_id,
            holder,
        )
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(result.rows_affected() > 0)
    }
}

impl PgImportRepo {
    /// One attempt at [`NotionPlanRepo::claim_team_object`], in one
    /// transaction holding the row and the team's current holder.
    async fn try_claim_team_object(
        &self,
        user: &MacroUserIdStr<'static>,
        import_id: Uuid,
        team_id: Uuid,
        claim: bool,
    ) -> sqlx::Result<TeamClaim> {
        let mut transaction = self.pool.begin().await?;
        let Some(own) = sqlx::query!(
            r#"
            SELECT foreign_id, team_id FROM import_entity
            WHERE user_id = $1 AND id = $2 AND status = 'importing'
            FOR UPDATE
            "#,
            user.as_ref(),
            import_id,
        )
        .fetch_optional(&mut *transaction)
        .await?
        else {
            // Not being written any more (cancelled, settled): nothing to claim.
            return Ok(TeamClaim::Free);
        };
        if own.team_id == Some(team_id) {
            return Ok(TeamClaim::Held);
        }
        let holder = sqlx::query!(
            r#"
            SELECT holder.id, holder.status, holder.entity_id, holder.entity_type,
                   EXISTS (
                       SELECT 1 FROM import_run AS run
                       WHERE run.user_id = holder.user_id AND run.source = $4
                         AND run.status = 'importing' AND run.lease_expires_at > NOW()
                   ) AS "live!"
            FROM import_entity AS holder
            WHERE holder.source = $4 AND holder.team_id = $2 AND holder.foreign_id = $3
              AND holder.status IN ('importing', 'imported') AND holder.user_id <> $1
            FOR UPDATE OF holder
            "#,
            user.as_ref(),
            team_id,
            own.foreign_id,
            self.workspace_source.as_ref(),
        )
        .fetch_optional(&mut *transaction)
        .await?;
        let outcome = match holder {
            Some(holder) if holder.status == "imported" => TeamClaim::Linked {
                entity_id: holder.entity_id.unwrap_or_default(),
                entity_type: holder.entity_type.unwrap_or_default(),
            },
            Some(holder) if holder.live => TeamClaim::Waiting { holder: holder.id },
            // The holder's import stopped: take its claim over, and its
            // waiters with it.
            Some(holder) if claim => {
                sqlx::query!(
                    "UPDATE import_entity SET team_id = NULL, updated_at = NOW() WHERE id = $1",
                    holder.id,
                )
                .execute(&mut *transaction)
                .await?;
                sqlx::query!(
                    r#"
                    UPDATE import_entity SET waiting_on = $2, updated_at = NOW()
                    WHERE waiting_on = $1 AND status = 'importing'
                    "#,
                    holder.id,
                    import_id,
                )
                .execute(&mut *transaction)
                .await?;
                claim_own(&mut transaction, import_id, team_id).await?;
                TeamClaim::Held
            }
            None if claim => {
                claim_own(&mut transaction, import_id, team_id).await?;
                TeamClaim::Held
            }
            Some(_) | None => TeamClaim::Free,
        };
        transaction.commit().await?;
        Ok(outcome)
    }
}

async fn claim_own(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    import_id: Uuid,
    team_id: Uuid,
) -> sqlx::Result<()> {
    sqlx::query!(
        "UPDATE import_entity SET team_id = $2, updated_at = NOW() WHERE id = $1",
        import_id,
        team_id,
    )
    .execute(&mut **transaction)
    .await?;
    Ok(())
}
