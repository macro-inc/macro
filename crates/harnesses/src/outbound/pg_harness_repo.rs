//! Postgres harness repository.

use computer_id::ComputerId;
use pairing_id::PairingId;
#[cfg(test)]
mod tests;

mod hosted_pairing;
mod metadata;
mod persistence_error;
use hosted_pairing::{grant_team_access, insert_harness};
use persistence_error::HarnessPersistenceError;

use anyhow::Context;
use chrono::{DateTime, Utc};
use entity_access_db_utils::{EntityType, delete_entity_access_rows, team_share};
use harness_id::HarnessId;
use harness_token::HashedHarnessToken;
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::access_level::AccessLevel;
use sqlx::{PgPool, types::Json};
use uuid::Uuid;

use crate::domain::{
    models::{
        ClaudeMode, Harness, HarnessAccess, HarnessAgent, HarnessCapabilities, HarnessOwner,
        HarnessResident, HarnessSession, PairingClaimFacts, PairingDetails, PairingStatus,
    },
    ports::{
        HarnessChanges, HarnessRepo, HostedPairingUpsert, NewHarness, NewPairing,
        OpenPairingCounts, PairingRow,
    },
};

/// Postgres-backed harness repository.
#[derive(Clone, Debug)]
pub struct PgHarnessRepo {
    pool: PgPool,
}

impl PgHarnessRepo {
    /// Create a repository backed by the supplied pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

struct HarnessRow {
    allow_permission_bypass: bool,
    id: Uuid,
    kind: String,
    name: String,
    owner_user_id: Option<String>,
    created_by: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    last_connected_at: Option<DateTime<Utc>>,
    last_disconnected_at: Option<DateTime<Utc>>,
    capabilities: Json<HarnessCapabilities>,
    computer_id: Option<Uuid>,
    claude_mode: String,
    has_live_connection: bool,
    has_connection_record: bool,
    access: Option<AccessLevel>,
    shared_team_ids: Option<Vec<String>>,
}

impl HarnessRow {
    /// A live connection row is the answer. A row whose lease lapsed means the
    /// replica holding it died. With no rows at all, the connection may come
    /// from a replica older than these rows, which only stamps the timestamps.
    fn connected(&self) -> bool {
        if self.has_live_connection {
            return true;
        }

        if self.has_connection_record {
            return false;
        }

        match (self.last_connected_at, self.last_disconnected_at) {
            (Some(connected_at), Some(disconnected_at)) => connected_at > disconnected_at,
            (Some(_), None) => true,
            (None, _) => false,
        }
    }
}

fn harness_access(level: Option<AccessLevel>) -> HarnessAccess {
    match level {
        Some(AccessLevel::Owner) => HarnessAccess::Owner,
        Some(AccessLevel::Edit) => HarnessAccess::User,
        Some(AccessLevel::Comment | AccessLevel::View) => HarnessAccess::Read,
        None => HarnessAccess::None,
    }
}

impl TryFrom<HarnessRow> for Harness {
    type Error = anyhow::Error;

