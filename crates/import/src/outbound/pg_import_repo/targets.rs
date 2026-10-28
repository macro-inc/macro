//! Short-lived transactions for canonical Slack provenance. Never hold a
//! connection while the caller creates a channel or imports history.

use super::PgImportRepo;
use crate::domain::models::{
    ImportSourceBinding, ImportTargetKey, ImportTargetKind, ImportTargetReservation,
    SlackWorkspaceId,
};
use crate::domain::ports::{CanonicalImportRepo, ImportError, Result};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

struct BindingRow {
    slack_workspace_id: Option<String>,
    confirmed_unknown_at: Option<DateTime<Utc>>,
}

impl TryFrom<BindingRow> for ImportSourceBinding {
    type Error = ImportError;

    fn try_from(row: BindingRow) -> Result<Self> {
        let workspace_id = row
            .slack_workspace_id
            .map(|id| SlackWorkspaceId::new(&id).ok_or(ImportError::SourceMismatch))
            .transpose()?;
        Ok(Self {
            workspace_id,
            confirmed_unknown_at: row.confirmed_unknown_at,
        })
    }
}

impl crate::domain::ports::ImportTargetReader for PgImportRepo {
    async fn lookup_targets(
        &self,
        team: Uuid,
        binding: &ImportSourceBinding,
        channels: &[crate::domain::models::SlackConversationId],
    ) -> Result<Vec<crate::domain::models::ImportTargetLookup>> {
        use crate::domain::models::ImportTargetLookup;
        if channels.len() > crate::domain::models::MAX_TARGET_LOOKUP {
            return Err(ImportError::TargetConflict);
        }
        let ids: Vec<_> = channels.iter().map(|id| id.as_str()).collect();
        let workspace = binding.workspace_id.as_ref().map(SlackWorkspaceId::as_str);
        let rows = sqlx::query!(
            r#"SELECT s.ordinality AS "position!", r.state AS "state?", c.id AS "id?", c.name AS "name?",
                      c.channel_type::text AS "kind?"
               FROM unnest($1::text[]) WITH ORDINALITY AS s(id, ordinality)
               JOIN import_source_binding b ON b.team_id = $2
                 AND b.slack_workspace_id IS NOT DISTINCT FROM $3
                 AND b.confirmed_unknown_at IS NOT DISTINCT FROM $4
               LEFT JOIN import_target_reservation r
                 ON r.team_id = $2 AND r.source = 'slack' AND r.foreign_id = s.id
               LEFT JOIN LATERAL (
                 SELECT count(*) AS count, min(entity_id) AS id,
                        bool_and(entity_type = 'channel' AND entity_id IS NOT NULL) AS valid
                 FROM (SELECT DISTINCT entity_id, entity_type FROM import_entity
                       WHERE team_id = $2 AND source = 'slack' AND foreign_id = s.id
                         AND status = 'imported' LIMIT 2) mappings
               ) legacy ON true
               LEFT JOIN comms_channels c ON c.id =
                 CASE WHEN r.state = 'ready' AND r.channel_id = r.candidate_channel_id
                           AND (legacy.count = 0 OR (legacy.count = 1 AND legacy.valid
                                AND legacy.id = r.channel_id::text)) THEN r.channel_id
                      WHEN r.state IS NULL AND legacy.count = 1 AND legacy.valid
                           AND legacy.id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                      THEN legacy.id::uuid END
                 AND ((c.channel_type = 'team' AND c.team_id = $2)
                      OR (r.state = 'ready' AND c.channel_type IN ('private', 'direct_message')
                          AND c.team_id IS NULL))
                 AND NOT EXISTS (SELECT 1 FROM import_target_reservation other
                                 WHERE other.channel_id = c.id AND other.team_id <> $2)
                 AND NOT EXISTS (SELECT 1 FROM import_entity other
                                 WHERE other.source = 'slack' AND other.status = 'imported'
                                   AND other.entity_type = 'channel' AND other.entity_id = c.id::text
                                   AND other.team_id <> $2)
               ORDER BY s.ordinality"#,
            &ids as _, team, workspace, binding.confirmed_unknown_at,
        ).fetch_all(&self.pool).await?;
        let mut result = vec![ImportTargetLookup::Missing; channels.len()];
        for row in rows {
            let outcome = match (row.state.as_deref(), row.id, row.kind.as_deref()) {
                (Some("pending"), _, _) => ImportTargetLookup::Pending,
                (_, Some(channel_id), Some(kind)) => {
                    let kind = match kind {
                        "team" => ImportTargetKind::Team,
                        "private" => ImportTargetKind::Private,
                        "direct_message" => ImportTargetKind::DirectMessage,
                        _ => continue,
                    };
                    ImportTargetLookup::Ready {
                        channel_id,
                        kind,
                        name: row.name.unwrap_or_default(),
                    }
                }
                _ => ImportTargetLookup::Missing,
            };
            result[(row.position - 1) as usize] = outcome;
        }
        Ok(result)
    }
}

