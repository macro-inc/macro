//! Postgres adapter for every WhatsApp repository port. DSS and the session
//! service each build one over the shared MacroDB pool. It writes the
//! generic `external_chat*` tables with `external_chat`'s helpers.

use crate::domain::{events::SessionScope, models::*};
pub(crate) use external_chat::{
    domain::{models::*, ports::ExternalChatResult},
    outbound::pg::{
        ChatRow, chat_ref, corrupt, decode, failure, helper_failure, lock_chat_in, notify,
        notify_change,
    },
    signals::Change,
};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

mod accounts;
mod adoptions;
mod chats;
mod groups;
mod ingest;
mod lookups;
mod media;
mod sends;
mod session;
#[cfg(test)]
mod test;

use crate::signals;

/// Repository over MacroDB.
#[derive(Clone)]
pub struct PgWhatsAppRepository {
    pool: PgPool,
}

impl PgWhatsAppRepository {
    /// Wrap the shared pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

pub(crate) fn account_state(value: &str) -> ExternalChatResult<AccountState> {
    AccountState::parse(value).ok_or_else(|| corrupt(format_args!("account state {value:?}")))
}

/// The account a lease holder acts for, locked for the rest of the transaction.
pub(crate) struct Fenced {
    pub id: Uuid,
    pub user_id: String,
    pub identity_jid: Option<String>,
    pub state: AccountState,
    pub generation: i64,
}

/// Lock the account in share mode at this lease epoch, or fail with `Fenced`.
pub(crate) async fn fence_in(
    tx: &mut Transaction<'_, Postgres>,
    scope: SessionScope,
) -> ExternalChatResult<Fenced> {
    let row = sqlx::query!(
        "SELECT id, user_id, identity_jid, state, generation FROM whatsapp_linked_account WHERE id = $1 AND lease_epoch = $2 FOR SHARE",
        scope.account_id,
        scope.lease_epoch
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(failure)?
    .ok_or(ExternalChatError::Fenced)?;
    Ok(Fenced {
        id: row.id,
        user_id: row.user_id,
        identity_jid: row.identity_jid,
        state: account_state(&row.state)?,
        generation: row.generation,
    })
}

/// Lock the account exclusively at this lease epoch, for transitions that
/// update the account row itself.
pub(crate) async fn fence_exclusive_in(
    tx: &mut Transaction<'_, Postgres>,
    scope: SessionScope,
) -> ExternalChatResult<Fenced> {
    let row = sqlx::query!(
        "SELECT id, user_id, identity_jid, state, generation FROM whatsapp_linked_account WHERE id = $1 AND lease_epoch = $2 FOR NO KEY UPDATE",
        scope.account_id,
        scope.lease_epoch
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(failure)?
    .ok_or(ExternalChatError::Fenced)?;
    Ok(Fenced {
        id: row.id,
        user_id: row.user_id,
        identity_jid: row.identity_jid,
        state: account_state(&row.state)?,
        generation: row.generation,
    })
}

/// End consent for the account's current generation: lifecycle state, a new
/// generation, cancelled pairings, ended memberships and failed undispatched sends.
pub(crate) async fn end_consent_in(
    tx: &mut Transaction<'_, Postgres>,
    account: Uuid,
    state: AccountState,
    error_code: &str,
) -> ExternalChatResult<()> {
    sqlx::query!(
        "UPDATE whatsapp_linked_account SET state = $2, generation = generation + 1, updated_at = now() WHERE id = $1",
        account,
        state.as_str()
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    sqlx::query!(
        "UPDATE whatsapp_pairing SET state = 'cancelled', consumed_at = clock_timestamp(), qr_code = NULL, pair_code = NULL, passkey_challenge = NULL, passkey_response = NULL, updated_at = now() WHERE account_id = $1 AND consumed_at IS NULL",
        account
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    sqlx::query!(
        "UPDATE whatsapp_chat_membership SET consent_ended_at = COALESCE(consent_ended_at, now()) WHERE account_id = $1",
        account
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    sqlx::query!(
        "UPDATE whatsapp_send SET state = 'failed', error_code = $2, claimed_epoch = NULL, updated_at = now() WHERE account_id = $1 AND dispatch_started_at IS NULL AND state IN ('pending', 'sending')",
        account,
        error_code
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    // The chat list and rosters were this consent's view of WhatsApp; a
    // relink (perhaps with another number) starts from its own history sync.
    sqlx::query!("DELETE FROM whatsapp_chat WHERE account_id = $1", account)
        .execute(&mut **tx)
        .await
        .map_err(failure)?;
    sqlx::query!("DELETE FROM whatsapp_roster WHERE account_id = $1", account)
        .execute(&mut **tx)
        .await
        .map_err(failure)?;
    sqlx::query!("DELETE FROM whatsapp_lookup WHERE account_id = $1", account)
        .execute(&mut **tx)
        .await
        .map_err(failure)?;
    Ok(())
}
