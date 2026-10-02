//! PostgreSQL job and manifest persistence. Mutations lock the team-owned job
//! before touching conversations, uploads or outbox rows. Lifecycle operations
//! must use this same lock order.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::de::DeserializeOwned;
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

use crate::domain::{models::*, ports::PortResult};

/// Transaction-scoped import mappings, checkpoints and dirty-search persistence.
pub mod batches;
mod lifecycle;
/// Job-scoped body-reference templates and atomic reconciliation checkpoints.
pub mod references;
mod uploads;

/// Durable Slack archive repository. Administrator/target authorization remains
/// in the domain service; every repository lookup additionally checks team ownership.
#[derive(Clone)]
pub struct PgSlackImportRepo {
    pool: PgPool,
    limits: ImportLimits,
}

impl PgSlackImportRepo {
    /// Use the composition root's effective server limits for validation and receipts.
    pub fn new(pool: PgPool, limits: ImportLimits) -> Self {
        Self { pool, limits }
    }

    /// Atomically bind the source and persist the complete semantic create payload.
    /// Reordered conversations/members are equivalent; changed metadata conflicts.
    pub async fn create(
        &self,
        team: TeamId,
        admin: &MacroUserIdStr<'_>,
        command: &CreateImport,
        limits: &ImportLimits,
    ) -> PortResult<ImportProgress> {
        if limits != &self.limits {
            return Err(ImportError::InvalidInput.into());
        }
        let canonical = canonical_create(command, limits)?;
        let hash = format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&canonical).map_err(internal)?)
        );
        let mut tx = self.pool.begin().await.map_err(internal)?;
        let id = Uuid::now_v7();
        let source = match &command.source {
            SourceIdentity::Known { source_id } => Some(source_id.as_str()),
            SourceIdentity::ConfirmedUnknown => None,
        };
        // The unique scoped token serializes concurrent creates, including a lost
        // response retry. DO NOTHING never rewrites historical request metadata.
        let inserted = sqlx::query_scalar!(
            r#"INSERT INTO slack_import_job
                (id, team_id, user_id, idempotency_token, request_sha256,
                 source_workspace_id, confirmed_unknown, include_message_history)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT (team_id, user_id, idempotency_token) DO NOTHING
               RETURNING id"#,
            id,
            Uuid::from(team),
            admin.as_ref(),
            Uuid::from(command.idempotency_token),
            hash,
            source,
            source.is_none(),
            command.include_message_history,
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(internal)?;
        let job = match inserted {
            Some(id) => {
                // This owning-crate transaction API is shared with onboarding;
                // source provenance and the job must roll back together.
                let workspace = source.and_then(import::domain::models::SlackWorkspaceId::new);
                import::source_binding::bind_source(
                    &mut *tx,
                    team.into(),
                    workspace.as_ref(),
                    source.is_none(),
                )
                .await
                .map_err(|error| {
                    let code = match error {
                        import::domain::ports::ImportError::SourceMismatch => {
                            ImportError::SourceMismatch
                        }
                        _ => ImportError::Internal,
                    };
                    rootcause::Report::new(error).context(code)
                })?;
                let metadata = serde_json::Value::Array(canonical.conversations.iter().map(|conversation| {
                    serde_json::json!({
                        "slack_channel_id": conversation.slack_channel_id,
                        "kind": conversation.kind,
                        "name": conversation.name,
                        "folder": conversation.folder,
                        "member_ids": conversation.member_ids,
                        "creator_id": conversation.creator_id,
                        "source_created_at": conversation.created_at.map(SlackTimestamp::unix_micros),
                        "archived": conversation.archived,
                        "message_count": conversation.message_count,
                    })
                }).collect());
                sqlx::query!(
                    r#"INSERT INTO slack_import_conversation
                        (job_id, slack_channel_id, kind, name, folder, member_ids,
                         creator_id, source_created_at, archived, message_count)
                       SELECT j.id, m.slack_channel_id, m.kind, m.name, m.folder, m.member_ids,
                              m.creator_id, m.source_created_at, m.archived, m.message_count
                       FROM slack_import_job j CROSS JOIN jsonb_to_recordset($3) AS m(
                           slack_channel_id text, kind text, name text, folder text,
                           member_ids text[], creator_id text, source_created_at bigint,
                           archived boolean, message_count bigint)
                       WHERE j.team_id = $1 AND j.id = $2
                       ON CONFLICT (job_id, slack_channel_id) DO NOTHING"#,
                    Uuid::from(team),
                    id,
                    metadata,
                )
                .execute(&mut *tx)
                .await
                .map_err(internal)?;
                id
            }
            None => {
                let existing = sqlx::query!(
                    r#"SELECT id, request_sha256 FROM slack_import_job
                       WHERE team_id = $1 AND user_id = $2 AND idempotency_token = $3
                       FOR UPDATE"#,
                    Uuid::from(team),
                    admin.as_ref(),
                    Uuid::from(command.idempotency_token),
                )
                .fetch_one(&mut *tx)
                .await
                .map_err(internal)?;
                if existing.request_sha256 != hash {
                    return Err(ImportError::Conflict.into());
                }
                existing.id
            }
        };
        let progress = self
            .receipt(&mut tx, team, job.try_into().map_err(internal)?)
            .await?;
        tx.commit().await.map_err(internal)?;
        Ok(progress)
    }

    /// Return a consistent team-owned receipt or None for an inaccessible job.
    pub async fn progress(&self, team: TeamId, job: JobId) -> PortResult<Option<ImportProgress>> {
        let mut tx = self.pool.begin().await.map_err(internal)?;
        let progress = self.receipts(&mut tx, team, Some(job), None).await?.pop();
        tx.commit().await.map_err(internal)?;
        Ok(progress)
    }

    /// Return at most 50 receipts in descending UUIDv7 order, exclusively before the cursor.
    pub async fn list(
        &self,
        team: TeamId,
        before: Option<JobId>,
    ) -> PortResult<Vec<ImportProgress>> {
        let mut tx = self.pool.begin().await.map_err(internal)?;
        let progress = self.receipts(&mut tx, team, None, before).await?;
        tx.commit().await.map_err(internal)?;
        Ok(progress)
    }

    async fn receipt(
        &self,
        connection: &mut PgConnection,
        team: TeamId,
        job: JobId,
    ) -> PortResult<ImportProgress> {
        self.receipts(connection, team, Some(job), None)
            .await?
            .pop()
            .ok_or_else(|| ImportError::Unavailable.into())
    }

    async fn receipts(
        &self,
        connection: &mut PgConnection,
        team: TeamId,
        job: Option<JobId>,
        before: Option<JobId>,
    ) -> PortResult<Vec<ImportProgress>> {
        // Lock jobs before reading any child rows. At READ COMMITTED a locking
        // SELECT can see a newer job after waiting; child subqueries in that same
        // statement would still use its older snapshot. Hydrate in bounded batches
        // only after acquiring the locks, never once per receipt.
        let rows = sqlx::query!(
            r#"SELECT j.id, j.status, j.revision, j.created_at, j.updated_at,
                      j.registration_closed_at, j.source_workspace_id, j.include_message_history
               FROM slack_import_job j
               WHERE j.team_id = $1 AND ($2::uuid IS NULL OR j.id = $2)
                 AND ($3::uuid IS NULL OR j.id < $3)
               ORDER BY j.id DESC LIMIT 50 FOR SHARE OF j"#,
            Uuid::from(team),
            job.map(Uuid::from),
            before.map(Uuid::from),
        )
        .fetch_all(&mut *connection)
        .await
        .map_err(internal)?;
        let ids: Vec<Uuid> = rows.iter().map(|row| row.id).collect();
        let users_verified: HashSet<Uuid> = sqlx::query_scalar!(
            r#"SELECT u.job_id FROM slack_import_upload u
               JOIN slack_import_job j ON j.id = u.job_id
               WHERE j.team_id = $1 AND j.id = ANY($2)
                 AND u.slack_channel_id IS NULL AND u.verified_at IS NOT NULL"#,
            Uuid::from(team),
            &ids,
        )
        .fetch_all(&mut *connection)
        .await
        .map_err(internal)?
        .into_iter()
        .collect();
        let conversations = sqlx::query!(
            r#"SELECT c.job_id, c.slack_channel_id, c.name, c.kind, c.archived, c.status, c.channel_id, c.part_count,
                      c.processed, c.imported, c.duplicates, c.skipped, c.reactions,
                      c.search_state, c.search_receipt_id, c.last_error, c.warnings,
                      (SELECT count(*) FROM slack_import_upload u
                       WHERE u.job_id = c.job_id AND u.slack_channel_id = c.slack_channel_id
                         AND u.verified_at IS NOT NULL) AS "verified_parts!"
               FROM slack_import_conversation c JOIN slack_import_job j ON j.id = c.job_id
               WHERE j.team_id = $1 AND j.id = ANY($2)
               ORDER BY c.job_id DESC, c.slack_channel_id"#,
            Uuid::from(team),
            &ids,
        )
        .fetch_all(&mut *connection)
        .await
        .map_err(internal)?;
        let mut by_job: HashMap<Uuid, Vec<ConversationProgress>> = HashMap::new();
        for row in conversations {
            let search = match row.search_state.as_str() {
                "not_needed" => SearchState::NotNeeded,
                "pending" => SearchState::Pending,
                "submitted" => SearchState::Submitted {
                    receipt_id: row.search_receipt_id.ok_or(ImportError::Internal)?,
                },
                "completed" => SearchState::Completed,
                "failed" => SearchState::Failed,
                _ => return Err(ImportError::Internal.into()),
            };
            let warnings = row
                .warnings
                .iter()
                .map(|v| parse_enum(v))
                .collect::<PortResult<Vec<ImportWarning>>>()?;
            let channel_id = if warnings.contains(&ImportWarning::TargetUnavailable) {
                None
            } else {
                row.channel_id
            };
            by_job
                .entry(row.job_id)
                .or_default()
                .push(ConversationProgress {
                    slack_channel_id: row.slack_channel_id.parse().map_err(internal)?,
                    name: row.name,
                    kind: parse_enum(&row.kind)?,
                    archived: row.archived,
                    status: parse_enum(&row.status)?,
                    channel_id,
                    part_count: row.part_count.map(|n| n as u32),
                    verified_parts: row.verified_parts.try_into().map_err(internal)?,
                    counters: ImportCounters {
                        processed: row.processed as u64,
                        imported: row.imported as u64,
                        duplicates: row.duplicates as u64,
                        skipped: row.skipped as u64,
                        reactions: row.reactions as u64,
                    },
                    search,
                    error: row.last_error.as_deref().map(parse_enum).transpose()?,
                    warnings,
                });
        }
        rows.into_iter()
            .map(|row| {
                Ok(ImportProgress {
                    source: match row.source_workspace_id {
                        Some(source) => SourceIdentity::Known {
                            source_id: source.parse().map_err(internal)?,
                        },
                        None => SourceIdentity::ConfirmedUnknown,
                    },
                    include_message_history: row.include_message_history,
                    job_id: row.id.try_into().map_err(internal)?,
                    status: parse_enum(&row.status)?,
                    revision: row.revision as u64,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                    registration_closed_at: row.registration_closed_at,
                    users_verified: users_verified.contains(&row.id),
                    limits: self.limits,
                    conversations: by_job.remove(&row.id).unwrap_or_default(),
                })
            })
            .collect()
    }
}

