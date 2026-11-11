//! Provider account login persistence.

use super::*;
use crate::domain::account_logins::{ProviderAccount, ProviderAccountIdentity};

impl PgHarnessRepo {
    pub(super) async fn record_account_login_inner(
        &self,
        harness_id: HarnessId,
        change: AccountLoginChange,
    ) -> Result<bool, HarnessPersistenceError> {
        let internal = |context: &'static str| {
            move |error: sqlx::Error| {
                HarnessPersistenceError::Internal(
                    rootcause::Report::new(error)
                        .context(context)
                        .into_dynamic(),
                )
            }
        };
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(internal("failed to begin an account login change"))?;
        // Locks the harness so concurrent sign-ins on it serialize.
        let harness = sqlx::query_scalar!(
            "SELECT id FROM harnesses WHERE id = $1 AND deleted_at IS NULL FOR UPDATE",
            harness_id.as_uuid(),
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(internal("failed to lock the harness"))?;
        if harness.is_none() {
            return Ok(false);
        }
        let provider = change.provider();
        // A sign-in on the active login's own account is the machine
        // reporting it again: only its expiry moves.
        if let AccountLoginChange::SignedIn {
            account,
            expires_at,
            ..
        } = &change
        {
            let refreshed = sqlx::query!(
                r#"
                WITH active AS (
                    SELECT login.id, login.provider_account_id
                    FROM harness_account_logins login
                    JOIN provider_accounts account ON account.id = login.provider_account_id
                    WHERE login.harness_id = $1 AND login.provider = $2
                      AND login.signed_out_at IS NULL AND account.external_account_id = $3
                ), seen AS (
                    UPDATE provider_accounts SET last_seen_at = now()
                    WHERE id IN (SELECT provider_account_id FROM active)
                )
                UPDATE harness_account_logins SET expires_at = $4
                WHERE id IN (SELECT id FROM active)
                "#,
                harness_id.as_uuid(),
                provider as AgentProvider,
                account.external_account_id,
                *expires_at,
            )
            .execute(&mut *tx)
            .await
            .map_err(internal("failed to refresh the active account login"))?;
            if refreshed.rows_affected() == 1 {
                tx.commit()
                    .await
                    .map_err(internal("failed to commit the account login refresh"))?;
                return Ok(true);
            }
        }
        sqlx::query!(
            r#"
            UPDATE harness_account_logins SET signed_out_at = now()
            WHERE harness_id = $1 AND provider = $2 AND signed_out_at IS NULL
            "#,
            harness_id.as_uuid(),
            provider as AgentProvider,
        )
        .execute(&mut *tx)
        .await
        .map_err(internal("failed to sign out the active account login"))?;
        if let AccountLoginChange::SignedIn {
            account,
            signed_in_by,
            expires_at,
            ..
        } = &change
        {
            let account_id = sqlx::query_scalar!(
                r#"
                INSERT INTO provider_accounts (id, provider, external_account_id)
                VALUES ($1, $2, $3)
                ON CONFLICT (provider, external_account_id) DO UPDATE
                SET last_seen_at = now()
                RETURNING id
                "#,
                Uuid::now_v7(),
                provider as AgentProvider,
                account.external_account_id,
            )
            .fetch_one(&mut *tx)
            .await
            .map_err(internal("failed to record the provider account"))?;
            sqlx::query!(
                r#"
                INSERT INTO harness_account_logins
                    (id, harness_id, provider_account_id, provider, signed_in_by, expires_at)
                VALUES ($1, $2, $3, $4, $5, $6)
                "#,
                Uuid::now_v7(),
                harness_id.as_uuid(),
                account_id,
                provider as AgentProvider,
                signed_in_by.as_ref().map(AsRef::<str>::as_ref),
                *expires_at,
            )
            .execute(&mut *tx)
            .await
            .map_err(internal("failed to record the account login"))?;
        }
        tx.commit()
            .await
            .map_err(internal("failed to commit the account login change"))?;
        Ok(true)
    }

    pub(super) async fn active_account_login_inner(
        &self,
        harness_id: HarnessId,
        provider: AgentProvider,
    ) -> Result<Option<HarnessAccountLogin>, HarnessPersistenceError> {
        let row = sqlx::query!(
            r#"
            SELECT login.id, login.signed_in_by, login.signed_in_at, login.expires_at,
                   login.signed_out_at, account.id AS account_id, account.provider AS "provider: AgentProvider",
                   account.external_account_id
            FROM harness_account_logins login
            JOIN provider_accounts account ON account.id = login.provider_account_id
            WHERE login.harness_id = $1 AND login.provider = $2 AND login.signed_out_at IS NULL
            "#,
            harness_id.as_uuid(),
            provider as AgentProvider,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            HarnessPersistenceError::Internal(
                rootcause::Report::new(error)
                    .context("failed to read the active account login")
                    .into_dynamic(),
            )
        })?;
        let Some(row) = row else {
            return Ok(None);
        };
        let invalid = |what: &'static str| {
            HarnessPersistenceError::Internal(
                rootcause::report!("stored account login has an invalid {what}").into_dynamic(),
            )
        };
        Ok(Some(HarnessAccountLogin {
            id: row.id,
            harness_id,
            account: ProviderAccount {
                id: row.account_id,
                provider: row.provider,
                identity: ProviderAccountIdentity {
                    external_account_id: row.external_account_id,
                },
            },
            signed_in_by: row
                .signed_in_by
                .map(MacroUserIdStr::try_from)
                .transpose()
                .map_err(|_| invalid("signer"))?,
            signed_in_at: row.signed_in_at,
            expires_at: row.expires_at,
            signed_out_at: row.signed_out_at,
        }))
    }
}