struct ReservationRow {
    candidate_channel_id: Uuid,
    state: String,
}

impl CanonicalImportRepo for PgImportRepo {
    async fn source_binding(&self, team_id: Uuid) -> Result<Option<ImportSourceBinding>> {
        sqlx::query_as!(
            BindingRow,
            "SELECT slack_workspace_id, confirmed_unknown_at FROM import_source_binding WHERE team_id = $1",
            team_id,
        )
        .fetch_optional(&self.pool)
        .await?
        .map(ImportSourceBinding::try_from)
        .transpose()
    }

    async fn bind_source(
        &self,
        team_id: Uuid,
        workspace_id: Option<&SlackWorkspaceId>,
        confirmed_unknown: bool,
    ) -> Result<ImportSourceBinding> {
        crate::source_binding::bind_source(&self.pool, team_id, workspace_id, confirmed_unknown)
            .await
    }

    async fn reserve_target(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ImportTargetKey,
        kind: ImportTargetKind,
        existing_channel_id: Option<Uuid>,
    ) -> Result<ImportTargetReservation> {
        let mut tx = self.pool.begin().await?;
        lock_key(&mut tx, key).await?;
        let reserved = reservation(&mut tx, key).await?;
        if reserved.as_ref().is_some_and(|row| row.state == "conflict") {
            return Err(ImportError::TargetConflict);
        }

        // DISTINCT + LIMIT bounds results while still detecting ambiguity. The
        // two branches use the ledger's own-row unique key and team lookup index.
        // Never infer the historical team from current team_user membership.
        let mappings = sqlx::query!(
            r#"
            SELECT DISTINCT entity_id, entity_type,
                   (team_id IS NULL OR team_id = $3) AS "compatible!"
            FROM import_entity
            WHERE source = 'slack' AND foreign_id = $1 AND status = 'imported'
              AND (user_id = $2 OR team_id = $3)
            LIMIT 2
            "#,
            key.foreign_id.as_str(),
            user.as_ref(),
            key.team_id,
        )
        .fetch_all(&mut *tx)
        .await?;
        let mut candidate = existing_channel_id;
        for mapping in mappings {
            if mapping.entity_type.as_deref() != Some("channel") || !mapping.compatible {
                return Err(ImportError::TargetConflict);
            }
            let id = mapping
                .entity_id
                .as_deref()
                .and_then(|id| Uuid::parse_str(id).ok())
                .ok_or(ImportError::TargetConflict)?;
            if candidate.is_some_and(|candidate| candidate != id) {
                return Err(ImportError::TargetConflict);
            }
            candidate = Some(id);
        }

        let (channel_id, ready) = match reserved {
            Some(row) => {
                if candidate.is_some_and(|id| id != row.candidate_channel_id) {
                    return Err(ImportError::TargetConflict);
                }
                let ready = row.state == "ready";
                if ready || candidate.is_some() {
                    validate_channel(&mut tx, key, row.candidate_channel_id, kind).await?;
                }
                (row.candidate_channel_id, ready)
            }
            None => {
                if let Some(id) = candidate {
                    // A legacy private mapping is not an access grant. Only an
                    // explicitly authorized claim may establish its provenance.
                    if kind != ImportTargetKind::Team && existing_channel_id != Some(id) {
                        return Err(ImportError::TargetConflict);
                    }
                    validate_channel(&mut tx, key, id, kind).await?;
                }
                let channel_id = candidate.unwrap_or_else(Uuid::now_v7);
                let ready = candidate.is_some();
                let inserted = sqlx::query_scalar!(
                    r#"
                    INSERT INTO import_target_reservation
                        (team_id, source, foreign_id, candidate_channel_id, channel_id, state)
                    VALUES ($1, 'slack', $2, $3, $4, $5)
                    ON CONFLICT (team_id, source, foreign_id) DO NOTHING
                    RETURNING candidate_channel_id
                    "#,
                    key.team_id,
                    key.foreign_id.as_str(),
                    channel_id,
                    ready.then_some(channel_id),
                    if ready { "ready" } else { "pending" },
                )
                .fetch_optional(&mut *tx)
                .await?;
                if inserted != Some(channel_id) {
                    return Err(ImportError::TargetConflict);
                }
                (channel_id, ready)
            }
        };
        tx.commit().await?;
        Ok(ImportTargetReservation {
            key: key.clone(),
            channel_id,
            ready,
        })
    }