    fn try_from(row: HarnessRow) -> Result<Self, Self::Error> {
        let connected = row.connected();
        let owner = HarnessOwner::User {
            user_id: row.owner_user_id.unwrap_or_else(|| row.created_by.clone()),
        };
        let shared_team_ids = row
            .shared_team_ids
            .unwrap_or_default()
            .iter()
            .map(|id| id.parse())
            .collect::<Result<Vec<Uuid>, _>>()
            .context("persisted team grant is not a team id")?;

        Ok(Self {
            id: HarnessId::new_from_uuid(row.id),
            allow_permission_bypass: row.allow_permission_bypass,
            kind: row.kind,
            name: row.name,
            owner,
            access: harness_access(row.access),
            shared_team_ids,
            created_by: row.created_by,
            created_at: row.created_at,
            updated_at: row.updated_at,
            connected,
            last_connected_at: row.last_connected_at,
            capabilities: row.capabilities.0,
            computer_id: row.computer_id.map(ComputerId::new_from_uuid),
            claude_mode: row
                .claude_mode
                .parse()
                .map_err(HarnessPersistenceError::InvalidClaudeMode)?,
        })
    }
}

fn pairing_status(status: &str) -> anyhow::Result<PairingStatus> {
    match status {
        "pending" => Ok(PairingStatus::Pending),
        "approved" => Ok(PairingStatus::Approved),
        "claimed" => Ok(PairingStatus::Claimed),
        other => anyhow::bail!("unknown pairing status: {other}"),
    }
}

async fn fetch_harness(
    executor: impl sqlx::PgExecutor<'_>,
    harness_id: Uuid,
) -> anyhow::Result<Option<Harness>> {
    let row = sqlx::query_as!(
        HarnessRow,
        r#"
        SELECT
            id, kind, name, owner_user_id, created_by, allow_permission_bypass,
            created_at, updated_at, last_connected_at, last_disconnected_at,
            capabilities AS "capabilities: Json<HarnessCapabilities>", computer_id, claude_mode,
            EXISTS (SELECT 1 FROM harness_runtime_connection c WHERE c.harness_id = harnesses.id AND c.lease_expires_at > now()) AS "has_live_connection!",
            EXISTS (SELECT 1 FROM harness_runtime_connection c WHERE c.harness_id = harnesses.id) AS "has_connection_record!",
            NULL::"AccessLevel" AS "access?: AccessLevel",
            ARRAY(SELECT ea.source_id FROM entity_access ea WHERE ea.entity_id = harnesses.id AND ea.entity_type = 'harness' AND ea.source_type = 'team') AS shared_team_ids
        FROM harnesses
        WHERE id = $1 AND deleted_at IS NULL
        "#,
        harness_id,
    )
    .fetch_optional(executor)
    .await
    .context("failed to fetch harness")?;

    row.map(Harness::try_from).transpose()
}

impl HarnessRepo for PgHarnessRepo {
    type Err = anyhow::Error;

    async fn insert_pairing(&self, pairing: NewPairing) -> Result<bool, Self::Err> {
        let inserted = sqlx::query!(
            r#"
            INSERT INTO harness_pairing_requests
                (id, code, device_secret_hash, requested_name, host_info, expires_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (code) DO NOTHING
            "#,
            pairing.id.as_uuid(),
            pairing.code,
            &pairing.device_secret_hash[..],
            pairing.requested_name,
            pairing.host,
            pairing.expires_at,
        )
        .execute(&self.pool)
        .await
        .context("failed to insert pairing")?;

        Ok(inserted.rows_affected() == 1)
    }

    async fn delete_expired_pairings(&self) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            DELETE FROM harness_pairing_requests
            WHERE expires_at <= now() AND status <> 'approved'
              AND NOT EXISTS (
                  SELECT 1 FROM harnesses h
                  WHERE h.id = harness_pairing_requests.harness_id
                    AND h.computer_id IS NOT NULL AND h.deleted_at IS NULL
              )
            "#
        )
        .execute(&self.pool)
        .await
        .context("failed to delete expired pairings")?;
        Ok(())
    }

    async fn count_open_pairings(
        &self,
        requested_name: &str,
    ) -> Result<OpenPairingCounts, Self::Err> {
        let row = sqlx::query!(
            r#"
            SELECT
                count(*) AS "total!",
                count(*) FILTER (WHERE requested_name = $1) AS "with_same_name!"
            FROM harness_pairing_requests
            WHERE status = 'pending' AND expires_at > now()
            "#,
            requested_name,
        )
        .fetch_one(&self.pool)
        .await
        .context("failed to count open pairings")?;

        Ok(OpenPairingCounts {
            total: row.total,
            with_same_name: row.with_same_name,
        })
    }

    async fn get_pairing(&self, code: &str) -> Result<Option<PairingRow>, Self::Err> {
        let row = sqlx::query!(
            r#"
            SELECT code, requested_name, host_info, status, created_at, expires_at
            FROM harness_pairing_requests
            WHERE code = $1
            "#,
            code,
        )
        .fetch_optional(&self.pool)
        .await
        .context("failed to fetch pairing")?;

        row.map(|row| {
            Ok(PairingRow {
                details: PairingDetails {
                    code: row.code,
                    requested_name: row.requested_name,
                    host: row.host_info,
                    created_at: row.created_at,
                    expires_at: row.expires_at,
                },
                status: pairing_status(&row.status)?,
            })
        })
        .transpose()
    }

