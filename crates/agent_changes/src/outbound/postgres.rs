//! The summary row in Postgres: `agent_session_changes`, one per session.

use agent_session::domain::model::AgentSessionId;
use chrono::{DateTime, Utc};
use macro_uuid::Uuid;
use sqlx::PgPool;

use crate::domain::model::{
    AttemptOutcome, CaptureAttempt, ChangedFile, Changeset, ChangesetId, ChangesetRange,
    ChangesetSource, GitRef, SessionChanges,
};
use crate::domain::ports::{ChangesetRepo, PatchBlobKey};

#[cfg(test)]
mod test;

/// Postgres-backed [`ChangesetRepo`].
#[derive(Clone)]
pub struct PgChangesetRepo {
    pool: PgPool,
}

impl PgChangesetRepo {
    /// Read and write summaries through `pool`.
    #[must_use]
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// The row as stored. Kept apart from the domain types so a column rename
/// touches one mapping.
struct ChangesRow {
    changeset_id: Option<Uuid>,
    source: Option<String>,
    repository: Option<String>,
    base_ref: Option<String>,
    base_sha: Option<String>,
    head_ref: Option<String>,
    head_sha: Option<String>,
    files: serde_json::Value,
    additions: i32,
    deletions: i32,
    patch_bytes: i64,
    truncated: bool,
    captured_at: Option<DateTime<Utc>>,
    attempt_started_at: DateTime<Utc>,
    attempt_finished_at: Option<DateTime<Utc>>,
    attempt_outcome: Option<String>,
    attempt_error: Option<String>,
}

impl ChangesRow {
    fn into_changes(self, session: AgentSessionId) -> Result<SessionChanges, rootcause::Report> {
        let attempt = Some(CaptureAttempt {
            started_at: self.attempt_started_at,
            finished_at: self.attempt_finished_at,
            outcome: self
                .attempt_outcome
                .as_deref()
                .map(str::parse::<AttemptOutcome>)
                .transpose()
                .map_err(|error| rootcause::report!("stored attempt outcome: {error}"))?,
            error: self.attempt_error,
        });
        let changeset = match (self.changeset_id, self.source, self.captured_at) {
            (Some(id), Some(source), Some(captured_at)) => {
                let files: Vec<ChangedFile> = serde_json::from_value(self.files)
                    .map_err(|error| rootcause::report!("stored changed files: {error}"))?;
                Some(Changeset {
                    id: ChangesetId::from_uuid(id),
                    session,
                    source: source
                        .parse::<ChangesetSource>()
                        .map_err(|error| rootcause::report!("stored changeset source: {error}"))?,
                    range: ChangesetRange {
                        repository: self.repository,
                        base: GitRef {
                            name: self.base_ref,
                            sha: self.base_sha,
                        },
                        head: GitRef {
                            name: self.head_ref,
                            sha: self.head_sha,
                        },
                    },
                    files,
                    additions: u32::try_from(self.additions).unwrap_or(u32::MAX),
                    deletions: u32::try_from(self.deletions).unwrap_or(u32::MAX),
                    patch_bytes: u64::try_from(self.patch_bytes).unwrap_or(0),
                    truncated: self.truncated,
                    captured_at,
                })
            }
            _ => None,
        };
        Ok(SessionChanges { changeset, attempt })
    }
}

impl ChangesetRepo for PgChangesetRepo {
    #[tracing::instrument(skip(self), err, fields(agent.session.id = %session))]
    async fn begin_attempt(
        &self,
        session: AgentSessionId,
        started_at: DateTime<Utc>,
    ) -> Result<(), rootcause::Report> {
        sqlx::query!(
            r#"
            INSERT INTO agent_session_changes (agent_session_id, attempt_started_at)
            VALUES ($1, $2)
            ON CONFLICT (agent_session_id) DO UPDATE SET
                attempt_started_at = EXCLUDED.attempt_started_at,
                attempt_finished_at = NULL,
                attempt_outcome = NULL,
                attempt_error = NULL,
                updated_at = now()
            "#,
            session.as_uuid(),
            started_at,
        )
        .execute(&self.pool)
        .await
        .map_err(|error| rootcause::report!(error))?;
        Ok(())
    }

