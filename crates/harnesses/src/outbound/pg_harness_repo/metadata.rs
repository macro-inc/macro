//! Harness capability and provider account login persistence.

use super::*;
use crate::domain::account_logins::{ProviderAccount, ProviderAccountIdentity};
use crate::domain::models::ClaudeAccount;

impl PgHarnessRepo {
    pub(super) async fn set_capabilities_inner(
        &self,
        harness_id: HarnessId,
        capabilities: HarnessCapabilities,
    ) -> Result<bool, HarnessPersistenceError> {
        // A report on the account of the active Claude login carries its
        // current expiry, which moves as Claude refreshes the sign-in.
        if let Some(ClaudeAccount::SignedIn {
            account_id,
            account,
            organization,
            plan,
            expires_at,
        }) = &capabilities.claude
        {
            sqlx::query!(
                r#"
                WITH active AS (
                    SELECT login.id, login.provider_account_id
                    FROM harness_account_logins login
                    JOIN provider_accounts account ON account.id = login.provider_account_id
                    WHERE login.harness_id = $1 AND login.provider = 'claude'
                      AND login.signed_out_at IS NULL AND account.external_account_id = $2
                ), seen AS (
                    UPDATE provider_accounts
                    SET display_email = $3, display_org = $4, plan = $5, last_seen_at = now()
                    WHERE id IN (SELECT provider_account_id FROM active)
                )
                UPDATE harness_account_logins SET expires_at = $6
                WHERE id IN (SELECT id FROM active)
                "#,
                harness_id.as_uuid(),
                account_id,
                account.as_deref(),
                organization.as_deref(),
                plan.as_deref(),
                *expires_at,
            )
            .execute(&self.pool)
            .await
            .map_err(|error| {
                HarnessPersistenceError::Internal(
                    rootcause::Report::new(error)
                        .context("failed to record the Claude login's expiry")
                        .into_dynamic(),
                )
            })?;
        }
        let updated = sqlx::query!(
            r#"
            UPDATE harnesses
            SET capabilities = $2, capabilities_reported_at = now(), updated_at = now()
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
        sqlx::query!(
            r#"
            UPDATE harness_account_logins SET signed_out_at = now()
            WHERE harness_id = $1 AND provider = $2 AND signed_out_at IS NULL
            "#,
            harness_id.as_uuid(),
            provider.as_ref(),
        )
        .execute(&mut *tx)
        .await
        .map_err(internal("failed to sign out the active account login"))?;
        if let AccountLoginChange::SignedIn {
            account,
            signed_in_by,
            ..
        } = &change
        {
            let account_id = sqlx::query_scalar!(
                r#"
                INSERT INTO provider_accounts
                    (id, provider, external_account_id, display_email, display_org, plan)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (provider, external_account_id) DO UPDATE
                SET display_email = EXCLUDED.display_email,
                    display_org = EXCLUDED.display_org,
                    plan = EXCLUDED.plan,
                    last_seen_at = now()
                RETURNING id
                "#,
                Uuid::now_v7(),
                provider.as_ref(),
                account.external_account_id,
                account.display_email,
                account.display_org,
                account.plan,
            )
            .fetch_one(&mut *tx)
            .await
            .map_err(internal("failed to record the provider account"))?;
            sqlx::query!(
                r#"
                INSERT INTO harness_account_logins
                    (id, harness_id, provider_account_id, provider, signed_in_by)
                VALUES ($1, $2, $3, $4, $5)
                "#,
                Uuid::now_v7(),
                harness_id.as_uuid(),
                account_id,
                provider.as_ref(),
                signed_in_by.as_ref(),
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
                   login.signed_out_at, account.id AS account_id, account.provider,
                   account.external_account_id, account.display_email, account.display_org,
                   account.plan
            FROM harness_account_logins login
            JOIN provider_accounts account ON account.id = login.provider_account_id
            WHERE login.harness_id = $1 AND login.provider = $2 AND login.signed_out_at IS NULL
            "#,
            harness_id.as_uuid(),
            provider.as_ref(),
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
                provider: row.provider.parse().map_err(|_| invalid("provider"))?,
                identity: ProviderAccountIdentity {
                    external_account_id: row.external_account_id,
                    display_email: row.display_email,
                    display_org: row.display_org,
                    plan: row.plan,
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
