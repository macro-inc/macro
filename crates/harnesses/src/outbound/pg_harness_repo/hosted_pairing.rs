//! Hosted registration, retry rotation, and computer lookups.

use super::*;

pub(super) async fn insert_harness(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    harness: &NewHarness,
) -> Result<(), HarnessPersistenceError> {
    let HarnessOwner::User {
        user_id: owner_user_id,
    } = &harness.owner;
    sqlx::query!(
        r#"
        INSERT INTO harnesses
            (id, kind, name, owner_user_id, created_by, allow_permission_bypass, computer_id)
        VALUES ($1, 'macrod', $2, $3, $4, $5, $6)
        "#,
        harness.id.as_uuid(),
        harness.name,
        owner_user_id,
        harness.created_by.as_ref(),
        harness.allow_permission_bypass,
        harness.computer_id.map(ComputerId::as_uuid),
    )
    .execute(&mut **tx)
    .await
    .map_err(|error| {
        HarnessPersistenceError::Internal(
            rootcause::Report::new(error)
                .context("failed to insert harness")
                .into_dynamic(),
        )
    })?;
    if let Some(team_id) = harness.team_grant {
        team_share::acquire_guard(tx).await.map_err(|error| {
            HarnessPersistenceError::Internal(
                rootcause::report!("{error}")
                    .context("failed to acquire team-share guard")
                    .into_dynamic(),
            )
        })?;
        grant_team_access(tx, harness.id, team_id).await?;
    }
    Ok(())
}

/// Team members use the runtime: the grant is always `edit`.
pub(super) async fn grant_team_access(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    harness_id: HarnessId,
    team_id: Uuid,
) -> Result<(), HarnessPersistenceError> {
    team_share::upsert_direct(
        tx,
        &harness_id.as_uuid(),
        EntityType::Harness,
        team_id,
        AccessLevel::Edit,
    )
    .await
    .map_err(|error| {
        HarnessPersistenceError::Internal(
            rootcause::report!("{error}")
                .context("failed to grant harness to team")
                .into_dynamic(),
        )
    })
}

pub(super) async fn insert_hosted_pairing(
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

impl PgHarnessRepo {
    pub(super) async fn upsert_hosted_pairing_inner(
        &self,
        pairing: NewPairing,
        harness: NewHarness,
    ) -> Result<HostedPairingUpsert, HarnessPersistenceError> {
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

    pub(super) async fn computer_harness_inner(
        &self,
        computer_id: ComputerId,
    ) -> Result<Option<HarnessId>, HarnessPersistenceError> {
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

    pub(super) async fn harness_computer_inner(
        &self,
        harness_id: HarnessId,
    ) -> Result<Option<ComputerId>, HarnessPersistenceError> {
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
}
