//! The account's WhatsApp chat list and importing earlier messages of added
//! groups from the owner's phone.

use super::*;
use crate::domain::events::{BackfillWork, ChatUpdate, HistoryPage, MessageAnchor};
use crate::domain::ports::StoredChat;
use chrono::{Duration, Utc};

/// Upsert chat-list rows; signal the owner's list once if any row changed.
pub(super) async fn update_chats_in(
    tx: &mut Transaction<'_, Postgres>,
    account: &Fenced,
    chats: &[ChatUpdate],
) -> LinkedResult<()> {
    let mut changed = false;
    for chat in chats {
        let anchor = chat
            .anchor
            .as_ref()
            .map(serde_json::to_value)
            .transpose()
            .map_err(failure)?;
        let name = chat
            .name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(|name| name.chars().take(256).collect::<String>());
        let rows = if chat.create {
            sqlx::query!(
                r#"INSERT INTO whatsapp_chat AS c (account_id, chat_jid, kind, name, last_activity_at, archived, pinned, anchor)
                VALUES ($1, $2, $3, $4, $5, COALESCE($6, false), COALESCE($7, false), $8)
                ON CONFLICT (account_id, chat_jid) DO UPDATE SET
                    name = COALESCE(excluded.name, c.name),
                    last_activity_at = GREATEST(c.last_activity_at, excluded.last_activity_at),
                    archived = COALESCE($6, c.archived),
                    pinned = COALESCE($7, c.pinned),
                    anchor = CASE WHEN excluded.anchor IS NOT NULL AND (c.anchor IS NULL
                        OR (excluded.anchor->>'at')::timestamptz >= (c.anchor->>'at')::timestamptz)
                        THEN excluded.anchor ELSE c.anchor END,
                    updated_at = now()
                WHERE c.name IS DISTINCT FROM COALESCE(excluded.name, c.name)
                   OR c.last_activity_at IS DISTINCT FROM GREATEST(c.last_activity_at, excluded.last_activity_at)
                   OR c.archived IS DISTINCT FROM COALESCE($6, c.archived)
                   OR c.pinned IS DISTINCT FROM COALESCE($7, c.pinned)
                   OR (excluded.anchor IS NOT NULL AND c.anchor IS DISTINCT FROM excluded.anchor AND (c.anchor IS NULL
                       OR (excluded.anchor->>'at')::timestamptz >= (c.anchor->>'at')::timestamptz))"#,
                account.id,
                chat.jid,
                chat.kind.as_str(),
                name,
                chat.last_activity_at,
                chat.archived,
                chat.pinned,
                anchor
            )
            .execute(&mut **tx)
            .await
        } else {
            sqlx::query!(
                r#"UPDATE whatsapp_chat c SET
                    name = COALESCE($3, c.name),
                    last_activity_at = GREATEST(c.last_activity_at, $4),
                    archived = COALESCE($5, c.archived),
                    pinned = COALESCE($6, c.pinned),
                    updated_at = now()
                WHERE c.account_id = $1 AND c.chat_jid = $2
                  AND (c.name IS DISTINCT FROM COALESCE($3, c.name)
                    OR c.last_activity_at IS DISTINCT FROM GREATEST(c.last_activity_at, $4)
                    OR c.archived IS DISTINCT FROM COALESCE($5, c.archived)
                    OR c.pinned IS DISTINCT FROM COALESCE($6, c.pinned))"#,
                account.id,
                chat.jid,
                name,
                chat.last_activity_at,
                chat.archived,
                chat.pinned
            )
            .execute(&mut **tx)
            .await
        }
        .map_err(failure)?;
        changed |= rows.rows_affected() > 0;
    }
    if changed {
        notify_change(
            tx,
            signals::Change::Groups {
                account_id: account.id,
            },
        )
        .await?;
    }
    Ok(())
}

pub(super) async fn account_chats(pool: &PgPool, account: Uuid) -> LinkedResult<Vec<StoredChat>> {
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
            kind: ChatKind::parse(&row.kind).ok_or(LinkedError::Unavailable)?,
            jid: row.chat_jid,
            name: row.name,
            last_activity_at: row.last_activity_at,
            archived: row.archived,
            pinned: row.pinned,
        })
    })
    .collect()
}

fn backfill_state(value: &str) -> LinkedResult<BackfillState> {
    BackfillState::parse(value).ok_or_else(|| LinkedError::Unavailable.into())
}

pub(super) async fn backfill_work_in(
    tx: &mut Transaction<'_, Postgres>,
    account: &Fenced,
) -> LinkedResult<Vec<BackfillWork>> {
    sqlx::query!(
        r#"SELECT g.id, g.group_jid, g.backfill_state AS "state!", g.backfill_imported, g.backfill_cursor,
            g.adopted_at, g.backfill_requested_at, c.anchor AS "anchor?"
        FROM whatsapp_group g
        LEFT JOIN whatsapp_chat c ON c.account_id = $1 AND c.chat_jid = g.group_jid
        WHERE g.user_id = $2 AND g.state = 'active'
          AND g.backfill_state IN ('pending', 'running', 'waiting_for_phone')
        ORDER BY g.adopted_at, g.id LIMIT 20"#,
        account.id,
        account.user_id
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(failure)?
    .into_iter()
    .map(|row| {
        Ok(BackfillWork {
            group_id: row.id,
            group_jid: row.group_jid,
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
) -> LinkedResult<()> {
    let previous = sqlx::query_scalar!(
        r#"UPDATE whatsapp_group g SET backfill_state = $3,
            backfill_requested_at = CASE WHEN $4 THEN now() ELSE g.backfill_requested_at END
        FROM (SELECT id, backfill_state FROM whatsapp_group WHERE id = $1 FOR UPDATE) old
        WHERE g.id = old.id AND g.user_id = $2
          AND g.backfill_state IN ('pending', 'running', 'waiting_for_phone')
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
        notify_change(tx, signals::Change::Group { group_id: group }).await?;
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
) -> LinkedResult<Vec<(Uuid, BackfillState)>> {
    let rows = sqlx::query!(
        r#"SELECT id, backfill_imported, backfill_cursor, adopted_at FROM whatsapp_group
        WHERE user_id = $1 AND group_jid = $2 AND state = 'active'
          AND backfill_state IN ('pending', 'running', 'waiting_for_phone')
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
            r#"UPDATE whatsapp_group SET backfill_state = $2, backfill_imported = $3, backfill_cursor = $4,
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
        notify_change(tx, signals::Change::Group { group_id: row.id }).await?;
        states.push((row.id, state));
    }
    Ok(states)
}

#[cfg(test)]
mod test;
