//! The account's WhatsApp chat list and importing earlier messages of added
//! groups from the owner's phone.

use super::*;
use crate::domain::events::{BackfillWork, ChatUpdate, HistoryPage, MessageAnchor};
use crate::domain::ports::StoredChat;
use chrono::{Duration, Utc};

/// Several updates of one chat in a batch, as one.
fn merge(into: &mut ChatUpdate, update: &ChatUpdate) {
    if !into.create && update.create {
        into.kind = update.kind;
    }
    into.create |= update.create;
    into.name = update.name.clone().or(into.name.take());
    into.last_activity_at = into.last_activity_at.max(update.last_activity_at);
    into.archived = update.archived.or(into.archived);
    into.pinned = update.pinned.or(into.pinned);
    if update
        .anchor
        .as_ref()
        .is_some_and(|anchor| into.anchor.as_ref().is_none_or(|kept| kept.at <= anchor.at))
    {
        into.anchor = update.anchor.clone();
    }
}

/// Upsert chat-list rows in a few statements for the whole batch; signal the
/// owner's list once if any row changed. A message for an added chat that was
/// waiting for one makes it ready to import (`waiting_for_phone`).
pub(super) async fn update_chats_in(
    tx: &mut Transaction<'_, Postgres>,
    account: &Fenced,
    chats: &[ChatUpdate],
) -> ExternalChatResult<()> {
    let mut merged: std::collections::BTreeMap<String, ChatUpdate> = Default::default();
    for chat in chats {
        let mut chat = chat.clone();
        chat.name = chat
            .name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(|name| name.chars().take(256).collect::<String>());
        match merged.get_mut(&chat.jid) {
            Some(kept) => merge(kept, &chat),
            None => {
                merged.insert(chat.jid.clone(), chat);
            }
        }
    }
    let (created, updated): (Vec<&ChatUpdate>, Vec<&ChatUpdate>) =
        merged.values().partition(|chat| chat.create);
    let anchors = created
        .iter()
        .map(|chat| chat.anchor.as_ref().map(serde_json::to_value).transpose())
        .collect::<Result<Vec<_>, _>>()
        .map_err(failure)?;
    let inserted = sqlx::query!(
        r#"WITH input AS (
            SELECT * FROM UNNEST($2::text[], $3::text[], $4::text[], $5::timestamptz[], $6::bool[], $7::bool[], $8::jsonb[])
                AS i(chat_jid, kind, name, last_activity_at, archived, pinned, anchor))
        INSERT INTO whatsapp_chat AS c (account_id, chat_jid, kind, name, last_activity_at, archived, pinned, anchor)
        SELECT $1, i.chat_jid, i.kind, i.name, i.last_activity_at, COALESCE(i.archived, false), COALESCE(i.pinned, false), i.anchor
        FROM input i
        ON CONFLICT (account_id, chat_jid) DO UPDATE SET
            name = COALESCE(excluded.name, c.name),
            last_activity_at = GREATEST(c.last_activity_at, excluded.last_activity_at),
            archived = COALESCE((SELECT i.archived FROM input i WHERE i.chat_jid = excluded.chat_jid), c.archived),
            pinned = COALESCE((SELECT i.pinned FROM input i WHERE i.chat_jid = excluded.chat_jid), c.pinned),
            anchor = CASE WHEN excluded.anchor IS NOT NULL AND (c.anchor IS NULL
                OR (excluded.anchor->>'at')::timestamptz >= (c.anchor->>'at')::timestamptz)
                THEN excluded.anchor ELSE c.anchor END,
            updated_at = now()
        WHERE c.name IS DISTINCT FROM COALESCE(excluded.name, c.name)
           OR c.last_activity_at IS DISTINCT FROM GREATEST(c.last_activity_at, excluded.last_activity_at)
           OR c.archived IS DISTINCT FROM COALESCE((SELECT i.archived FROM input i WHERE i.chat_jid = excluded.chat_jid), c.archived)
           OR c.pinned IS DISTINCT FROM COALESCE((SELECT i.pinned FROM input i WHERE i.chat_jid = excluded.chat_jid), c.pinned)
           OR (excluded.anchor IS NOT NULL AND c.anchor IS DISTINCT FROM excluded.anchor AND (c.anchor IS NULL
               OR (excluded.anchor->>'at')::timestamptz >= (c.anchor->>'at')::timestamptz))"#,
        account.id,
        &created.iter().map(|chat| chat.jid.clone()).collect::<Vec<_>>(),
        &created.iter().map(|chat| chat.kind.as_ref().to_owned()).collect::<Vec<_>>(),
        &created.iter().map(|chat| chat.name.clone()).collect::<Vec<_>>() as &[Option<String>],
        &created.iter().map(|chat| chat.last_activity_at).collect::<Vec<_>>() as &[Option<chrono::DateTime<Utc>>],
        &created.iter().map(|chat| chat.archived).collect::<Vec<_>>() as &[Option<bool>],
        &created.iter().map(|chat| chat.pinned).collect::<Vec<_>>() as &[Option<bool>],
        &anchors as &[Option<serde_json::Value>],
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?
    .rows_affected();
    let renamed_rows = sqlx::query!(
        r#"UPDATE whatsapp_chat c SET
            name = COALESCE(i.name, c.name),
            last_activity_at = GREATEST(c.last_activity_at, i.last_activity_at),
            archived = COALESCE(i.archived, c.archived),
            pinned = COALESCE(i.pinned, c.pinned),
            updated_at = now()
        FROM UNNEST($2::text[], $3::text[], $4::timestamptz[], $5::bool[], $6::bool[])
            AS i(chat_jid, name, last_activity_at, archived, pinned)
        WHERE c.account_id = $1 AND c.chat_jid = i.chat_jid
          AND (c.name IS DISTINCT FROM COALESCE(i.name, c.name)
            OR c.last_activity_at IS DISTINCT FROM GREATEST(c.last_activity_at, i.last_activity_at)
            OR c.archived IS DISTINCT FROM COALESCE(i.archived, c.archived)
            OR c.pinned IS DISTINCT FROM COALESCE(i.pinned, c.pinned))"#,
        account.id,
        &updated
            .iter()
            .map(|chat| chat.jid.clone())
            .collect::<Vec<_>>(),
        &updated
            .iter()
            .map(|chat| chat.name.clone())
            .collect::<Vec<_>>() as &[Option<String>],
        &updated
            .iter()
            .map(|chat| chat.last_activity_at)
            .collect::<Vec<_>>() as &[Option<chrono::DateTime<Utc>>],
        &updated.iter().map(|chat| chat.archived).collect::<Vec<_>>() as &[Option<bool>],
        &updated.iter().map(|chat| chat.pinned).collect::<Vec<_>>() as &[Option<bool>],
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?
    .rows_affected();
    let changed = inserted + renamed_rows > 0;
    let (anchored_jids, anchored_at): (Vec<String>, Vec<chrono::DateTime<Utc>>) = merged
        .values()
        .filter_map(|chat| Some((chat.jid.clone(), chat.anchor.as_ref()?.at)))
        .unzip();
    // A chat waiting for its first message can be imported now. So can a
    // direct chat added with nothing to import once a message older than its
    // adoption shows the phone has earlier history after all; newer messages
    // arrive live. Either waits for the owner to import (the phone is only
    // asked then).
    let ready = sqlx::query_scalar!(
        r#"UPDATE external_chat g SET backfill_state = 'waiting_for_phone'
        FROM UNNEST($2::text[], $3::timestamptz[]) AS i(jid, at)
        WHERE g.user_id = $1 AND g.provider = 'whatsapp' AND g.remote_id = i.jid AND g.state = 'active'
          AND (g.backfill_state = 'waiting_for_message'
            OR (g.kind = 'direct' AND g.backfill_state = 'done' AND g.backfill_imported = 0
                AND g.backfill_cursor IS NULL AND i.at < g.adopted_at))
        RETURNING g.id"#,
        account.user_id,
        &anchored_jids,
        &anchored_at
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(failure)?;
    // The owner's added direct chats follow the person's name.
    let named: Vec<(String, String)> = merged
        .values()
        .filter(|chat| chat.kind == ExternalChatKind::Direct)
        .filter_map(|chat| Some((chat.jid.clone(), chat.name.clone()?)))
        .collect();
    let renamed = sqlx::query_scalar!(
        r#"UPDATE external_chat g SET name = i.name
        FROM UNNEST($2::text[], $3::text[]) AS i(jid, name)
        WHERE g.user_id = $1 AND g.provider = 'whatsapp' AND g.remote_id = i.jid AND g.kind = 'direct' AND g.state = 'active'
          AND g.name <> i.name
        RETURNING g.id"#,
        account.user_id,
        &named.iter().map(|(jid, _)| jid.clone()).collect::<Vec<_>>(),
        &named.iter().map(|(_, name)| name.clone()).collect::<Vec<_>>(),
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(failure)?;
    for chat_id in ready.into_iter().chain(renamed) {
        notify_change(tx, Change::Chat { chat_id }).await?;
    }
    if changed {
        notify_change(
            tx,
            Change::Chats {
                account_id: account.id,
            },
        )
        .await?;
    }
    Ok(())
}

/// The owner's Import: chats waiting for the phone start importing, and the
/// account's replica is asked to request their pages. A chat waiting for its
/// first message starts too, in case a stored message anchors it; without
/// one the replica puts it back.
pub(super) async fn import_history(pool: &PgPool, account: &Account) -> ExternalChatResult<u32> {
    let mut tx = pool.begin().await.map_err(failure)?;
    let current = sqlx::query!(
        "SELECT state, generation FROM whatsapp_linked_account WHERE id = $1 FOR SHARE",
        account.id
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(failure)?
    .ok_or(ExternalChatError::Disconnected)?;
    if super::account_state(&current.state)? != AccountState::Connected
        || current.generation != account.authorization_generation
    {
        return Err(ExternalChatError::Disconnected.into());
    }
    let started = sqlx::query_scalar!(
        r#"UPDATE external_chat SET backfill_state = 'pending', backfill_requested_at = NULL
        WHERE user_id = $1 AND provider = 'whatsapp' AND state = 'active'
          AND backfill_state IN ('waiting_for_phone', 'waiting_for_message')
        RETURNING id"#,
        account.user_id
    )
    .fetch_all(&mut *tx)
    .await
    .map_err(failure)?;
    for chat_id in &started {
        notify_change(&mut tx, Change::Chat { chat_id: *chat_id }).await?;
    }
    if !started.is_empty() {
        notify(&mut tx, signals::HISTORY_REQUESTED, account.id).await?;
    }
    tx.commit().await.map_err(failure)?;
    Ok(u32::try_from(started.len()).unwrap_or(u32::MAX))
}

pub(super) async fn account_chats(
    pool: &PgPool,
    account: Uuid,
) -> ExternalChatResult<Vec<StoredChat>> {
    sqlx::query!(
        r#"SELECT chat_jid, kind, name, last_activity_at, archived, pinned FROM whatsapp_chat
        WHERE account_id = $1 ORDER BY last_activity_at DESC NULLS LAST, chat_jid LIMIT 5000"#,
        account
    )
    .fetch_all(pool)
    .await
    .map_err(failure)?
    .into_iter()
    .map(|row| {
        Ok(StoredChat {
            kind: row
                .kind
                .parse::<ExternalChatKind>()
                .ok()
                .ok_or_else(|| corrupt(format_args!("kind {:?}", row.kind)))?,
            jid: row.chat_jid,
            name: row.name,
            last_activity_at: row.last_activity_at,
            archived: row.archived,
            pinned: row.pinned,
        })
    })
    .collect()
}

fn backfill_state(value: &str) -> ExternalChatResult<BackfillState> {
    BackfillState::parse(value).ok_or_else(|| corrupt(format_args!("backfill state {value:?}")))
}

pub(super) async fn backfill_work_in(
    tx: &mut Transaction<'_, Postgres>,
    account: &Fenced,
) -> ExternalChatResult<Vec<BackfillWork>> {
    // The anchor is the chat list's newest message, else the newest message
    // of the chat stored in Macro that this account saw (in this group, or in
    // an earlier or someone else's group for the same chat).
    sqlx::query!(
        r#"SELECT g.id, g.remote_id, g.backfill_state AS "state!", g.backfill_imported, g.backfill_cursor,
            g.adopted_at, g.backfill_requested_at, COALESCE(c.anchor, stored.anchor) AS "anchor?"
        FROM external_chat g
        LEFT JOIN whatsapp_chat c ON c.account_id = $1 AND c.chat_jid = g.remote_id
        LEFT JOIN LATERAL (
            SELECT jsonb_build_object(
                'id', m.source_id,
                'at', m.source_at,
                'fromMe', EXISTS (SELECT 1 FROM whatsapp_identity_alias a
                    WHERE a.chat_id = m.chat_id AND a.person_id = m.person_id AND a.jid = $3),
                'senderJid', (SELECT a.jid FROM whatsapp_identity_alias a
                    WHERE a.chat_id = m.chat_id AND a.person_id = m.person_id
                    ORDER BY a.jid LIKE '%@lid' DESC, a.jid LIMIT 1)) AS anchor
            FROM external_chat_message m JOIN external_chat other ON other.id = m.chat_id
            WHERE c.anchor IS NULL AND other.remote_id = g.remote_id
              AND m.kind = 'message' AND m.message_id IS NOT NULL
              AND (m.chat_id = g.id OR EXISTS (SELECT 1 FROM whatsapp_message_observation o
                  WHERE o.chat_id = m.chat_id AND o.person_id = m.person_id
                    AND o.source_id = m.source_id AND o.account_id = $1))
            ORDER BY m.source_at DESC, m.id DESC LIMIT 1
        ) stored ON true
        WHERE g.user_id = $2 AND g.state = 'active'
          AND g.backfill_state IN ('pending', 'running')
        ORDER BY g.adopted_at, g.id LIMIT 20"#,
        account.id,
        account.user_id,
        account.identity_jid
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(failure)?
    .into_iter()
    .map(|row| {
        Ok(BackfillWork {
            chat_id: row.id,
            group_jid: row.remote_id,
            state: backfill_state(&row.state)?,
            imported: row.backfill_imported.max(0) as u32,
            cursor: row.backfill_cursor.map(decode).transpose()?,
            anchor: row.anchor.map(decode).transpose()?,
            adopted_at: row.adopted_at,
            requested_at: row.backfill_requested_at,
        })
    })
    .collect()
}

/// Move one of the owner's importing groups to `state`, stamping the request
/// time when asked. Signals the group's viewers when the state changed.
pub(super) async fn set_backfill_in(
    tx: &mut Transaction<'_, Postgres>,
    account: &Fenced,
    group: Uuid,
    state: BackfillState,
    stamp_request: bool,
) -> ExternalChatResult<()> {
    let previous = sqlx::query_scalar!(
        r#"UPDATE external_chat g SET backfill_state = $3,
            backfill_requested_at = CASE WHEN $4 THEN now() ELSE g.backfill_requested_at END
        FROM (SELECT id, backfill_state FROM external_chat WHERE id = $1 FOR UPDATE) old
        WHERE g.id = old.id AND g.user_id = $2
          AND g.backfill_state IN ('waiting_for_message', 'pending', 'running', 'waiting_for_phone')
        RETURNING old.backfill_state AS "previous!""#,
        group,
        account.user_id,
        state.as_str(),
        stamp_request
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(failure)?;
    if previous.is_some_and(|previous| previous != state.as_str()) {
        notify_change(tx, Change::Chat { chat_id: group }).await?;
    }
    Ok(())
}

/// What a page means for one group: the new cursor, count and state.
fn after_page(
    page: &HistoryPage,
    imported: u32,
    cursor: Option<MessageAnchor>,
    adopted_at: chrono::DateTime<Utc>,
) -> (u32, Option<MessageAnchor>, BackfillState) {
    let imported = imported.saturating_add(page.messages);
    let moved = page.oldest.as_ref().is_some_and(|oldest| {
        cursor
            .as_ref()
            .is_none_or(|cursor| oldest.id != cursor.id && oldest.at <= cursor.at)
    });
    let cursor = if moved { page.oldest.clone() } else { cursor };
    let state = if page.complete || page.messages == 0 || !moved {
        BackfillState::Done
    } else if imported >= BACKFILL_MESSAGE_LIMIT
        || cursor
            .as_ref()
            .is_some_and(|cursor| cursor.at < adopted_at - Duration::days(BACKFILL_MAX_AGE_DAYS))
    {
        BackfillState::Partial
    } else {
        BackfillState::Running
    };
    (imported, cursor, state)
}

pub(super) async fn backfill_page_in(
    tx: &mut Transaction<'_, Postgres>,
    account: &Fenced,
    page: &HistoryPage,
) -> ExternalChatResult<Vec<(Uuid, BackfillState)>> {
    let rows = sqlx::query!(
        r#"SELECT id, backfill_imported, backfill_cursor, adopted_at FROM external_chat
        WHERE user_id = $1 AND provider = 'whatsapp' AND remote_id = $2 AND state = 'active'
          AND backfill_state IN ('waiting_for_message', 'pending', 'running', 'waiting_for_phone')
        ORDER BY id FOR UPDATE"#,
        account.user_id,
        page.chat_jid
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(failure)?;
    let mut states = Vec::with_capacity(rows.len());
    for row in rows {
        let cursor: Option<MessageAnchor> = row.backfill_cursor.map(decode).transpose()?;
        let (imported, cursor, state) = after_page(
            page,
            row.backfill_imported.max(0) as u32,
            cursor,
            row.adopted_at,
        );
        let cursor = cursor
            .as_ref()
            .map(serde_json::to_value)
            .transpose()
            .map_err(failure)?;
        // A running group is ready for its next page: no request outstanding.
        sqlx::query!(
            r#"UPDATE external_chat SET backfill_state = $2, backfill_imported = $3, backfill_cursor = $4,
                backfill_requested_at = NULL
            WHERE id = $1"#,
            row.id,
            state.as_str(),
            i32::try_from(imported).unwrap_or(i32::MAX),
            cursor
        )
        .execute(&mut **tx)
        .await
        .map_err(failure)?;
        notify_change(tx, Change::Chat { chat_id: row.id }).await?;
        states.push((row.id, state));
    }
    Ok(states)
}

#[cfg(test)]
mod test;