struct LockedJob {
    status: String,
    registration_closed_at: Option<DateTime<Utc>>,
    include_message_history: bool,
    registered_bytes: i64,
    expired: bool,
}

impl LockedJob {
    fn require_open(&self) -> PortResult<()> {
        if self.status != "uploading" || self.registration_closed_at.is_some() || self.expired {
            return Err(ImportError::Conflict.into());
        }
        Ok(())
    }
}

async fn lock_job(
    connection: &mut PgConnection,
    team: TeamId,
    job: JobId,
) -> PortResult<LockedJob> {
    sqlx::query_as!(
        LockedJob,
        r#"SELECT status, registration_closed_at, include_message_history, registered_bytes,
                  (staging_expires_at <= clock_timestamp()) AS "expired!"
           FROM slack_import_job WHERE team_id = $1 AND id = $2 FOR UPDATE"#,
        Uuid::from(team),
        Uuid::from(job),
    )
    .fetch_optional(connection)
    .await
    .map_err(internal)?
    .ok_or_else(|| ImportError::Unavailable.into())
}

async fn bump_revision(connection: &mut PgConnection, team: TeamId, job: JobId) -> PortResult<()> {
    sqlx::query!(
        "UPDATE slack_import_job SET revision = revision + 1, updated_at = clock_timestamp() WHERE team_id = $1 AND id = $2",
        Uuid::from(team), Uuid::from(job),
    ).execute(connection).await.map_err(internal)?;
    Ok(())
}

