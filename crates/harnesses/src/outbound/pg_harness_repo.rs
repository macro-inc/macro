//! Postgres harness repository.

use computer_id::ComputerId;
use pairing_id::PairingId;
#[cfg(test)]
mod tests;

mod persistence_error;
use persistence_error::HarnessPersistenceError;

use anyhow::Context;
use chrono::{DateTime, Utc};
use harness_id::HarnessId;
use harness_token::HashedHarnessToken;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{PgPool, types::Json};
use uuid::Uuid;

use crate::domain::{
    models::{
        ClaudeMode, Harness, HarnessAgent, HarnessCapabilities, HarnessOwner, HarnessSession,
        PairingClaimFacts, PairingDetails, PairingStatus,
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
    team_id: Option<Uuid>,
    created_by: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    last_connected_at: Option<DateTime<Utc>>,
    last_disconnected_at: Option<DateTime<Utc>>,
    capabilities: Json<HarnessCapabilities>,
    computer_id: Option<Uuid>,
    claude_mode: String,
}

impl TryFrom<HarnessRow> for Harness {
    type Error = anyhow::Error;

    fn try_from(row: HarnessRow) -> Result<Self, Self::Error> {
        let owner = match (row.owner_user_id, row.team_id) {
            (Some(user_id), None) => HarnessOwner::User { user_id },
            (None, Some(team_id)) => HarnessOwner::Team { team_id },
            _ => anyhow::bail!("harness row violated its owner invariant"),
        };
        let connected = match (row.last_connected_at, row.last_disconnected_at) {
            (Some(connected_at), Some(disconnected_at)) => connected_at > disconnected_at,
            (Some(_), None) => true,
            (None, _) => false,
        };

        Ok(Self {
            id: HarnessId::new_from_uuid(row.id),
            allow_permission_bypass: row.allow_permission_bypass,
            kind: row.kind,
            name: row.name,
            owner,
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
            id, kind, name, owner_user_id, team_id, created_by, allow_permission_bypass,
            created_at, updated_at, last_connected_at, last_disconnected_at,
            capabilities AS "capabilities: Json<HarnessCapabilities>", computer_id, claude_mode
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

async fn insert_harness(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    harness: &NewHarness,
) -> Result<(), HarnessPersistenceError> {
    let (owner_user_id, team_id) = match &harness.owner {
        HarnessOwner::User { user_id } => (Some(user_id.as_str()), None),
        HarnessOwner::Team { team_id } => (None, Some(*team_id)),
    };
    sqlx::query!(
        r#"
        INSERT INTO harnesses
            (id, kind, name, owner_user_id, team_id, created_by, allow_permission_bypass, computer_id)
        VALUES ($1, 'macrod', $2, $3, $4, $5, $6, $7)
        "#,
        harness.id.as_uuid(),
        harness.name,
        owner_user_id,
        team_id,
        harness.created_by.as_ref(),
        harness.allow_permission_bypass,
        harness.computer_id.map(ComputerId::as_uuid),
    )
    .execute(&mut **tx)
    .await
    .map_err(|error| HarnessPersistenceError::Internal(rootcause::Report::new(error).context("failed to insert harness").into_dynamic()))?;
    Ok(())
}

async fn insert_hosted_pairing(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    pairing: &NewPairing,
    harness_id: Uuid,
    approved_by: &str,
) -> Result<(), HarnessPersistenceError> {
    sqlx::query!(
        r#"
        INSERT INTO harness_pairing_requests
            (id, code, device_secret_hash, requested_name, host_info,
             expires_at,
             status, harness_id, approved_by)
        VALUES ($1, $2, $3, $4, $5, $6, 'approved', $7, $8)
        "#,
        pairing.id.as_uuid(),
        pairing.code,
        &pairing.device_secret_hash[..],
        pairing.requested_name,
        pairing.host,
        pairing.expires_at,
        harness_id,
        approved_by,
    )
    .execute(&mut **tx)
    .await
    .map_err(|error| {
        HarnessPersistenceError::Internal(
            rootcause::Report::new(error)
                .context("failed to insert approved pairing")
                .into_dynamic(),
        )
    })?;
    Ok(())
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
        let computer_id = harness
            .computer_id
            .ok_or(HarnessPersistenceError::MissingComputer)?;
        let mut tx = self.pool.begin().await.map_err(|error| {
            HarnessPersistenceError::Internal(
                rootcause::Report::new(error)
                    .context("failed to begin tx")
                    .into_dynamic(),
            )
        })?;
        // Serializes retries for one computer, including the first insert,
        // which has no row to lock yet.
        sqlx::query!(
            "SELECT pg_advisory_xact_lock(hashtextextended($1::uuid::text, 0))",
            computer_id.as_uuid(),
        )
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            HarnessPersistenceError::Internal(
                rootcause::Report::new(error)
                    .context("failed to lock the computer's pairing")
                    .into_dynamic(),
            )
        })?;

        let existing = sqlx::query_scalar!(
            r#"
            SELECT id FROM harnesses
            WHERE computer_id = $1 AND deleted_at IS NULL
            FOR UPDATE
            "#,
            computer_id.as_uuid(),
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(|error| {
            HarnessPersistenceError::Internal(
                rootcause::Report::new(error)
                    .context("failed to lock the computer's harness")
                    .into_dynamic(),
            )
        })?;

        let outcome = match existing {
            None => {
                insert_harness(&mut tx, &harness).await?;
                insert_hosted_pairing(
                    &mut tx,
                    &pairing,
                    harness.id.as_uuid(),
                    harness.created_by.as_ref(),
                )
                .await?;
                HostedPairingUpsert::Created
            }
            Some(harness_id) => {
                // Read after taking the harness lock: a concurrent claim may
                // have committed while this transaction waited for it.
                let existing_pairing = sqlx::query!(
                    "SELECT id, status FROM harness_pairing_requests WHERE harness_id = $1",
                    harness_id,
                )
                .fetch_optional(&mut *tx)
                .await
                .map_err(|error| {
                    HarnessPersistenceError::Internal(
                        rootcause::Report::new(error)
                            .context("failed to look up the harness's pairing")
                            .into_dynamic(),
                    )
                })?;
                match existing_pairing {
                    Some(row) if row.status == "approved" => {
                        let pairing_id = row.id;
                        sqlx::query!(
                            r#"
                        UPDATE harness_pairing_requests
                        SET device_secret_hash = $2
                        WHERE id = $1 AND status = 'approved'
                        "#,
                            pairing_id,
                            &pairing.device_secret_hash[..],
                        )
                        .execute(&mut *tx)
                        .await
                        .map_err(|error| {
                            HarnessPersistenceError::Internal(
                                rootcause::Report::new(error)
                                    .context("failed to rotate the pairing's device secret")
                                    .into_dynamic(),
                            )
                        })?;
                        HostedPairingUpsert::Rotated {
                            pairing_id: PairingId::new_from_uuid(pairing_id),
                        }
                    }
                    _ => {
                        sqlx::query!(
                            r#"
                        UPDATE harness_tokens
                        SET revoked_at = now()
                        WHERE harness_id = $1 AND revoked_at IS NULL
                        "#,
                            harness_id,
                        )
                        .execute(&mut *tx)
                        .await
                        .map_err(|error| {
                            HarnessPersistenceError::Internal(
                                rootcause::Report::new(error)
                                    .context("failed to revoke harness tokens for re-enrollment")
                                    .into_dynamic(),
                            )
                        })?;
                        sqlx::query!(
                            "DELETE FROM harness_pairing_requests WHERE harness_id = $1",
                            harness_id,
                        )
                        .execute(&mut *tx)
                        .await
                        .map_err(|error| {
                            HarnessPersistenceError::Internal(
                                rootcause::Report::new(error)
                                    .context("failed to retire the previous pairing")
                                    .into_dynamic(),
                            )
                        })?;
                        insert_hosted_pairing(
                            &mut tx,
                            &pairing,
                            harness_id,
                            harness.created_by.as_ref(),
                        )
                        .await?;
                        tracing::info!(%harness_id, "hosted harness re-keyed");
                        HostedPairingUpsert::Rekeyed
                    }
                }
            }
        };
        tx.commit().await.map_err(|error| {
            HarnessPersistenceError::Internal(
                rootcause::Report::new(error)
                    .context("failed to commit")
                    .into_dynamic(),
            )
        })?;
        Ok(outcome)
    }

    async fn computer_harness(
        &self,
        computer_id: ComputerId,
    ) -> Result<Option<HarnessId>, Self::Err> {
        let harness_id = sqlx::query_scalar!(
            r#"
            SELECT id FROM harnesses
            WHERE computer_id = $1 AND deleted_at IS NULL
            "#,
            computer_id.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            HarnessPersistenceError::Internal(
                rootcause::Report::new(error)
                    .context("failed to look up the computer's harness")
                    .into_dynamic(),
            )
        })?;
        Ok(harness_id.map(HarnessId::new_from_uuid))
    }

    async fn harness_computer(
        &self,
        harness_id: HarnessId,
    ) -> Result<Option<ComputerId>, Self::Err> {
        let computer_id = sqlx::query_scalar!(
            r#"
            SELECT computer_id FROM harnesses
            WHERE id = $1 AND deleted_at IS NULL
            "#,
            harness_id.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            HarnessPersistenceError::Internal(
                rootcause::Report::new(error)
                    .context("failed to look up the harness's computer")
                    .into_dynamic(),
            )
        })?;
        Ok(computer_id.flatten().map(ComputerId::new_from_uuid))
    }

    async fn set_capabilities(
        &self,
        harness_id: HarnessId,
        capabilities: HarnessCapabilities,
    ) -> Result<bool, Self::Err> {
        let updated = sqlx::query!(
            r#"
            UPDATE harnesses
            SET capabilities = $2, updated_at = now()
            WHERE id = $1 AND deleted_at IS NULL
            "#,
            harness_id.as_uuid(),
            Json(capabilities) as _,
        )
        .execute(&self.pool)
        .await
        .map_err(|error| {
            HarnessPersistenceError::Internal(
                rootcause::Report::new(error)
                    .context("failed to set harness capabilities")
                    .into_dynamic(),
            )
        })?;
        Ok(updated.rows_affected() == 1)
    }

    async fn set_claude_mode(
        &self,
        harness_id: HarnessId,
        mode: ClaudeMode,
    ) -> Result<bool, Self::Err> {
        let updated = sqlx::query!(
            r#"
            UPDATE harnesses
            SET claude_mode = $2, updated_at = now()
            WHERE id = $1 AND deleted_at IS NULL
            "#,
            harness_id.as_uuid(),
            mode.as_str(),
        )
        .execute(&self.pool)
        .await
        .map_err(|error| {
            HarnessPersistenceError::Internal(
                rootcause::Report::new(error)
                    .context("failed to set harness claude mode")
                    .into_dynamic(),
            )
        })?;
        Ok(updated.rows_affected() == 1)
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
        token_id: Uuid,
        token: HashedHarnessToken,
    ) -> Result<Option<Harness>, Self::Err> {
        let mut tx = self.pool.begin().await.context("failed to begin tx")?;

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
            WHERE id = $1 AND status = 'approved'
            RETURNING harness_id AS "harness_id!"
            "#,
            pairing_id.as_uuid(),
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

    async fn list_visible_harnesses(
        &self,
        caller: MacroUserIdStr<'static>,
    ) -> Result<Vec<Harness>, Self::Err> {
        let rows = sqlx::query_as!(
            HarnessRow,
            r#"
            SELECT
                id, kind, name, owner_user_id, team_id, created_by, allow_permission_bypass,
                created_at, updated_at, last_connected_at, last_disconnected_at,
                capabilities AS "capabilities: Json<HarnessCapabilities>", computer_id, claude_mode
            FROM harnesses
            WHERE deleted_at IS NULL
              AND (
                owner_user_id = $1
                OR team_id IN (SELECT team_id FROM team_user WHERE user_id = $1)
              )
            ORDER BY created_at DESC
            "#,
            caller.as_ref(),
        )
        .fetch_all(&self.pool)
        .await
        .context("failed to list harnesses")?;

        rows.into_iter().map(Harness::try_from).collect()
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
                id, kind, name, owner_user_id, team_id, created_by, allow_permission_bypass,
                created_at, updated_at, last_connected_at, last_disconnected_at,
                capabilities AS "capabilities: Json<HarnessCapabilities>", computer_id, claude_mode
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