    async fn approve_pairing(
        &self,
        code: &str,
        harness: NewHarness,
    ) -> Result<Option<Harness>, Self::Err> {
        let mut tx = self.pool.begin().await.context("failed to begin tx")?;

        insert_harness(&mut tx, &harness).await?;

        let approved = sqlx::query!(
            r#"
            UPDATE harness_pairing_requests
            SET status = 'approved', harness_id = $2, approved_by = $3
            WHERE code = $1 AND status = 'pending' AND expires_at > now()
            "#,
            code,
            harness.id.as_uuid(),
            harness.created_by.as_ref(),
        )
        .execute(&mut *tx)
        .await
        .context("failed to approve pairing")?;

        if approved.rows_affected() != 1 {
            // Roll the harness insert back: the pairing raced to another state.
            tx.rollback().await.context("failed to roll back")?;
            return Ok(None);
        }

        let created = fetch_harness(&mut *tx, harness.id.as_uuid())
            .await?
            .context("approved harness row missing")?;
        tx.commit().await.context("failed to commit")?;
        Ok(Some(created))
    }

    async fn upsert_hosted_pairing(
        &self,
        pairing: NewPairing,
        harness: NewHarness,
    ) -> Result<HostedPairingUpsert, Self::Err> {
        self.upsert_hosted_pairing_inner(pairing, harness)
            .await
            .map_err(Into::into)
    }

    async fn computer_harness(
        &self,
        computer_id: ComputerId,
    ) -> Result<Option<HarnessId>, Self::Err> {
        self.computer_harness_inner(computer_id)
            .await
            .map_err(Into::into)
    }

    async fn harness_computer(
        &self,
        harness_id: HarnessId,
    ) -> Result<Option<ComputerId>, Self::Err> {
        self.harness_computer_inner(harness_id)
            .await
            .map_err(Into::into)
    }

    async fn set_capabilities(
        &self,
        harness_id: HarnessId,
        capabilities: HarnessCapabilities,
    ) -> Result<bool, Self::Err> {
        self.set_capabilities_inner(harness_id, capabilities)
            .await
            .map_err(Into::into)
    }

    async fn set_claude_mode(
        &self,
        harness_id: HarnessId,
        mode: ClaudeMode,
    ) -> Result<bool, Self::Err> {
        self.set_claude_mode_inner(harness_id, mode)
            .await
            .map_err(Into::into)
    }

