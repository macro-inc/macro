//! Durable send intents: enqueue (DSS), claim, dispatch fence and outcome
//! (session service). `dispatch_started_at` is written before submission; a
//! dispatched send without an outcome is `unknown` and never sent again.

use super::*;
use crate::domain::ports::SendRepository;
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use external_chat::domain::ports::{MutationTarget, SendIntent, StoredSend};
use external_chat::outbound::pg::lock_chat_in;
use crate::domain::session::ts_time;
use macro_user_id::user_id::MacroUserIdStr;

struct SendRow {
    id: Uuid,
    user_id: String,
    chat_id: Uuid,
    payload: serde_json::Value,
    state: String,
    message_id: Option<Uuid>,
    error_code: Option<String>,
    created_at: DateTime<Utc>,
}

fn progress(row: SendRow) -> ExternalChatResult<SendProgress> {
    Ok(SendProgress {
        id: row.id,
        user_id: row.user_id,
        chat_id: row.chat_id,
        payload: decode(row.payload)?,
        state: DeliveryState::parse(&row.state)
            .ok_or_else(|| corrupt(format_args!("state {:?}", row.state)))?,
        message_id: row.message_id,
        error_code: row.error_code,
        created_at: row.created_at,
    })
}

#[async_trait]
impl SendRepository for PgSlackRepository {
    async fn mutation_target(
        &self,
        chat: &ChatRef,
        message: Uuid,
    ) -> ExternalChatResult<Option<MutationTarget>> {
        let row = sqlx::query!(
            r#"SELECT m.source_at, m.deleted_at, array_remove(array_agg(a.slack_user_id), NULL) AS "sent_by!"
            FROM external_chat_message m
            LEFT JOIN slack_user_alias a ON a.chat_id = m.chat_id AND a.person_id = m.person_id
            WHERE m.chat_id = $1 AND m.message_id = $2
            GROUP BY m.source_at, m.deleted_at"#,
            chat.id,
            message
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(failure)?;
        Ok(row.map(|row| MutationTarget {
            source_at: row.source_at,
            sent_by: row.sent_by,
            deleted: row.deleted_at.is_some(),
        }))
    }

    async fn stored_send(
        &self,
        chat_id: Uuid,
        user: &MacroUserIdStr<'_>,
        idempotency_key: Uuid,
    ) -> ExternalChatResult<Option<StoredSend>> {
        let Some(row) = sqlx::query!(
            r#"SELECT id, user_id, chat_id, payload, state, message_id, error_code, created_at, request_sha256
            FROM slack_send WHERE chat_id = $1 AND user_id = $2 AND idempotency_key = $3"#,
            chat_id,
            user.as_ref(),
            idempotency_key
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(failure)?
        else {
            return Ok(None);
        };
        Ok(Some(StoredSend {
            request_sha256: row
                .request_sha256
                .try_into()
                .map_err(|_| corrupt("sha256 is not 32 bytes"))?,
            progress: progress(SendRow {
                id: row.id,
                user_id: row.user_id,
                chat_id: row.chat_id,
                payload: row.payload,
                state: row.state,
                message_id: row.message_id,
                error_code: row.error_code,
                created_at: row.created_at,
            })?,
        }))
    }

    async fn enqueue(&self, intent: SendIntent<'_>) -> ExternalChatResult<SendProgress> {
        let SendIntent {
            user,
            chat,
            request,
            digest,
            ..
        } = intent;
        let user = user.as_ref();
        let payload = serde_json::to_value(request).map_err(failure)?;
        let mut tx = self.pool.begin().await.map_err(failure)?;
        lock_chat_in(&mut tx, chat.id).await?;
        // The person's account observing this chat that last connected and
        // may post sends it.
        let sender = sqlx::query!(
            r#"SELECT a.id, a.generation FROM slack_account a
            JOIN slack_chat_membership m ON m.account_id = a.id AND m.chat_id = $1
            JOIN external_chat e ON e.id = m.chat_id
            JOIN slack_conversation c ON c.account_id = a.id AND c.conversation_id = e.remote_id
            WHERE a.user_id = $2 AND a.state IN ('connecting', 'connected')
              AND m.generation = a.generation AND m.consent_ended_at IS NULL
              AND c.is_member AND NOT c.is_archived AND c.frozen_reason IS NULL
            ORDER BY a.last_connected_at DESC NULLS LAST, a.id LIMIT 1
            FOR SHARE OF a"#,
            chat.id,
            user
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?
        .ok_or(ExternalChatError::Forbidden)?;
        let replayed = sqlx::query_scalar!(
            "SELECT id FROM slack_send WHERE chat_id = $1 AND user_id = $2 AND idempotency_key = $3",
            chat.id,
            user,
            request.idempotency_key
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?
        .is_some();
        if !replayed {
            let sequence = sqlx::query_scalar!(
                r#"UPDATE external_chat SET next_sequence = next_sequence + 1
                WHERE id = $1 AND state = 'active' AND external_chat_can_view(id, $2)
                RETURNING next_sequence"#,
                chat.id,
                user
            )
            .fetch_optional(&mut *tx)
            .await
            .map_err(failure)?
            .ok_or(ExternalChatError::Forbidden)?;
            sqlx::query!(
                r#"INSERT INTO slack_send (id, account_id, chat_id, user_id, idempotency_key, request_sha256, payload,
                    generation, chat_sequence, traceparent, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, clock_timestamp())
                ON CONFLICT (chat_id, user_id, idempotency_key) DO NOTHING"#,
                Uuid::now_v7(),
                sender.id,
                chat.id,
                user,
                request.idempotency_key,
                &digest[..],
                payload,
                sender.generation,
                sequence,
                external_chat::signals::trace_context::current()
            )
            .execute(&mut *tx)
            .await
            .map_err(failure)?;
        }
        let stored = sqlx::query!(
            r#"SELECT id, user_id, chat_id, payload, state, message_id, error_code, created_at, request_sha256, account_id
            FROM slack_send WHERE chat_id = $1 AND user_id = $2 AND idempotency_key = $3"#,
            chat.id,
            user,
            request.idempotency_key
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(failure)?;
        if stored.request_sha256 != digest {
            return Err(ExternalChatError::Conflict.into());
        }
        notify(&mut tx, signals::SEND_REQUESTED, stored.account_id).await?;
        tx.commit().await.map_err(failure)?;
        progress(SendRow {
            id: stored.id,
            user_id: stored.user_id,
            chat_id: stored.chat_id,
            payload: stored.payload,
            state: stored.state,
            message_id: stored.message_id,
            error_code: stored.error_code,
            created_at: stored.created_at,
        })
    }

    async fn open_sends(
        &self,
        chat_id: Uuid,
        user: &MacroUserIdStr<'_>,
    ) -> ExternalChatResult<Vec<SendProgress>> {
        sqlx::query_as!(
            SendRow,
            r#"SELECT id, user_id, chat_id, payload, state, message_id, error_code, created_at FROM slack_send
            WHERE chat_id = $1 AND user_id = $2 AND state IN ('pending', 'sending', 'unknown', 'failed')
              AND created_at > now() - interval '7 days'
            ORDER BY created_at DESC LIMIT 50"#,
            chat_id,
            user.as_ref()
        )
        .fetch_all(&self.pool)
        .await
        .map_err(failure)?
        .into_iter()
        .map(progress)
        .collect()
    }

    async fn sends_for(
        &self,
        chat_id: Uuid,
        user: &MacroUserIdStr<'_>,
        ids: &[Uuid],
    ) -> ExternalChatResult<Vec<SendProgress>> {
        sqlx::query_as!(
            SendRow,
            r#"SELECT id, user_id, chat_id, payload, state, message_id, error_code, created_at FROM slack_send
            WHERE chat_id = $1 AND user_id = $2 AND (id = ANY($3) OR message_id = ANY($3))
            ORDER BY created_at LIMIT 100"#,
            chat_id,
            user.as_ref(),
            ids
        )
        .fetch_all(&self.pool)
        .await
        .map_err(failure)?
        .into_iter()
        .map(progress)
        .collect()
    }

    async fn delivery_states(
        &self,
        chat_id: Uuid,
        viewer: &str,
        messages: &[Uuid],
    ) -> ExternalChatResult<Vec<(Uuid, DeliveryState)>> {
        sqlx::query!(
            r#"SELECT DISTINCT ON (message_id) message_id AS "message_id!", state FROM slack_send
            WHERE chat_id = $1 AND user_id = $2 AND message_id = ANY($3)
            ORDER BY message_id, created_at DESC"#,
            chat_id,
            viewer,
            messages
        )
        .fetch_all(&self.pool)
        .await
        .map_err(failure)?
        .into_iter()
        .map(|row| {
            Ok((
                row.message_id,
                DeliveryState::parse(&row.state)
                    .ok_or_else(|| corrupt(format_args!("state {:?}", row.state)))?,
            ))
        })
        .collect()
    }
}

/// A message's `ts` and its thread root's `ts`.
async fn slack_position_in(
    tx: &mut Transaction<'_, Postgres>,
    chat: Uuid,
    message: Uuid,
) -> ExternalChatResult<Option<(String, Option<String>)>> {
    Ok(sqlx::query!(
        r#"SELECT m.source_id, r.source_id AS "root?" FROM external_chat_message m
        LEFT JOIN external_chat_message r ON r.id = m.reply_to
        WHERE m.chat_id = $1 AND m.message_id = $2"#,
        chat,
        message
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(failure)?
    .map(|row| (row.source_id, row.root)))
}

/// Session-side send steps, called through `SessionRepository`.
pub(super) async fn claim_sends(
    pool: &PgPool,
    scope: SessionScope,
    limit: i64,
) -> ExternalChatResult<Vec<ClaimedSend>> {
    let mut tx = pool.begin().await.map_err(failure)?;
    let account = fence_in(&mut tx, scope, false).await?;
    let mut changed = sqlx::query_scalar!(
        r#"UPDATE slack_send SET state = 'failed', error_code = 'send_expired', updated_at = now()
        WHERE account_id = $1 AND state = 'pending' AND created_at <= clock_timestamp() - make_interval(secs => $2)
        RETURNING chat_id"#,
        account.id,
        SEND_EXPIRY_SECONDS as f64
    )
    .fetch_all(&mut *tx)
    .await
    .map_err(failure)?;
    let rows = sqlx::query!(
        r#"UPDATE slack_send s SET state = 'sending', claimed_epoch = $2, updated_at = now()
        FROM external_chat e
        WHERE s.id IN (
            SELECT id FROM slack_send WHERE account_id = $1 AND generation = $3 AND state = 'pending'
            ORDER BY chat_id, chat_sequence LIMIT $4 FOR UPDATE SKIP LOCKED)
          AND e.id = s.chat_id
        RETURNING s.id, s.chat_id, s.chat_sequence, s.payload, s.traceparent, e.remote_id"#,
        account.id,
        scope.lease_epoch,
        account.generation,
        limit
    )
    .fetch_all(&mut *tx)
    .await
    .map_err(failure)?;
    let mut claimed = Vec::with_capacity(rows.len());
    let mut ordered = rows;
    ordered.sort_by_key(|row| (row.chat_id, row.chat_sequence));
    for row in ordered {
        let request: SendReply = decode(row.payload.clone())?;
        let (thread_ts, target_ts, missing) = match &request.message {
            ReplyContent::Mutation { message_id, .. } => {
                match slack_position_in(&mut tx, row.chat_id, *message_id).await? {
                    Some((ts, _)) => (None, Some(ts), false),
                    None => (None, None, true),
                }
            }
            // Files from Macro wait for the attachment pipeline's Slack upload.
            ReplyContent::Media { .. } => (None, None, true),
            ReplyContent::Text { .. } => match request.reply_to {
                Some(quoted) => match slack_position_in(&mut tx, row.chat_id, quoted).await? {
                    // A reply goes into the target's thread.
                    Some((ts, root)) => (Some(root.unwrap_or(ts)), None, false),
                    None => (None, None, true),
                },
                None => (None, None, false),
            },
        };
        if missing {
            sqlx::query!(
                "UPDATE slack_send SET state = 'failed', error_code = 'target_unavailable', claimed_epoch = NULL, updated_at = now() WHERE id = $1",
                row.id
            )
            .execute(&mut *tx)
            .await
            .map_err(failure)?;
            changed.push(row.chat_id);
            continue;
        }
        claimed.push(ClaimedSend {
            id: row.id,
            chat_id: row.chat_id,
            conversation_id: row.remote_id,
            payload: row.payload,
            thread_ts,
            target_ts,
            traceparent: row.traceparent,
        });
    }
    changed.sort();
    changed.dedup();
    for chat_id in changed {
        notify_change(&mut tx, Change::Chat { chat_id }).await?;
    }
    tx.commit().await.map_err(failure)?;
    Ok(claimed)
}

pub(super) async fn begin_dispatch(
    pool: &PgPool,
    scope: SessionScope,
    send: Uuid,
    client_msg_id: &str,
) -> ExternalChatResult<bool> {
    let mut tx = pool.begin().await.map_err(failure)?;
    let account = fence_in(&mut tx, scope, false).await?;
    // Every sending fact is re-checked at the moment of the fence.
    let dispatched = sqlx::query!(
        r#"UPDATE slack_send s SET dispatch_started_at = clock_timestamp(), allocated_source_id = $4, updated_at = now()
        FROM slack_account a, slack_chat_membership m, external_chat e
        WHERE s.id = $1 AND s.account_id = $2 AND s.claimed_epoch = $3 AND s.state = 'sending'
          AND s.dispatch_started_at IS NULL
          AND s.created_at > clock_timestamp() - make_interval(secs => $5)
          AND a.id = s.account_id AND a.user_id = s.user_id AND a.generation = s.generation
          AND a.state IN ('connecting', 'connected')
          AND e.id = s.chat_id AND e.state = 'active'
          AND m.chat_id = s.chat_id AND m.account_id = s.account_id AND m.generation = s.generation
          AND m.consent_ended_at IS NULL
          AND external_chat_can_view(s.chat_id, s.user_id)"#,
        send,
        account.id,
        scope.lease_epoch,
        client_msg_id,
        SEND_EXPIRY_SECONDS as f64
    )
    .execute(&mut *tx)
    .await
    .map_err(failure)?
    .rows_affected()
        == 1;
    if !dispatched {
        let chat = sqlx::query_scalar!(
            r#"UPDATE slack_send SET state = 'failed', error_code = 'not_allowed', claimed_epoch = NULL, updated_at = now()
            WHERE id = $1 AND account_id = $2 AND state = 'sending' AND dispatch_started_at IS NULL
            RETURNING chat_id"#,
            send,
            account.id
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?;
        if let Some(chat_id) = chat {
            notify_change(&mut tx, Change::Chat { chat_id }).await?;
        }
    }
    tx.commit().await.map_err(failure)?;
    Ok(dispatched)
}

pub(super) async fn record_send_outcome(
    pool: &PgPool,
    scope: SessionScope,
    send: Uuid,
    outcome: &SendOutcome,
) -> ExternalChatResult<()> {
    let mut tx = pool.begin().await.map_err(failure)?;
    let account = fence_in(&mut tx, scope, false).await?;
    let row = sqlx::query!(
        r#"SELECT chat_id, user_id, payload, created_at FROM slack_send
        WHERE id = $1 AND account_id = $2 AND dispatch_started_at IS NOT NULL"#,
        send,
        account.id
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(failure)?
    .ok_or(ExternalChatError::NotFound)?;
    lock_chat_in(&mut tx, row.chat_id).await?;
    match outcome {
        SendOutcome::Unknown => {
            sqlx::query!(
                "UPDATE slack_send SET state = 'unknown', claimed_epoch = NULL, updated_at = now() WHERE id = $1 AND state = 'sending'",
                send
            )
            .execute(&mut *tx)
            .await
            .map_err(failure)?;
        }
        SendOutcome::Failed { code } => {
            sqlx::query!(
                "UPDATE slack_send SET state = 'failed', error_code = $2, claimed_epoch = NULL, updated_at = now() WHERE id = $1 AND state IN ('sending', 'unknown')",
                send,
                code.chars().take(64).collect::<String>()
            )
            .execute(&mut *tx)
            .await
            .map_err(failure)?;
        }
        SendOutcome::Accepted { ts } => {
            let identity = account
                .slack_user_id
                .clone()
                .ok_or(ExternalChatError::Disconnected)?;
            let request: SendReply = decode(row.payload)?;
            match &request.message {
                ReplyContent::Text { text, mentions } => {
                    let thread_ts = match request.reply_to {
                        Some(quoted) => slack_position_in(&mut tx, row.chat_id, quoted)
                            .await?
                            .map(|(target, root)| root.unwrap_or(target)),
                        None => None,
                    };
                    let message = InboundMessage {
                        ts: ts.clone(),
                        sent_at: ts_time(ts),
                        sender: Sender::User {
                            slack_user_id: identity,
                            team_id: None,
                            display_name: None,
                        },
                        body: text.clone(),
                        mentions: mentions.clone(),
                        thread_ts,
                        system: false,
                        files: vec![],
                        edited_ts: None,
                        client_msg_id: None,
                    };
                    ingest::store_message_in(
                        &mut tx,
                        row.chat_id,
                        &message,
                        ingest::StoredOrigin::Send {
                            id: send,
                            user_id: &row.user_id,
                        },
                    )
                    .await?;
                }
                ReplyContent::Mutation {
                    message_id,
                    operation,
                    text,
                } => {
                    mark_accepted_in(&mut tx, send, ts).await?;
                    if let Some((target, _)) =
                        slack_position_in(&mut tx, row.chat_id, *message_id).await?
                    {
                        let chat = sqlx::query_as!(
                            ChatRow,
                            "SELECT id, provider, remote_id, kind, user_id, state, adopted_at FROM external_chat WHERE id = $1",
                            row.chat_id
                        )
                        .fetch_one(&mut *tx)
                        .await
                        .map_err(failure)
                        .and_then(chat_ref)?;
                        let change = match operation {
                            Mutation::Edit => InboundChange::Edited {
                                conversation_id: chat.remote_id.clone(),
                                message: InboundMessage {
                                    ts: target.clone(),
                                    sent_at: ts_time(&target),
                                    sender: Sender::User {
                                        slack_user_id: identity,
                                        team_id: None,
                                        display_name: None,
                                    },
                                    body: text.clone().unwrap_or_default(),
                                    mentions: vec![],
                                    thread_ts: None,
                                    system: false,
                                    files: vec![],
                                    edited_ts: Some(ts.clone()),
                                    client_msg_id: None,
                                },
                            },
                            Mutation::Delete => InboundChange::Deleted {
                                conversation_id: chat.remote_id.clone(),
                                ts: target,
                                at: ts_time(ts),
                            },
                            Mutation::Reaction => InboundChange::Reaction {
                                conversation_id: chat.remote_id.clone(),
                                ts: target,
                                slack_user_id: identity,
                                name: text.clone().unwrap_or_default(),
                                added: true,
                                event_ts: ts.clone(),
                            },
                        };
                        ingest::apply_in(&mut tx, &account, &chat, &change).await?;
                    }
                }
                ReplyContent::Media { .. } => {
                    return Err(corrupt("a file send was dispatched"));
                }
            }
        }
    }
    notify_change(&mut tx, Change::Chat { chat_id: row.chat_id }).await?;
    tx.commit().await.map_err(failure)
}

async fn mark_accepted_in(
    tx: &mut Transaction<'_, Postgres>,
    send: Uuid,
    ts: &str,
) -> ExternalChatResult<()> {
    sqlx::query!(
        "UPDATE slack_send SET state = 'accepted', remote_ts = $2, claimed_epoch = NULL, updated_at = now() WHERE id = $1 AND state IN ('sending', 'unknown')",
        send,
        ts
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    Ok(())
}

pub(super) async fn release_sends(pool: &PgPool, scope: SessionScope) -> ExternalChatResult<()> {
    let mut tx = pool.begin().await.map_err(failure)?;
    let account = fence_in(&mut tx, scope, false).await?;
    sqlx::query!(
        "UPDATE slack_send SET state = 'pending', claimed_epoch = NULL, updated_at = now() WHERE account_id = $1 AND state = 'sending' AND dispatch_started_at IS NULL",
        account.id
    )
    .execute(&mut *tx)
    .await
    .map_err(failure)?;
    tx.commit().await.map_err(failure)
}
