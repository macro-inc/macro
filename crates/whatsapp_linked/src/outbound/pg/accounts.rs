//! Owner-scoped account and pairing transitions (DSS side).

use super::*;
use crate::domain::ports::AccountRepository;
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;

/// Pairing transactions last this long.
const PAIRING_SECONDS: f64 = 5.0 * 60.0;

pub(super) async fn account_by_user_in(
    executor: impl sqlx::PgExecutor<'_>,
    user: &str,
) -> ExternalChatResult<Option<Account>> {
    sqlx::query!(
        "SELECT id, user_id, identity_jid, state, generation FROM whatsapp_linked_account WHERE user_id = $1",
        user
    )
    .fetch_optional(executor)
    .await
    .map_err(failure)?
    .map(|row| {
        Ok(Account {
            id: row.id,
            user_id: row.user_id,
            identity_jid: row.identity_jid,
            state: account_state(&row.state)?,
            authorization_generation: row.generation,
        })
    })
    .transpose()
}

/// Expire unconsumed transactions past their deadline, for one user or one
/// transaction. A pairing account whose consent attempt expired is disconnected.
pub(super) async fn expire_pairings_in(
    tx: &mut Transaction<'_, Postgres>,
    user: Option<&str>,
    pairing: Option<Uuid>,
    account: Option<Uuid>,
) -> ExternalChatResult<()> {
    // Pairing transitions always acquire accounts before pairing rows. Global
    // expiry locks all affected accounts in order; scoped callers never sweep
    // other accounts while holding their own fence.
    let locked = sqlx::query_scalar!(
        r#"SELECT a.id FROM whatsapp_linked_account a WHERE EXISTS (
            SELECT 1 FROM whatsapp_pairing p WHERE p.account_id = a.id
              AND p.consumed_at IS NULL
              AND ($1::text IS NULL OR p.user_id = $1) AND ($2::uuid IS NULL OR p.id = $2)
              AND ($3::uuid IS NULL OR p.account_id = $3)) ORDER BY a.id FOR UPDATE"#,
        user,
        pairing,
        account
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(failure)?;
    let expired = sqlx::query!(
        r#"UPDATE whatsapp_pairing SET state = 'expired', consumed_at = clock_timestamp(), qr_code = NULL, pair_code = NULL, passkey_challenge = NULL, passkey_response = NULL, updated_at = now()
        WHERE consumed_at IS NULL AND expires_at <= clock_timestamp()
          AND ($1::text IS NULL OR user_id = $1) AND ($2::uuid IS NULL OR id = $2)
          AND account_id = ANY($3)
        RETURNING account_id, generation"#,
        user,
        pairing,
        &locked
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(failure)?;
    for row in expired {
        sqlx::query!(
            "UPDATE whatsapp_linked_account SET state = 'disconnected', generation = generation + 1, updated_at = now() WHERE id = $1 AND generation = $2 AND state = 'pairing'",
            row.account_id,
            row.generation
        )
        .execute(&mut **tx)
        .await
        .map_err(failure)?;
    }
    Ok(())
}

struct PairingRow {
    id: Uuid,
    account_id: Uuid,
    state: String,
    expires_at: DateTime<Utc>,
}

fn pairing(row: PairingRow) -> ExternalChatResult<Pairing> {
    Ok(Pairing {
        id: row.id,
        account_id: row.account_id,
        state: PairingState::parse(&row.state)
            .ok_or_else(|| corrupt(format_args!("state {:?}", row.state)))?,
        expires_at: row.expires_at,
    })
}

#[async_trait]
impl AccountRepository for PgWhatsAppRepository {
    async fn owned_account(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> ExternalChatResult<Option<Account>> {
        let user = user.as_ref();
        account_by_user_in(&self.pool, user).await
    }

    async fn begin_pairing(
        &self,
        user: &MacroUserIdStr<'_>,
        replace: bool,
    ) -> ExternalChatResult<Pairing> {
        let user = user.as_ref();
        let mut tx = self.pool.begin().await.map_err(failure)?;
        // Serialize per person, including before their account row exists.
        sqlx::query!(
            "SELECT pg_advisory_xact_lock(hashtextextended('whatsapp-pairing:' || $1, 0))",
            user
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        expire_pairings_in(&mut tx, Some(user), None, None).await?;
        let live = sqlx::query_as!(
            PairingRow,
            "SELECT id, account_id, state, expires_at FROM whatsapp_pairing WHERE user_id = $1 AND consumed_at IS NULL",
            user
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?;
        if let Some(live) = live
            && !replace
        {
            notify(&mut tx, signals::PAIRING_REQUESTED, live.id).await?;
            tx.commit().await.map_err(failure)?;
            return pairing(live);
        }
        let existing = sqlx::query!(
            "SELECT id, identity_jid, state FROM whatsapp_linked_account WHERE user_id = $1 FOR UPDATE",
            user
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?;
        let (account, expected_identity) = match existing {
            None => {
                let id = Uuid::now_v7();
                sqlx::query!(
                    "INSERT INTO whatsapp_linked_account (id, user_id, state) VALUES ($1, $2, 'pairing')",
                    id,
                    user
                )
                .execute(&mut *tx)
                .await
                .map_err(failure)?;
                (id, None)
            }
            Some(existing) if existing.state == "connected" && !replace => {
                return Err(ExternalChatError::Conflict.into());
            }
            Some(existing) => {
                if replace {
                    end_consent_in(
                        &mut tx,
                        existing.id,
                        AccountState::Disconnected,
                        "authorization_ended",
                    )
                    .await?;
                }
                sqlx::query!(
                    "UPDATE whatsapp_linked_account SET state = 'pairing', generation = generation + 1, updated_at = now() WHERE id = $1",
                    existing.id
                )
                .execute(&mut *tx)
                .await
                .map_err(failure)?;
                (
                    existing.id,
                    if replace { None } else { existing.identity_jid },
                )
            }
        };
        let row = sqlx::query_as!(
            PairingRow,
            r#"INSERT INTO whatsapp_pairing (id, account_id, user_id, generation, state, expected_identity_jid, expires_at)
            SELECT $1, a.id, a.user_id, a.generation, 'waiting', $3, clock_timestamp() + make_interval(secs => $4)
            FROM whatsapp_linked_account a WHERE a.id = $2
            RETURNING id, account_id, state, expires_at"#,
            Uuid::now_v7(),
            account,
            expected_identity,
            PAIRING_SECONDS
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(failure)?;
        notify(&mut tx, signals::PAIRING_REQUESTED, row.id).await?;
        tx.commit().await.map_err(failure)?;
        pairing(row)
    }

    async fn pair_state(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
    ) -> ExternalChatResult<PairState> {
        let user = user.as_ref();
        let mut tx = self.pool.begin().await.map_err(failure)?;
        expire_pairings_in(&mut tx, Some(user), Some(id), None).await?;
        let row = sqlx::query!(
            r#"SELECT p.state, p.qr_code, p.pair_code, p.passkey_challenge, p.expires_at, a.identity_jid
            FROM whatsapp_pairing p JOIN whatsapp_linked_account a ON a.id = p.account_id
            WHERE p.id = $1 AND p.user_id = $2"#,
            id,
            user
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?
        .ok_or(ExternalChatError::NotFound)?;
        tx.commit().await.map_err(failure)?;
        let state = PairingState::parse(&row.state)
            .ok_or_else(|| corrupt(format_args!("state {:?}", row.state)))?;
        Ok(PairState {
            state,
            qr: row.qr_code,
            code: row.pair_code,
            challenge: row.passkey_challenge,
            identity_jid: (state == PairingState::Success)
                .then_some(row.identity_jid)
                .flatten(),
            expires_at: row.expires_at,
        })
    }

    async fn submit_passkey(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
        response: &serde_json::Value,
    ) -> ExternalChatResult<()> {
        let user = user.as_ref();
        let mut tx = self.pool.begin().await.map_err(failure)?;
        expire_pairings_in(&mut tx, Some(user), Some(id), None).await?;
        sqlx::query!(
            r#"UPDATE whatsapp_pairing SET passkey_response = $3, updated_at = now()
            WHERE id = $1 AND user_id = $2 AND consumed_at IS NULL AND state = 'passkey'"#,
            id,
            user,
            response
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?
        .rows_affected()
        .eq(&1)
        .then_some(())
        .ok_or(ExternalChatError::NotFound)?;
        notify(&mut tx, signals::PAIRING_REQUESTED, id).await?;
        tx.commit().await.map_err(failure)
    }

    async fn cancel_pairing(&self, user: &MacroUserIdStr<'_>, id: Uuid) -> ExternalChatResult<()> {
        let user = user.as_ref();
        let mut tx = self.pool.begin().await.map_err(failure)?;
        sqlx::query!(
            "SELECT id FROM whatsapp_linked_account WHERE user_id = $1 FOR UPDATE",
            user
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?;
        let cancelled = sqlx::query!(
            r#"UPDATE whatsapp_pairing SET state = 'cancelled', consumed_at = clock_timestamp(), qr_code = NULL, pair_code = NULL, passkey_challenge = NULL, passkey_response = NULL, updated_at = now()
            WHERE id = $1 AND user_id = $2 AND consumed_at IS NULL
            RETURNING account_id, generation"#,
            id,
            user
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?;
        match cancelled {
            Some(row) => {
                sqlx::query!(
                    "UPDATE whatsapp_linked_account SET state = 'disconnected', generation = generation + 1, updated_at = now() WHERE id = $1 AND generation = $2 AND state = 'pairing'",
                    row.account_id,
                    row.generation
                )
                .execute(&mut *tx)
                .await
                .map_err(failure)?;
                notify(&mut tx, signals::PAIRING_REQUESTED, id).await?;
            }
            None => {
                sqlx::query_scalar!(
                    "SELECT id FROM whatsapp_pairing WHERE id = $1 AND user_id = $2",
                    id,
                    user
                )
                .fetch_optional(&mut *tx)
                .await
                .map_err(failure)?
                .ok_or(ExternalChatError::NotFound)?;
            }
        }
        tx.commit().await.map_err(failure)
    }

    async fn disconnect(
        &self,
        user: &MacroUserIdStr<'_>,
        generation: i64,
    ) -> ExternalChatResult<bool> {
        let user = user.as_ref();
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = sqlx::query!(
            "SELECT id, state, generation FROM whatsapp_linked_account WHERE user_id = $1 FOR UPDATE",
            user
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?
        .ok_or(ExternalChatError::NotFound)?;
        if account.generation != generation {
            // A retried disconnect of the same generation is a no-op.
            if account.state == "disconnected"
                && generation.checked_add(1) == Some(account.generation)
            {
                return Ok(false);
            }
            return Err(ExternalChatError::Conflict.into());
        }
        end_consent_in(
            &mut tx,
            account.id,
            AccountState::Disconnected,
            "authorization_ended",
        )
        .await?;
        notify(&mut tx, signals::ACCOUNT_CHANGED, account.id).await?;
        tx.commit().await.map_err(failure)?;
        Ok(true)
    }

    async fn account_owner(&self, account: Uuid) -> ExternalChatResult<Option<String>> {
        sqlx::query_scalar!(
            "SELECT user_id FROM whatsapp_linked_account WHERE id = $1",
            account
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(failure)
    }

    async fn expire_retained(&self) -> ExternalChatResult<u64> {
        let receipts = sqlx::query!(
            "DELETE FROM whatsapp_participant_receipt WHERE source_at < now() - make_interval(days => $1)",
            crate::domain::models::RECEIPT_RETENTION_DAYS
        )
        .execute(&self.pool)
        .await
        .map_err(failure)?
        .rows_affected();
        let pairings = sqlx::query!(
            "DELETE FROM whatsapp_pairing WHERE consumed_at < now() - interval '1 day'"
        )
        .execute(&self.pool)
        .await
        .map_err(failure)?
        .rows_affected();
        let lookups = sqlx::query!(
            "DELETE FROM whatsapp_lookup WHERE created_at < now() - make_interval(mins => $1)",
            crate::domain::models::LOOKUP_WINDOW_MINUTES
        )
        .execute(&self.pool)
        .await
        .map_err(failure)?
        .rows_affected();
        Ok(receipts + pairings + lookups)
    }

    async fn begin_lookup(
        &self,
        account: &Account,
        phone: &crate::domain::jid::PhoneNumber,
    ) -> ExternalChatResult<Lookup> {
        lookups::begin_lookup(&self.pool, account, phone).await
    }

    async fn lookup(&self, account: Uuid, lookup: Uuid) -> ExternalChatResult<Lookup> {
        lookups::lookup_of(&self.pool, account, lookup).await
    }

    async fn import_history(&self, account: &Account) -> ExternalChatResult<u32> {
        chats::import_history(&self.pool, account).await
    }
}