    async fn pairing_claim_facts(
        &self,
        pairing_id: PairingId,
    ) -> Result<Option<PairingClaimFacts>, Self::Err> {
        let row = sqlx::query!(
            r#"
            SELECT device_secret_hash, status, expires_at, harness_id
            FROM harness_pairing_requests
            WHERE id = $1
            "#,
            pairing_id.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await
        .context("failed to fetch pairing claim facts")?;

        row.map(|row| {
            let device_secret_hash: [u8; 32] = row
                .device_secret_hash
                .try_into()
                .map_err(|_| anyhow::anyhow!("persisted device secret hash is not 32 bytes"))?;
            Ok(PairingClaimFacts {
                device_secret_hash,
                status: pairing_status(&row.status)?,
                expires_at: row.expires_at,
                harness_id: row.harness_id.map(HarnessId::new_from_uuid),
            })
        })
        .transpose()
    }

    async fn claim_pairing(
        &self,
        pairing_id: PairingId,
        device_secret_hash: [u8; 32],
        token_id: Uuid,
        token: HashedHarnessToken,
    ) -> Result<Option<Harness>, Self::Err> {
        let mut tx = self.pool.begin().await.context("failed to begin tx")?;

        // Fleet Create holds this guard through its claim check, issuance and
        // enrollment write. A committed claim is therefore never re-keyed by retry.
        sqlx::query!(
            r#"
            SELECT pg_advisory_xact_lock(hashtextextended('hosted-enrollment:' || h.computer_id::text, 0))
            FROM harnesses h JOIN harness_pairing_requests p ON p.harness_id = h.id
            WHERE p.id = $1 AND h.computer_id IS NOT NULL
            "#,
            pairing_id.as_uuid(),
        ).execute(&mut *tx).await.context("failed to lock hosted enrollment")?;

        // Re-key and claim lock the harness before touching pairings or tokens.
        let harness_id = sqlx::query_scalar!(
            r#"
            SELECT h.id FROM harnesses h
            JOIN harness_pairing_requests p ON p.harness_id = h.id
            WHERE p.id = $1 AND h.deleted_at IS NULL
            FOR UPDATE OF h
            "#,
            pairing_id.as_uuid(),
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(|error| {
            HarnessPersistenceError::Internal(
                rootcause::Report::new(error)
                    .context("failed to lock the pairing's harness")
                    .into_dynamic(),
            )
        })?;
        if harness_id.is_none() {
            return Ok(None);
        }

        let claimed = sqlx::query_scalar!(
            r#"
            UPDATE harness_pairing_requests
            SET status = 'claimed', claimed_at = now()
            WHERE id = $1 AND status = 'approved' AND device_secret_hash = $2
            RETURNING harness_id AS "harness_id!"
            "#,
            pairing_id.as_uuid(),
            &device_secret_hash[..],
        )
        .fetch_optional(&mut *tx)
        .await
        .context("failed to claim pairing")?;

        let Some(harness_id) = claimed else {
            tx.rollback().await.context("failed to roll back")?;
            return Ok(None);
        };

        sqlx::query!(
            r#"
            INSERT INTO harness_tokens (id, harness_id, token_hash, token_prefix)
            VALUES ($1, $2, $3, $4)
            "#,
            token_id,
            harness_id,
            &token.hash[..],
            token.prefix,
        )
        .execute(&mut *tx)
        .await
        .context("failed to persist harness token")?;

        let harness = fetch_harness(&mut *tx, harness_id)
            .await?
            .context("claimed harness row missing")?;
        tx.commit().await.context("failed to commit")?;
        Ok(Some(harness))
    }

    async fn list_usable_harnesses(
        &self,
        caller: MacroUserIdStr<'static>,
    ) -> Result<Vec<Harness>, Self::Err> {
        let rows = sqlx::query_as!(
            HarnessRow,
            r#"
            SELECT
                h.id, h.kind, h.name, h.owner_user_id, h.created_by, h.allow_permission_bypass,
                h.created_at, h.updated_at, h.last_connected_at, h.last_disconnected_at,
                h.capabilities AS "capabilities: Json<HarnessCapabilities>", h.computer_id, h.claude_mode,
                EXISTS (SELECT 1 FROM harness_runtime_connection c WHERE c.harness_id = h.id AND c.lease_expires_at > now()) AS "has_live_connection!",
                EXISTS (SELECT 1 FROM harness_runtime_connection c WHERE c.harness_id = h.id) AS "has_connection_record!",
                harness_access_level(h.id, $1) AS "access?: AccessLevel",
                ARRAY(SELECT ea.source_id FROM entity_access ea WHERE ea.entity_id = h.id AND ea.entity_type = 'harness' AND ea.source_type = 'team') AS shared_team_ids
            FROM harnesses h
            WHERE h.deleted_at IS NULL AND harness_can_run(h.id, $1)
            ORDER BY h.created_at DESC
            "#,
            caller.as_ref(),
        )
        .fetch_all(&self.pool)
        .await
        .context("failed to list harnesses")?;

        rows.into_iter().map(Harness::try_from).collect()
    }

    async fn list_directory_harnesses(
        &self,
        caller: MacroUserIdStr<'static>,
    ) -> Result<Vec<Harness>, Self::Err> {
        let rows = sqlx::query_as!(
            HarnessRow,
            r#"
            SELECT
                h.id, h.kind, h.name, h.owner_user_id, h.created_by, h.allow_permission_bypass,
                h.created_at, h.updated_at, h.last_connected_at, h.last_disconnected_at,
                h.capabilities AS "capabilities: Json<HarnessCapabilities>", h.computer_id, h.claude_mode,
                EXISTS (SELECT 1 FROM harness_runtime_connection c WHERE c.harness_id = h.id AND c.lease_expires_at > now()) AS "has_live_connection!",
                EXISTS (SELECT 1 FROM harness_runtime_connection c WHERE c.harness_id = h.id) AS "has_connection_record!",
                harness_access_level(h.id, $1) AS "access?: AccessLevel",
                ARRAY(SELECT ea.source_id FROM entity_access ea WHERE ea.entity_id = h.id AND ea.entity_type = 'harness' AND ea.source_type = 'team') AS shared_team_ids
            FROM harnesses h
            WHERE h.deleted_at IS NULL
              AND (
                h.computer_id IN (SELECT c.id FROM hosted_runtime c WHERE c.team_id IN (
                    SELECT tu.team_id FROM team_user tu WHERE tu.user_id = $1
                    UNION SELECT t.id FROM team t WHERE t.owner_id = $1
                )) OR
                COALESCE(h.owner_user_id, h.created_by) = $1
                OR COALESCE(h.owner_user_id, h.created_by) IN (
                    SELECT theirs.user_id
                    FROM team_user mine
                    JOIN team_user theirs ON theirs.team_id = mine.team_id
                    WHERE mine.user_id = $1
                )
              )
            ORDER BY h.created_at DESC
            "#,
            caller.as_ref(),
        )
        .fetch_all(&self.pool)
        .await
        .context("failed to list the runtime directory")?;

        rows.into_iter().map(Harness::try_from).collect()
    }

    async fn harness_access(
        &self,
        harness_id: HarnessId,
        caller: MacroUserIdStr<'static>,
    ) -> Result<HarnessAccess, Self::Err> {
        let level = sqlx::query_scalar!(
            r#"SELECT harness_access_level($1, $2) AS "access?: AccessLevel""#,
            harness_id.as_uuid(),
            caller.as_ref(),
        )
        .fetch_one(&self.pool)
        .await
        .context("failed to read harness access")?;
        Ok(harness_access(level))
    }

    async fn set_team_access(
        &self,
        harness_id: HarnessId,
        team_id: Uuid,
        enabled: bool,
    ) -> Result<(), Self::Err> {
        let mut tx = self.pool.begin().await.context("failed to begin tx")?;
        team_share::acquire_guard(&mut tx)
            .await
            .context("failed to acquire team-share guard")?;
        if enabled {
            grant_team_access(&mut tx, harness_id, team_id).await?;
        } else {
            team_share::delete_direct(&mut tx, &harness_id.as_uuid(), EntityType::Harness, team_id)
                .await
                .context("failed to remove team grant")?;
        }
        tx.commit().await.context("failed to commit")?;
        Ok(())
    }

    async fn list_residents(
        &self,
        harness_id: HarnessId,
    ) -> Result<Vec<HarnessResident>, Self::Err> {
        let rows = sqlx::query!(
            r#"
            SELECT b.id, b.name, b.owner_user_id, b.team_id
            FROM agent_configs ac
            JOIN bots b ON b.id = ac.bot_id
            WHERE ac.harness_id = $1
              AND NOT ac.is_coding
              AND b.deleted_at IS NULL
              AND b.has_agent
            ORDER BY b.created_at
            "#,
            harness_id.as_uuid(),
        )
        .fetch_all(&self.pool)
        .await
        .context("failed to list residents")?;

        Ok(rows
            .into_iter()
            .map(|row| HarnessResident {
                bot_id: bot_id::BotId::new_from_uuid(row.id),
                name: row.name,
                owner_user_id: row.owner_user_id,
                team_id: row.team_id,
            })
            .collect())
    }

    async fn get_harness(&self, harness_id: HarnessId) -> Result<Option<Harness>, Self::Err> {
        fetch_harness(&self.pool, harness_id.as_uuid()).await
    }

    async fn update_harness(
        &self,
        harness_id: HarnessId,
        changes: HarnessChanges,
    ) -> Result<Option<Harness>, Self::Err> {
        let row = sqlx::query_as!(
            HarnessRow,
            r#"
            UPDATE harnesses
            SET
                name = COALESCE($2, name),
                allow_permission_bypass = COALESCE($3, allow_permission_bypass),
                updated_at = now()
            WHERE id = $1 AND deleted_at IS NULL
            RETURNING
            id, kind, name, owner_user_id, created_by, allow_permission_bypass,
            created_at, updated_at, last_connected_at, last_disconnected_at,
            capabilities AS "capabilities: Json<HarnessCapabilities>", computer_id, claude_mode,
            EXISTS (SELECT 1 FROM harness_runtime_connection c WHERE c.harness_id = harnesses.id AND c.lease_expires_at > now()) AS "has_live_connection!",
            EXISTS (SELECT 1 FROM harness_runtime_connection c WHERE c.harness_id = harnesses.id) AS "has_connection_record!",
            NULL::"AccessLevel" AS "access?: AccessLevel",
            ARRAY(SELECT ea.source_id FROM entity_access ea WHERE ea.entity_id = harnesses.id AND ea.entity_type = 'harness' AND ea.source_type = 'team') AS shared_team_ids
            "#,
            harness_id.as_uuid(),
            changes.name,
            changes.allow_permission_bypass,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            HarnessPersistenceError::Internal(
                rootcause::Report::new(error)
                    .context("failed to update harness")
                    .into_dynamic(),
            )
        })?;

        row.map(Harness::try_from).transpose()
    }

    async fn delete_harness(&self, harness_id: HarnessId) -> Result<bool, Self::Err> {
        let mut tx = self.pool.begin().await.context("failed to begin tx")?;

        let deleted = sqlx::query!(
            r#"
            UPDATE harnesses
            SET deleted_at = now(), updated_at = now()
            WHERE id = $1 AND deleted_at IS NULL
            "#,
            harness_id.as_uuid(),
        )
        .execute(&mut *tx)
        .await
        .context("failed to delete harness")?;

        sqlx::query!(
            r#"
            UPDATE harness_tokens
            SET revoked_at = now()
            WHERE harness_id = $1 AND revoked_at IS NULL
            "#,
            harness_id.as_uuid(),
        )
        .execute(&mut *tx)
        .await
        .context("failed to revoke harness tokens")?;

        delete_entity_access_rows(&mut tx, &harness_id.as_uuid(), EntityType::Harness)
            .await
            .context("failed to drop harness grants")?;

        tx.commit().await.context("failed to commit")?;
        Ok(deleted.rows_affected() == 1)
    }

    async fn user_has_team(
        &self,
        caller: MacroUserIdStr<'static>,
        team_id: Uuid,
    ) -> Result<bool, Self::Err> {
        let has_team = sqlx::query_scalar!(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM team_user
                WHERE user_id = $1 AND team_id = $2
                UNION SELECT 1 FROM team WHERE id = $2 AND owner_id = $1
            ) AS "has_team!"
            "#,
            caller.as_ref(),
            team_id,
        )
        .fetch_one(&self.pool)
        .await
        .context("failed to check team membership")?;
        Ok(has_team)
    }

