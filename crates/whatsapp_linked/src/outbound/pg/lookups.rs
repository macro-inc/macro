//! Phone-number lookups: DSS records the owner's request, the account's
//! session records WhatsApp's answer.

use super::*;
use crate::domain::{
    events::{ChatUpdate, LookupAnswer, LookupWork},
    jid::PhoneNumber,
};

struct LookupRow {
    id: Uuid,
    phone_number: String,
    state: String,
    chat_jid: Option<String>,
}

fn lookup(row: LookupRow) -> ExternalChatResult<Lookup> {
    Ok(Lookup {
        id: row.id,
        phone_number: row.phone_number,
        state: LookupState::parse(&row.state)
            .ok_or_else(|| corrupt(format_args!("lookup state {:?}", row.state)))?,
        chat_jid: row.chat_jid,
    })
}

pub(super) async fn begin_lookup(
    pool: &PgPool,
    account: &Account,
    phone: &PhoneNumber,
) -> ExternalChatResult<Lookup> {
    let mut tx = pool.begin().await.map_err(failure)?;
    // Serializes the budget check per account.
    let current = sqlx::query!(
        "SELECT state, generation FROM whatsapp_linked_account WHERE id = $1 FOR NO KEY UPDATE",
        account.id
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(failure)?
    .ok_or(ExternalChatError::Disconnected)?;
    if account_state(&current.state)? != AccountState::Connected
        || current.generation != account.authorization_generation
    {
        return Err(ExternalChatError::Disconnected.into());
    }
    let pending = sqlx::query_as!(
        LookupRow,
        r#"SELECT id, phone_number, state, chat_jid FROM whatsapp_lookup
        WHERE account_id = $1 AND phone_number = $2 AND state = 'pending'
          AND created_at > now() - make_interval(secs => $3)
        ORDER BY created_at DESC LIMIT 1"#,
        account.id,
        phone.as_str(),
        f64::from(LOOKUP_EXPIRY_SECONDS)
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(failure)?;
    let row = match pending {
        Some(row) => row,
        None => {
            let started = sqlx::query_scalar!(
                r#"SELECT count(*) AS "count!" FROM whatsapp_lookup
                WHERE account_id = $1 AND created_at > now() - make_interval(mins => $2)"#,
                account.id,
                LOOKUP_WINDOW_MINUTES
            )
            .fetch_one(&mut *tx)
            .await
            .map_err(failure)?;
            if started >= LOOKUP_LIMIT {
                return Err(ExternalChatError::RateLimited.into());
            }
            sqlx::query_as!(
                LookupRow,
                r#"INSERT INTO whatsapp_lookup (id, account_id, phone_number, state)
                VALUES ($1, $2, $3, 'pending')
                RETURNING id, phone_number, state, chat_jid"#,
                Uuid::now_v7(),
                account.id,
                phone.as_str()
            )
            .fetch_one(&mut *tx)
            .await
            .map_err(failure)?
        }
    };
    notify(&mut tx, signals::LOOKUP_REQUESTED, account.id).await?;
    tx.commit().await.map_err(failure)?;
    lookup(row)
}

pub(super) async fn lookup_of(
    pool: &PgPool,
    account: Uuid,
    id: Uuid,
) -> ExternalChatResult<Lookup> {
    let row = sqlx::query_as!(
        LookupRow,
        r#"SELECT id, phone_number, chat_jid,
            CASE WHEN state = 'pending' AND created_at <= now() - make_interval(secs => $3)
                THEN 'failed' ELSE state END AS "state!"
        FROM whatsapp_lookup WHERE id = $1 AND account_id = $2"#,
        id,
        account,
        f64::from(LOOKUP_EXPIRY_SECONDS)
    )
    .fetch_optional(pool)
    .await
    .map_err(failure)?
    .ok_or(ExternalChatError::NotFound)?;
    lookup(row)
}

pub(super) async fn pending_lookups_in(
    tx: &mut Transaction<'_, Postgres>,
    account: &Fenced,
) -> ExternalChatResult<Vec<LookupWork>> {
    sqlx::query!(
        r#"SELECT id, phone_number FROM whatsapp_lookup
        WHERE account_id = $1 AND state = 'pending'
          AND created_at > now() - make_interval(secs => $2)
        ORDER BY created_at, id"#,
        account.id,
        f64::from(LOOKUP_EXPIRY_SECONDS)
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(failure)?
    .into_iter()
    .map(|row| {
        Ok(LookupWork {
            id: row.id,
            phone_number: PhoneNumber::parse(&row.phone_number)
                .ok_or_else(|| corrupt(format_args!("lookup phone number")))?,
        })
    })
    .collect()
}

pub(super) async fn complete_lookup_in(
    tx: &mut Transaction<'_, Postgres>,
    account: &Fenced,
    id: Uuid,
    answer: &LookupAnswer,
) -> ExternalChatResult<()> {
    let (state, jid, name) = match answer {
        LookupAnswer::Found { jid, name } => (LookupState::Found, Some(jid), name.clone()),
        LookupAnswer::NotOnWhatsApp => (LookupState::NotOnWhatsApp, None, None),
        LookupAnswer::Failed => (LookupState::Failed, None, None),
    };
    let completed = sqlx::query_scalar!(
        r#"UPDATE whatsapp_lookup SET state = $3, chat_jid = $4, completed_at = now()
        WHERE id = $1 AND account_id = $2 AND state = 'pending'
          AND created_at > now() - make_interval(secs => $5)
        RETURNING id"#,
        id,
        account.id,
        state.as_str(),
        jid,
        f64::from(LOOKUP_EXPIRY_SECONDS)
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(failure)?;
    if let (Some(_), Some(jid)) = (completed, jid) {
        super::chats::update_chats_in(
            tx,
            account,
            &[ChatUpdate {
                jid: jid.clone(),
                kind: ExternalChatKind::Direct,
                name,
                last_activity_at: None,
                archived: None,
                pinned: None,
                anchor: None,
                create: true,
            }],
        )
        .await?;
    }
    Ok(())
}