fn canonical_create(command: &CreateImport, limits: &ImportLimits) -> PortResult<CreateImport> {
    if command.conversations.len() > limits.conversations as usize {
        return Err(ImportError::LimitExceeded.into());
    }
    let mut canonical = command.clone();
    let mut ids = HashSet::new();
    for conversation in &mut canonical.conversations {
        if !ids.insert(conversation.slack_channel_id.clone()) {
            return Err(ImportError::InvalidInput.into());
        }
        if conversation
            .message_count
            .is_some_and(|n| n > i64::MAX as u64)
        {
            return Err(ImportError::LimitExceeded.into());
        }
        conversation.member_ids.sort_unstable();
        conversation.member_ids.dedup();
    }
    canonical
        .conversations
        .sort_unstable_by(|a, b| a.slack_channel_id.cmp(&b.slack_channel_id));
    if serde_json::to_vec(&canonical).map_err(internal)?.len() as u64 > limits.json_bytes {
        return Err(ImportError::LimitExceeded.into());
    }
    Ok(canonical)
}

fn parse_enum<T: DeserializeOwned>(value: &str) -> PortResult<T> {
    serde_json::from_value(serde_json::Value::String(value.to_owned())).map_err(internal)
}

fn internal(
    error: impl std::error::Error + Send + Sync + 'static,
) -> rootcause::Report<ImportError> {
    rootcause::Report::new(error).context(ImportError::Internal)
}