    async fn user_owns_team(
        &self,
        caller: MacroUserIdStr<'static>,
        team_id: Uuid,
    ) -> Result<bool, Self::Err> {
        let owns_team = sqlx::query_scalar!(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM team_user
                WHERE user_id = $1
                  AND team_id = $2
                  AND team_role = 'owner'::team_role
                UNION SELECT 1 FROM team WHERE id = $2 AND owner_id = $1
            ) AS "owns_team!"
            "#,
            caller.as_ref(),
            team_id,
        )
        .fetch_one(&self.pool)
        .await
        .context("failed to check team ownership")?;
        Ok(owns_team)
    }

    async fn list_bound_agents(
        &self,
        harness_id: HarnessId,
    ) -> Result<Vec<HarnessAgent>, Self::Err> {
        let rows = sqlx::query!(
            r#"
            SELECT b.id, b.name, b.handle
            FROM agent_configs ac
            JOIN bots b ON b.id = ac.bot_id
            WHERE ac.harness_id = $1
              AND b.deleted_at IS NULL
              AND b.has_agent
            ORDER BY b.created_at
            "#,
            harness_id.as_uuid(),
        )
        .fetch_all(&self.pool)
        .await
        .context("failed to list bound agents")?;

        Ok(rows
            .into_iter()
            .map(|row| HarnessAgent {
                bot_id: bot_id::BotId::new_from_uuid(row.id),
                name: row.name,
                handle: row.handle,
            })
            .collect())
    }

    async fn list_sessions(&self, harness_id: HarnessId) -> Result<Vec<HarnessSession>, Self::Err> {
        let rows = sqlx::query!(
            r#"
            SELECT
                s.id AS session_id,
                s.bot_id,
                b.name AS bot_name,
                b.handle AS bot_handle,
                s.name,
                s.status,
                s.model,
                s.owner_id,
                s.created_at,
                s.modified_at
            FROM agent_session s
            JOIN agent_configs ac ON ac.bot_id = s.bot_id
            JOIN bots b ON b.id = s.bot_id
            WHERE ac.harness_id = $1
            ORDER BY s.modified_at DESC
            LIMIT 50
            "#,
            harness_id.as_uuid(),
        )
        .fetch_all(&self.pool)
        .await
        .context("failed to list harness sessions")?;

        Ok(rows
            .into_iter()
            .map(|row| HarnessSession {
                session_id: row.session_id,
                bot_id: bot_id::BotId::new_from_uuid(row.bot_id),
                bot_name: row.bot_name,
                bot_handle: row.bot_handle,
                name: row.name,
                status: row.status,
                model: row.model,
                owner_id: row.owner_id,
                created_at: row.created_at,
                modified_at: row.modified_at,
            })
            .collect())
    }
}