    #[tracing::instrument(
        skip(self, changeset, patch_key),
        err,
        fields(agent.session.id = %changeset.session, changeset.id = %changeset.id)
    )]
    async fn record_changeset(
        &self,
        changeset: &Changeset,
        patch_key: Option<&PatchBlobKey>,
        finished_at: DateTime<Utc>,
    ) -> Result<Option<PatchBlobKey>, rootcause::Report> {
        let files = serde_json::to_value(&changeset.files)
            .map_err(|error| rootcause::report!("serialize changed files: {error}"))?;
        // The CTE reads the row as it was before this statement, which is
        // what makes "the key this capture superseded" one round trip.
        let superseded = sqlx::query_scalar!(
            r#"
            WITH previous AS (
                SELECT patch_blob_key FROM agent_session_changes WHERE agent_session_id = $1
            )
            INSERT INTO agent_session_changes (
                agent_session_id, changeset_id, source, repository,
                base_ref, base_sha, head_ref, head_sha,
                files, additions, deletions, patch_blob_key, patch_bytes, truncated,
                captured_at, attempt_started_at, attempt_finished_at, attempt_outcome, attempt_error
            )
            VALUES (
                $1, $2, $3, $4,
                $5, $6, $7, $8,
                $9, $10, $11, $12, $13, $14,
                $15, $16, $16, 'captured', NULL
            )
            ON CONFLICT (agent_session_id) DO UPDATE SET
                changeset_id = EXCLUDED.changeset_id,
                source = EXCLUDED.source,
                repository = EXCLUDED.repository,
                base_ref = EXCLUDED.base_ref,
                base_sha = EXCLUDED.base_sha,
                head_ref = EXCLUDED.head_ref,
                head_sha = EXCLUDED.head_sha,
                files = EXCLUDED.files,
                additions = EXCLUDED.additions,
                deletions = EXCLUDED.deletions,
                patch_blob_key = EXCLUDED.patch_blob_key,
                patch_bytes = EXCLUDED.patch_bytes,
                truncated = EXCLUDED.truncated,
                captured_at = EXCLUDED.captured_at,
                attempt_finished_at = EXCLUDED.attempt_finished_at,
                attempt_outcome = 'captured',
                attempt_error = NULL,
                updated_at = now()
            RETURNING (SELECT patch_blob_key FROM previous) AS "superseded?"
            "#,
            changeset.session.as_uuid(),
            changeset.id.as_uuid(),
            changeset.source.to_string(),
            changeset.range.repository.as_deref(),
            changeset.range.base.name.as_deref(),
            changeset.range.base.sha.as_deref(),
            changeset.range.head.name.as_deref(),
            changeset.range.head.sha.as_deref(),
            files,
            i32::try_from(changeset.additions).unwrap_or(i32::MAX),
            i32::try_from(changeset.deletions).unwrap_or(i32::MAX),
            patch_key.map(PatchBlobKey::as_str),
            i64::try_from(changeset.patch_bytes).unwrap_or(i64::MAX),
            changeset.truncated,
            changeset.captured_at,
            finished_at,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(|error| rootcause::report!(error))?;
        Ok(superseded.map(PatchBlobKey::from_stored))
    }

    #[tracing::instrument(skip(self, error), err, fields(agent.session.id = %session, %outcome))]
    async fn record_failure(
        &self,
        session: AgentSessionId,
        outcome: AttemptOutcome,
        error: Option<&str>,
        finished_at: DateTime<Utc>,
    ) -> Result<(), rootcause::Report> {
        sqlx::query!(
            r#"
            INSERT INTO agent_session_changes (
                agent_session_id, attempt_started_at, attempt_finished_at, attempt_outcome, attempt_error
            )
            VALUES ($1, $4, $4, $2, $3)
            ON CONFLICT (agent_session_id) DO UPDATE SET
                attempt_finished_at = EXCLUDED.attempt_finished_at,
                attempt_outcome = EXCLUDED.attempt_outcome,
                attempt_error = EXCLUDED.attempt_error,
                updated_at = now()
            "#,
            session.as_uuid(),
            outcome.to_string(),
            error,
            finished_at,
        )
        .execute(&self.pool)
        .await
        .map_err(|error| rootcause::report!(error))?;
        Ok(())
    }

    #[tracing::instrument(skip(self), err, fields(agent.session.id = %session))]
    async fn get(&self, session: AgentSessionId) -> Result<SessionChanges, rootcause::Report> {
        let row = sqlx::query_as!(
            ChangesRow,
            r#"
            SELECT changeset_id, source, repository, base_ref, base_sha, head_ref, head_sha,
                   files, additions, deletions, patch_bytes, truncated, captured_at,
                   attempt_started_at, attempt_finished_at, attempt_outcome, attempt_error
            FROM agent_session_changes
            WHERE agent_session_id = $1
            "#,
            session.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| rootcause::report!(error))?;
        match row {
            Some(row) => row.into_changes(session),
            None => Ok(SessionChanges::default()),
        }
    }

    #[tracing::instrument(skip(self), err, fields(agent.session.id = %session))]
    async fn patch_key(
        &self,
        session: AgentSessionId,
    ) -> Result<Option<PatchBlobKey>, rootcause::Report> {
        let key = sqlx::query_scalar!(
            r#"SELECT patch_blob_key FROM agent_session_changes WHERE agent_session_id = $1"#,
            session.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| rootcause::report!(error))?;
        Ok(key.flatten().map(PatchBlobKey::from_stored))
    }
}
