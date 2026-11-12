//! Storing Slack changes into the added chats that observe them. Slack user
//! ids are stable, so a sender resolves by id alone (`slack_user_alias`);
//! every observing account converges on one row per `(chat, person, ts)`.

use super::*;
use crate::domain::session::ts_time;

/// Namespace of each chat's stand-in person: the author of system lines Slack
/// names nobody for.
const CONVERSATION_PERSON_NAMESPACE: Uuid =
    Uuid::from_u128(0x6b1d_3c2e_7f40_4a95_8e21_5c7d_9a03_f1b6);

/// A Slack `ts` as one integer (microseconds), ordering revisions.
pub(super) fn ts_micros(ts: &str) -> i64 {
    let micros = ts_time(ts);
    micros.timestamp_micros()
}

/// The added chats this account observes for a conversation.
pub(super) async fn observing_chats_in(
    tx: &mut Transaction<'_, Postgres>,
    account: &Fenced,
    conversation: &str,
) -> ExternalChatResult<Vec<ChatRef>> {
    sqlx::query_as!(
        ChatRow,
        r#"SELECT e.id, e.provider, e.remote_id, e.kind, e.user_id, e.state, e.adopted_at
        FROM external_chat e JOIN slack_chat_membership m ON m.chat_id = e.id
        WHERE e.provider = 'slack' AND e.remote_id = $1 AND e.state = 'active'
          AND m.account_id = $2 AND m.generation = $3 AND m.consent_ended_at IS NULL
        ORDER BY e.id LIMIT 100"#,
        conversation,
        account.id,
        account.generation
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(failure)?
    .into_iter()
    .map(chat_ref)
    .collect()
}

/// The chat's person for a sender, created on first sight.
pub(super) async fn person_in(
    tx: &mut Transaction<'_, Postgres>,
    chat: Uuid,
    sender: &Sender,
) -> ExternalChatResult<Uuid> {
    let (key, display_name, team_id) = match sender {
        Sender::User {
            slack_user_id,
            team_id,
            display_name,
        } => (
            slack_user_id.as_str(),
            display_name.as_deref(),
            team_id.as_deref(),
        ),
        Sender::Bot {
            bot_id,
            display_name,
        } => (bot_id.as_str(), display_name.as_deref(), None),
        Sender::Conversation => {
            let person = Uuid::new_v5(&CONVERSATION_PERSON_NAMESPACE, chat.as_bytes());
            sqlx::query!(
                "INSERT INTO external_chat_person (id, chat_id) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
                person,
                chat
            )
            .execute(&mut **tx)
            .await
            .map_err(failure)?;
            return Ok(person);
        }
    };
    if let Some(person) = sqlx::query_scalar!(
        "SELECT person_id FROM slack_user_alias WHERE chat_id = $1 AND slack_user_id = $2",
        chat,
        key
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(failure)?
    {
        if display_name.is_some() {
            sqlx::query!(
                "UPDATE external_chat_person SET display_name = $2 WHERE id = $1 AND display_name IS DISTINCT FROM $2",
                person,
                display_name
            )
            .execute(&mut **tx)
            .await
            .map_err(failure)?;
        }
        return Ok(person);
    }
    // A sender who linked this Slack identity to Macro is shown as that
    // person; never an authentication principal.
    let associated_user = sqlx::query_scalar!(
        "SELECT user_id FROM slack_account WHERE slack_user_id = $1 ORDER BY created_at LIMIT 1",
        key
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(failure)?;
    let person = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO external_chat_person (id, chat_id, user_id, display_name) VALUES ($1, $2, $3, $4)",
        person,
        chat,
        associated_user,
        display_name
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    let person = sqlx::query_scalar!(
        r#"INSERT INTO slack_user_alias (chat_id, slack_user_id, person_id) VALUES ($1, $2, $3)
        ON CONFLICT (chat_id, slack_user_id) DO UPDATE SET slack_user_id = excluded.slack_user_id
        RETURNING person_id"#,
        chat,
        key,
        person
    )
    .fetch_one(&mut **tx)
    .await
    .map_err(failure)?;
    if lazy_regex::regex_is_match!(r"^[UW][A-Z0-9]{6,}$", key) {
        sqlx::query!(
            r#"INSERT INTO slack_user (slack_user_id, team_id, display_name) VALUES ($1, $2, $3)
            ON CONFLICT (slack_user_id) DO NOTHING"#,
            key,
            team_id,
            display_name
        )
        .execute(&mut **tx)
        .await
        .map_err(failure)?;
    }
    Ok(person)
}

/// A stored message of the chat by its `ts`.
pub(super) async fn message_in(
    tx: &mut Transaction<'_, Postgres>,
    chat: Uuid,
    ts: &str,
) -> ExternalChatResult<Option<Uuid>> {
    sqlx::query_scalar!(
        r#"SELECT id FROM external_chat_message
        WHERE chat_id = $1 AND source_id = $2 AND message_id IS NOT NULL
        ORDER BY id LIMIT 1"#,
        chat,
        ts
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(failure)
}

/// Who stored a message.
#[derive(Clone, Copy)]
pub(super) enum StoredOrigin<'a> {
    /// Live or history, as Slack delivered it.
    Slack(IngestOrigin),
    /// The accepted send that produced it.
    Send { id: Uuid, user_id: &'a str },
}

/// Store a message once per `(chat, person, ts)`; a repeat fills in what an
/// earlier copy lacked and never changes its origin. Returns whether it was
/// new.
pub(super) async fn store_message_in(
    tx: &mut Transaction<'_, Postgres>,
    chat: Uuid,
    message: &InboundMessage,
    origin: StoredOrigin<'_>,
    observer: Uuid,
) -> ExternalChatResult<bool> {
    let person = person_in(tx, chat, &message.sender).await?;
    let thread_root = match &message.thread_ts {
        Some(root) => message_in(tx, chat, root).await?,
        None => None,
    };
    let (id, origin_name) = match origin {
        StoredOrigin::Slack(IngestOrigin::Live) => (Uuid::now_v7(), "remote"),
        StoredOrigin::Slack(IngestOrigin::History) => (Uuid::now_v7(), "history"),
        StoredOrigin::Send { id, .. } => (id, "macro"),
    };
    let kind = if message.system { "system" } else { "message" };
    let row = sqlx::query!(
        r#"INSERT INTO external_chat_message (id, message_id, chat_id, person_id, source_id, origin, source_at,
            body, thread_root, thread_broadcast, kind, mentions, effect_revision)
        VALUES ($1, $1, $2, $3, $4, $5, $6, $7, $8, $11, $9, $10, 1)
        ON CONFLICT (chat_id, person_id, source_id) DO UPDATE SET
            thread_root = COALESCE(external_chat_message.thread_root, excluded.thread_root),
            thread_broadcast = external_chat_message.thread_broadcast OR excluded.thread_broadcast,
            mentions = CASE WHEN cardinality(external_chat_message.mentions) = 0
                THEN excluded.mentions ELSE external_chat_message.mentions END
        RETURNING id, xmax = 0 AS "created!""#,
        id,
        chat,
        person,
        message.ts,
        origin_name,
        message.sent_at,
        message.body,
        thread_root,
        kind,
        &message.mentions,
        message.broadcast
    )
    .fetch_one(&mut **tx)
    .await
    .map_err(failure)?;
    if let StoredOrigin::Send { id: send, user_id } = origin {
        sqlx::query!(
            r#"UPDATE slack_send SET state = 'accepted', message_id = $3, remote_ts = $4, claimed_epoch = NULL, updated_at = now()
            WHERE id = $1 AND user_id = $2 AND state IN ('sending', 'unknown')"#,
            send,
            user_id,
            row.id,
            message.ts
        )
        .execute(&mut **tx)
        .await
        .map_err(failure)?;
    }
    // A later edit of this message arrived first: Slack's newest text wins.
    if let Some(edited) = &message.edited_ts {
        revise_in(
            tx,
            chat,
            &message.ts,
            &message.body,
            ts_micros(edited),
            message.sent_at,
        )
        .await?;
    }
    if row.created {
        notify(tx, external_chat::signals::CHAT_EFFECTS, row.id).await?;
    }
    super::media::reserve_files_in(tx, chat, person, message, observer).await?;
    Ok(row.created)
}

/// Apply an edit at `revision` unless a newer one is stored. Returns whether
/// it changed anything.
pub(super) async fn revise_in(
    tx: &mut Transaction<'_, Postgres>,
    chat: Uuid,
    ts: &str,
    body: &str,
    revision: i64,
    at: chrono::DateTime<chrono::Utc>,
) -> ExternalChatResult<bool> {
    let revised = sqlx::query_scalar!(
        r#"UPDATE external_chat_message SET revision_content = $3, body = $3, content_revision = $4,
            revised_at = $5, effect_revision = effect_revision + 1, notification_retry_at = now()
        WHERE chat_id = $1 AND source_id = $2 AND deleted_at IS NULL AND content_revision < $4
        RETURNING id"#,
        chat,
        ts,
        body,
        revision,
        at
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(failure)?;
    for message in &revised {
        notify(tx, external_chat::signals::CHAT_EFFECTS, *message).await?;
    }
    Ok(!revised.is_empty())
}

/// Store one change into one chat.
pub(super) async fn apply_in(
    tx: &mut Transaction<'_, Postgres>,
    account: &Fenced,
    chat: &ChatRef,
    change: &InboundChange,
) -> ExternalChatResult<Ingested> {
    let outcome = match change {
        InboundChange::Message {
            message, origin, ..
        } => {
            store_message_in(
                tx,
                chat.id,
                message,
                StoredOrigin::Slack(*origin),
                account.id,
            )
            .await?;
            sqlx::query!(
                r#"UPDATE slack_chat_membership SET latest_ts = GREATEST(COALESCE(latest_ts, $3), $3), observed_at = now()
                WHERE chat_id = $1 AND account_id = $2"#,
                chat.id,
                account.id,
                message.ts
            )
            .execute(&mut **tx)
            .await
            .map_err(failure)?;
            Ingested::Applied
        }
        InboundChange::Edited { message, .. } => {
            if message_in(tx, chat.id, &message.ts).await?.is_none() {
                return Ok(Ingested::Deferred);
            }
            let revision = message.edited_ts.as_deref().map_or(1, ts_micros);
            revise_in(
                tx,
                chat.id,
                &message.ts,
                &message.body,
                revision,
                message.sent_at,
            )
            .await?;
            Ingested::Applied
        }
        InboundChange::Deleted { ts, at, .. } => {
            let deleted = sqlx::query_scalar!(
                r#"UPDATE external_chat_message SET deleted_at = $3, body = '', revision_content = NULL,
                    effect_revision = effect_revision + 1, notification_retry_at = now()
                WHERE chat_id = $1 AND source_id = $2 AND deleted_at IS NULL RETURNING id"#,
                chat.id,
                ts,
                at
            )
            .fetch_all(&mut **tx)
            .await
            .map_err(failure)?;
            for message in deleted {
                notify(tx, external_chat::signals::CHAT_EFFECTS, message).await?;
            }
            Ingested::Applied
        }
        InboundChange::Reaction {
            ts,
            slack_user_id,
            name,
            added,
            event_ts,
            ..
        } => {
            let Some(target) = message_in(tx, chat.id, ts).await? else {
                return Ok(Ingested::Deferred);
            };
            let reactor = person_in(
                tx,
                chat.id,
                &Sender::User {
                    slack_user_id: slack_user_id.clone(),
                    team_id: None,
                    display_name: None,
                },
            )
            .await?;
            let revision = ts_micros(event_ts);
            if *added {
                sqlx::query!(
                    r#"INSERT INTO external_chat_reaction (message_id, person_id, emoji, source_id, revision, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (message_id, person_id, emoji) DO UPDATE SET source_id = excluded.source_id,
                        revision = excluded.revision, updated_at = excluded.updated_at
                    WHERE excluded.revision >= external_chat_reaction.revision"#,
                    target,
                    reactor,
                    name,
                    event_ts,
                    revision,
                    ts_time(event_ts)
                )
                .execute(&mut **tx)
                .await
                .map_err(failure)?;
            } else {
                sqlx::query!(
                    "DELETE FROM external_chat_reaction WHERE message_id = $1 AND person_id = $2 AND emoji = $3 AND revision <= $4",
                    target,
                    reactor,
                    name,
                    revision
                )
                .execute(&mut **tx)
                .await
                .map_err(failure)?;
            }
            Ingested::Applied
        }
        InboundChange::Marked { thread_ts, ts, .. } => {
            // Only the owner's own Slack reads move their Macro read position.
            if thread_ts.is_some() || chat.user_id != account.user_id {
                return Ok(Ingested::Applied);
            }
            sqlx::query!(
                r#"INSERT INTO external_chat_read_state (user_id, chat_id, message_id, read_at)
                SELECT $2, $1, m.id, m.source_at FROM external_chat_message m
                WHERE m.chat_id = $1 AND m.message_id IS NOT NULL AND m.source_at <= $3
                ORDER BY m.source_at DESC, m.id DESC LIMIT 1
                ON CONFLICT (user_id, chat_id) DO UPDATE SET message_id = excluded.message_id, read_at = excluded.read_at
                WHERE (external_chat_read_state.read_at, external_chat_read_state.message_id) < (excluded.read_at, excluded.message_id)"#,
                chat.id,
                chat.user_id,
                ts_time(ts)
            )
            .execute(&mut **tx)
            .await
            .map_err(failure)?;
            Ingested::Applied
        }
        InboundChange::ConversationIdChanged { new_id, .. } => {
            sqlx::query!(
                "UPDATE external_chat SET remote_id = $2 WHERE id = $1",
                chat.id,
                new_id
            )
            .execute(&mut **tx)
            .await
            .map_err(failure)?;
            Ingested::Applied
        }
    };
    notify_change(tx, Change::Chat { chat_id: chat.id }).await?;
    Ok(outcome)
}
