//! Postgres adapter for every Slack repository port. DSS and the session
//! service each build one over the shared MacroDB pool. It writes the
//! generic `external_chat*` tables with `external_chat`'s helpers.

use crate::domain::{events::*, models::*};
pub(crate) use external_chat::{
    domain::{models::*, ports::ExternalChatResult},
    outbound::pg::{ChatRow, chat_ref, corrupt, decode, failure, helper_failure, notify, notify_change},
    signals::Change,
};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

mod accounts;
mod adoptions;
mod catalogue;
mod ingest;
mod logins;
mod sends;
mod session;
#[cfg(test)]
mod test;

use crate::signals;

/// Repository over MacroDB.
#[derive(Clone)]
pub struct PgSlackRepository {
    pool: PgPool,
}

impl PgSlackRepository {
    /// Wrap the shared pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// A stored enum spelling, or a corruption report.
pub(crate) fn parse<Value: std::str::FromStr>(value: &str, what: &str) -> ExternalChatResult<Value> {
    value
        .parse()
        .map_err(|_| corrupt(format_args!("{what} {value:?}")))
}

/// The account a lease holder acts for, locked for the rest of the
/// transaction.
pub(crate) struct Fenced {
    pub id: Uuid,
    pub user_id: String,
    pub slack_user_id: Option<String>,
    pub state: AccountState,
    pub generation: i64,
}

/// Lock the account at this lease epoch (share mode, or exclusively for
/// transitions of the account row), or fail with `Fenced`.
pub(crate) async fn fence_in(
    tx: &mut Transaction<'_, Postgres>,
    scope: SessionScope,
    exclusive: bool,
) -> ExternalChatResult<Fenced> {
    let row = if exclusive {
        sqlx::query!(
            "SELECT id, user_id, slack_user_id, state, generation FROM slack_account WHERE id = $1 AND lease_epoch = $2 FOR NO KEY UPDATE",
            scope.account_id,
            scope.lease_epoch
        )
        .fetch_optional(&mut **tx)
        .await
        .map_err(failure)?
        .map(|row| (row.id, row.user_id, row.slack_user_id, row.state, row.generation))
    } else {
        sqlx::query!(
            "SELECT id, user_id, slack_user_id, state, generation FROM slack_account WHERE id = $1 AND lease_epoch = $2 FOR SHARE",
            scope.account_id,
            scope.lease_epoch
        )
        .fetch_optional(&mut **tx)
        .await
        .map_err(failure)?
        .map(|row| (row.id, row.user_id, row.slack_user_id, row.state, row.generation))
    };
    let (id, user_id, slack_user_id, state, generation) =
        row.ok_or(ExternalChatError::Fenced)?;
    Ok(Fenced {
        id,
        user_id,
        slack_user_id,
        state: parse(&state, "account state")?,
        generation,
    })
}

/// End consent for the account's current generation: lifecycle state, a new
/// generation, ended memberships and failed undispatched sends. Credentials
/// stay only for a requested sign-out.
pub(crate) async fn end_consent_in(
    tx: &mut Transaction<'_, Postgres>,
    account: Uuid,
    state: AccountState,
    reason: Option<EndedReason>,
    keep_credentials_for_sign_out: bool,
) -> ExternalChatResult<()> {
    let state: &'static str = state.into();
    let reason: Option<&'static str> = reason.map(Into::into);
    sqlx::query!(
        r#"UPDATE slack_account SET state = $2, ended_reason = $3, generation = generation + 1,
            sign_out_requested = $4,
            credentials = CASE WHEN $4 THEN credentials END,
            data_key_ciphertext = CASE WHEN $4 THEN data_key_ciphertext END,
            kms_key_id = CASE WHEN $4 THEN kms_key_id END,
            encryption_version = CASE WHEN $4 THEN encryption_version END,
            updated_at = now()
        WHERE id = $1"#,
        account,
        state,
        reason,
        keep_credentials_for_sign_out
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    sqlx::query!(
        "UPDATE slack_chat_membership SET consent_ended_at = COALESCE(consent_ended_at, now()) WHERE account_id = $1",
        account
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    sqlx::query!(
        "UPDATE slack_send SET state = 'failed', error_code = 'disconnected', claimed_epoch = NULL, updated_at = now() WHERE account_id = $1 AND dispatch_started_at IS NULL AND state IN ('pending', 'sending')",
        account
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    sqlx::query!("DELETE FROM slack_read_mark WHERE account_id = $1", account)
        .execute(&mut **tx)
        .await
        .map_err(failure)?;
    notify(tx, signals::ACCOUNT_CHANGED, account).await?;
    notify_change(tx, Change::Chats { account_id: account }).await
}

/// The stored secret in its four columns, when present.
pub(crate) fn stored_secret(
    ciphertext: Option<Vec<u8>>,
    data_key: Option<Vec<u8>>,
    kms_key_id: Option<String>,
    encryption_version: Option<i16>,
) -> Option<StoredSecret> {
    Some(StoredSecret {
        ciphertext: ciphertext?,
        data_key: data_key?,
        kms_key_id: kms_key_id?,
        encryption_version: encryption_version?,
    })
}