    async fn complete_target(
        &self,
        key: &ImportTargetKey,
        channel_id: Uuid,
        kind: ImportTargetKind,
    ) -> Result<ImportTargetReservation> {
        let mut tx = self.pool.begin().await?;
        let result = complete_target_in(&mut tx, key, channel_id, kind).await?;
        tx.commit().await?;
        Ok(result)
    }
}

/// Complete a reserved target alongside channel creation in a caller-owned transaction.
pub async fn complete_target_in(
    tx: &mut Transaction<'_, Postgres>,
    key: &ImportTargetKey,
    channel_id: Uuid,
    kind: ImportTargetKind,
) -> Result<ImportTargetReservation> {
    lock_key(tx, key).await?;
    let row = reservation(tx, key)
        .await?
        .ok_or(ImportError::TargetNotReserved)?;
    if row.candidate_channel_id != channel_id || row.state == "conflict" {
        return Err(ImportError::TargetConflict);
    }
    validate_channel(tx, key, channel_id, kind).await?;
    sqlx::query!(
        r#"
            UPDATE import_target_reservation
            SET state = 'ready', channel_id = $3, updated_at = now()
            WHERE team_id = $1 AND source = 'slack' AND foreign_id = $2 AND state = 'pending'
            "#,
        key.team_id,
        key.foreign_id.as_str(),
        channel_id,
    )
    .execute(&mut **tx)
    .await?;
    Ok(ImportTargetReservation {
        key: key.clone(),
        channel_id,
        ready: true,
    })
}

/// Lock the canonical source key before channel or message operations. Returns
/// validated same-team provenance only for a ready, compatible reservation.
/// A missing reservation is allowed for read-only target discovery.
pub async fn lock_target_in(
    tx: &mut Transaction<'_, Postgres>,
    key: &ImportTargetKey,
    channel_id: Uuid,
    kind: ImportTargetKind,
    required: bool,
) -> Result<bool> {
    lock_key(tx, key).await?;
    let Some(row) = reservation(tx, key).await? else {
        if required {
            return Err(ImportError::TargetNotReserved);
        }
        return Ok(false);
    };
    if row.candidate_channel_id != channel_id || row.state == "conflict" {
        return Err(ImportError::TargetConflict);
    }
    if row.state == "ready" {
        validate_channel(tx, key, channel_id, kind).await?;
        return Ok(true);
    }
    Ok(false)
}

async fn lock_key(tx: &mut Transaction<'_, Postgres>, key: &ImportTargetKey) -> Result<()> {
    // A transaction-only lock also covers the absent-row case. Hash collisions
    // merely serialize unrelated reservations; uniqueness comes from the PK.
    sqlx::query!(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        format!("import:{}:slack:{}", key.team_id, key.foreign_id.as_str()),
    )
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn reservation(
    tx: &mut Transaction<'_, Postgres>,
    key: &ImportTargetKey,
) -> Result<Option<ReservationRow>> {
    Ok(sqlx::query_as!(
        ReservationRow,
        r#"
        SELECT candidate_channel_id, state FROM import_target_reservation
        WHERE team_id = $1 AND source = 'slack' AND foreign_id = $2
        FOR UPDATE
        "#,
        key.team_id,
        key.foreign_id.as_str(),
    )
    .fetch_optional(&mut **tx)
    .await?)
}

async fn validate_channel(
    tx: &mut Transaction<'_, Postgres>,
    key: &ImportTargetKey,
    channel_id: Uuid,
    kind: ImportTargetKind,
) -> Result<()> {
    // Channel row locking serializes claims of the same existing private/DM
    // across different team namespaces, as well as deletion/type changes.
    let channel = sqlx::query!(
        "SELECT team_id, channel_type::text AS \"kind!\" FROM comms_channels WHERE id = $1 FOR UPDATE",
        channel_id,
    )
    .fetch_optional(&mut **tx)
    .await?
    .ok_or(ImportError::TargetConflict)?;
    if channel.kind != kind.as_ref()
        || (kind == ImportTargetKind::Team && channel.team_id != Some(key.team_id))
        || (kind != ImportTargetKind::Team && channel.team_id.is_some())
    {
        return Err(ImportError::TargetConflict);
    }
    let other_team = sqlx::query_scalar!(
        r#"
        SELECT EXISTS (
            SELECT 1 FROM import_target_reservation
            WHERE channel_id = $1 AND team_id <> $2
        ) OR EXISTS (
            SELECT 1 FROM import_entity
            WHERE source = 'slack' AND status = 'imported' AND entity_type = 'channel'
              AND entity_id = $1::text AND team_id <> $2
        ) AS "exists!"
        "#,
        channel_id,
        key.team_id,
    )
    .fetch_one(&mut **tx)
    .await?;
    if other_team {
        return Err(ImportError::TargetConflict);
    }
    Ok(())
}
