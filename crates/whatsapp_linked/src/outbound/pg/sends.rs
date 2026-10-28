//! Durable send intents: enqueue (DSS), claim, dispatch fence and outcome
//! (session service). `dispatch_started_at` is written before submission; a
//! dispatched send without an outcome is `unknown` and never sent again.

use super::*;
use crate::domain::{events::*, ports::SendRepository};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use external_chat::domain::ports::{MutationTarget, SendIntent, StoredSend};
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

/// An integer column as a shape value.
fn unsigned(value: Option<i32>) -> Option<u32> {
    value.and_then(|value| u32::try_from(value).ok())
}

#[async_trait]
impl SendRepository for PgWhatsAppRepository {
    async fn mutation_target(
        &self,
        chat: &ChatRef,
        message: Uuid,
    ) -> ExternalChatResult<Option<MutationTarget>> {
        let row = sqlx::query!(
            r#"SELECT m.source_at, m.deleted_at, array_agg(a.jid) AS "sent_by!"
            FROM external_chat_message m
            JOIN whatsapp_identity_alias a ON a.chat_id = m.chat_id AND a.person_id = m.person_id
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
        let user = user.as_ref();
        let Some(row) = sqlx::query!(
            r#"SELECT id, user_id, chat_id, payload, state, message_id, error_code, created_at, request_sha256
            FROM whatsapp_send WHERE chat_id = $1 AND user_id = $2 AND idempotency_key = $3"#,
            chat_id,
            user,
            idempotency_key
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(failure)?
        else {
            return Ok(None);
        };
        let digest: [u8; 32] = row
            .request_sha256
            .try_into()
            .map_err(|_| corrupt("sha256 is not 32 bytes"))?;
        Ok(Some(StoredSend {
            request_sha256: digest,
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
            account,
            chat: binding,
            request,
            digest,
        } = intent;
        let user = user.as_ref();
        let payload = serde_json::to_value(request).map_err(failure)?;
        let mut tx = self.pool.begin().await.map_err(failure)?;
        sqlx::query!(
            "SELECT id FROM whatsapp_linked_account WHERE id = $1 AND user_id = $2 AND state = 'connected' AND generation = $3 FOR SHARE",
            account.id, user, account.generation
        ).fetch_optional(&mut *tx).await.map_err(failure)?.ok_or(ExternalChatError::Forbidden)?;
        lock_chat_in(&mut tx, binding.id).await?;
        let replayed = sqlx::query_scalar!(
            "SELECT id FROM whatsapp_send WHERE chat_id = $1 AND user_id = $2 AND idempotency_key = $3",
            binding.id,
            user,
            request.idempotency_key
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?
        .is_some();
        let identity = account
            .identity
            .as_deref()
            .ok_or(ExternalChatError::Forbidden)?;
        let observed_at = match binding.kind {
            ExternalChatKind::Group => {
                let metadata = sqlx::query_scalar!(
                    "SELECT metadata FROM whatsapp_roster WHERE account_id = $1 AND group_jid = $2",
                    account.id,
                    binding.remote_id
                )
                .fetch_optional(&mut *tx)
                .await
                .map_err(failure)?
                .map(decode::<GroupInfo>)
                .transpose()?
                .ok_or(ExternalChatError::Forbidden)?;
                if !metadata.can_post(identity) {
                    return Err(ExternalChatError::Forbidden.into());
                }
                metadata.observed_at
            }
            // Only the owner's own account is in a direct chat.
            ExternalChatKind::Direct if binding.user_id == user => Utc::now(),
            ExternalChatKind::Direct => return Err(ExternalChatError::Forbidden.into()),
        };
        sqlx::query!(r#"INSERT INTO whatsapp_chat_membership (chat_id,account_id,generation,consent_at,remote_member,can_post,reconciled,observed_at)
            VALUES ($1,$2,$3,clock_timestamp(),true,true,true,$4)
            ON CONFLICT (chat_id,account_id) DO UPDATE SET generation = excluded.generation,consent_ended_at = NULL,
            remote_member = true,can_post = true,reconciled = true,observed_at = excluded.observed_at"#,
            binding.id,account.id,account.generation,observed_at).execute(&mut *tx).await.map_err(failure)?;
        // The group lock also serializes idempotency and sequence allocation.
        let sequence = if replayed {
            None
        } else {
            Some(sqlx::query_scalar!(
            r#"UPDATE external_chat b SET next_sequence = next_sequence + 1
            WHERE b.id = $1 AND b.state = 'active'
              AND EXISTS (
                SELECT 1 FROM whatsapp_linked_account a JOIN whatsapp_chat_membership m ON m.account_id = a.id
                WHERE a.id = $2 AND a.user_id = $3 AND a.state = 'connected' AND a.generation = $4
                  AND m.chat_id = b.id AND m.generation = a.generation AND m.consent_ended_at IS NULL
                  AND m.remote_member AND m.can_post AND m.reconciled)
              AND external_chat_can_view(b.id, $3)
            RETURNING next_sequence"#,
            binding.id,
            account.id,
            user,
            account.generation
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?
        .ok_or(ExternalChatError::Forbidden)?)
        };
        if let Some(sequence) = sequence {
            sqlx::query!(
            r#"INSERT INTO whatsapp_send (id, account_id, chat_id, user_id, idempotency_key, request_sha256, payload, generation, chat_sequence, traceparent, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, clock_timestamp())
            ON CONFLICT (chat_id, user_id, idempotency_key) DO NOTHING"#,
            Uuid::now_v7(),
            account.id,
            binding.id,
            user,
            request.idempotency_key,
            &digest[..],
            payload,
            account.generation,
            sequence,
            external_chat::signals::trace_context::current()
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        }
        let stored = sqlx::query!(
            r#"SELECT id, user_id, chat_id, payload, state, message_id, error_code, created_at, request_sha256, account_id, generation
            FROM whatsapp_send WHERE chat_id = $1 AND user_id = $2 AND idempotency_key = $3"#,
            binding.id,
            user,
            request.idempotency_key
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(failure)?;
        if stored.request_sha256 != digest
            || stored.account_id != account.id
            || stored.generation != account.generation
        {
            return Err(ExternalChatError::Conflict.into());
        }
        notify(&mut tx, signals::SEND_REQUESTED, account.id).await?;
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
        let user = user.as_ref();
        sqlx::query_as!(
            SendRow,
            r#"SELECT id, user_id, chat_id, payload, state, message_id, error_code, created_at FROM whatsapp_send
            WHERE chat_id = $1 AND user_id = $2 AND state IN ('pending', 'sending', 'unknown', 'failed')
              AND created_at > now() - interval '7 days'
            ORDER BY created_at DESC LIMIT 50"#,
            chat_id,
            user
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
            r#"SELECT DISTINCT ON (message_id) message_id AS "message_id!", state FROM whatsapp_send
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

    async fn sends_for(
        &self,
        chat_id: Uuid,
        user: &MacroUserIdStr<'_>,
        ids: &[Uuid],
    ) -> ExternalChatResult<Vec<SendProgress>> {
        let user = user.as_ref();
        sqlx::query_as!(
            SendRow,
            r#"SELECT id, user_id, chat_id, payload, state, message_id, error_code, created_at FROM whatsapp_send
            WHERE chat_id = $1 AND user_id = $2 AND (id = ANY($3) OR message_id = ANY($3))
            ORDER BY created_at LIMIT 100"#,
            chat_id,
            user,
            ids
        )
        .fetch_all(&self.pool)
        .await
        .map_err(failure)?
        .into_iter()
        .map(progress)
        .collect()
    }
}

/// Source reference of a group message in this binding, preferring the
/// account's own identity as the author alias.
async fn target_in(
    tx: &mut Transaction<'_, Postgres>,
    binding: Uuid,
    message: Uuid,
    identity: Option<&str>,
) -> ExternalChatResult<Option<Target>> {
    Ok(sqlx::query!(
        r#"SELECT m.source_id, a.jid FROM external_chat_message m
        JOIN whatsapp_identity_alias a ON a.chat_id = m.chat_id AND a.person_id = m.person_id
        WHERE m.chat_id = $1 AND m.message_id = $2
        ORDER BY (a.jid = $3) DESC, a.jid LIMIT 1"#,
        binding,
        message,
        identity
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(failure)?
    .map(|row| Target {
        source_id: row.source_id,
        sender_jid: row.jid,
    }))
}

async fn content_in(
    tx: &mut Transaction<'_, Postgres>,
    binding: Uuid,
    request: &SendReply,
    identity: Option<&str>,
) -> ExternalChatResult<Option<OutgoingContent>> {
    Ok(match &request.message {
        ReplyContent::Media { upload_id, caption } => {
            let Some(blob) = sqlx::query!(
                "SELECT mime, filename, width, height, duration_seconds FROM external_chat_media_blob WHERE id = $1",
                upload_id
            )
            .fetch_optional(&mut **tx)
            .await
            .map_err(failure)?
            else {
                return Ok(None);
            };
            let Some(kind) = MediaKind::of(&blob.mime) else {
                return Ok(None);
            };
            Some(OutgoingContent::Media {
                kind,
                mime: blob.mime,
                filename: blob.filename,
                caption: caption.clone(),
                quote: match request.reply_to {
                    Some(quoted) => target_in(tx, binding, quoted, identity).await?,
                    None => None,
                },
                shape: MediaShape {
                    width: unsigned(blob.width),
                    height: unsigned(blob.height),
                    duration_seconds: unsigned(blob.duration_seconds),
                },
            })
        }
        ReplyContent::Text { text, mentions } => Some(OutgoingContent::Text {
            text: text.clone(),
            quote: match request.reply_to {
                Some(quoted) => target_in(tx, binding, quoted, identity).await?,
                None => None,
            },
            mentions: mentions.clone(),
        }),
        ReplyContent::Mutation {
            message_id,
            operation,
            text,
        } => {
            let Some(target) = target_in(tx, binding, *message_id, identity).await? else {
                return Ok(None);
            };
            Some(match operation {
                Mutation::Reaction => OutgoingContent::Reaction {
                    target,
                    emoji: text.clone().unwrap_or_default(),
                },
                Mutation::Edit => OutgoingContent::Edit {
                    target,
                    text: text.clone().unwrap_or_default(),
                },
                Mutation::Delete => OutgoingContent::Delete { target },
            })
        }
    })
}

impl PgWhatsAppRepository {
    pub(super) async fn claim_sends(
        &self,
        scope: SessionScope,
        limit: i64,
    ) -> ExternalChatResult<Vec<ClaimedSend>> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_in(&mut tx, scope).await?;
        let mut failed = sqlx::query_scalar!(
            r#"UPDATE whatsapp_send SET state = 'failed', error_code = 'send_expired', updated_at = now()
            WHERE account_id = $1 AND state = 'pending' AND created_at <= clock_timestamp() - make_interval(secs => $2)
            RETURNING chat_id"#,
            account.id,
            SEND_EXPIRY_SECONDS as f64
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(failure)?;
        let rows = sqlx::query!(
            r#"UPDATE whatsapp_send s SET state = 'sending', claimed_epoch = $2, updated_at = now()
            FROM external_chat b
            WHERE s.id IN (
                SELECT id FROM whatsapp_send WHERE account_id = $1 AND generation = $3 AND state = 'pending'
                ORDER BY chat_id, chat_sequence LIMIT $4 FOR UPDATE SKIP LOCKED)
              AND b.id = s.chat_id
            RETURNING s.id, s.chat_id, s.chat_sequence, s.payload, s.traceparent, b.remote_id,
              (SELECT r.metadata FROM whatsapp_roster r WHERE r.account_id = s.account_id AND r.group_jid = b.remote_id) AS roster"#,
            account.id,
            scope.lease_epoch,
            account.generation,
            limit
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(failure)?;
        let mut claimed = Vec::with_capacity(rows.len());
        for row in rows {
            let request: SendReply = decode(row.payload)?;
            match content_in(
                &mut tx,
                row.chat_id,
                &request,
                account.identity_jid.as_deref(),
            )
            .await?
            {
                Some(content) => claimed.push(ClaimedSend {
                    id: row.id,
                    group_jid: row.remote_id,
                    chat_sequence: row.chat_sequence,
                    content,
                    disappearing_seconds: row
                        .roster
                        .map(decode::<GroupInfo>)
                        .transpose()?
                        .and_then(|roster| roster.disappearing_seconds),
                    traceparent: row.traceparent,
                }),
                None => {
                    sqlx::query!(
                        "UPDATE whatsapp_send SET state = 'failed', error_code = 'target_unavailable', claimed_epoch = NULL, updated_at = now() WHERE id = $1",
                        row.id
                    )
                    .execute(&mut *tx)
                    .await
                    .map_err(failure)?;
                    failed.push(row.chat_id);
                }
            }
        }
        failed.sort();
        failed.dedup();
        for chat_id in failed {
            notify_change(&mut tx, Change::Chat { chat_id }).await?;
        }
        claimed.sort_by_key(|send| send.chat_sequence);
        tx.commit().await.map_err(failure)?;
        Ok(claimed)
    }

    pub(super) async fn begin_dispatch(
        &self,
        scope: SessionScope,
        send: Uuid,
        source_id: &str,
    ) -> ExternalChatResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_in(&mut tx, scope).await?;
        let expired = sqlx::query_scalar!(
            r#"UPDATE whatsapp_send SET state = 'failed', error_code = 'send_expired', claimed_epoch = NULL, updated_at = now()
            WHERE id = $1 AND account_id = $2 AND state = 'sending' AND dispatch_started_at IS NULL
              AND created_at <= clock_timestamp() - make_interval(secs => $3)
            RETURNING chat_id"#,
            send,
            account.id,
            SEND_EXPIRY_SECONDS as f64
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?;
        if let Some(chat_id) = expired {
            notify_change(&mut tx, Change::Chat { chat_id }).await?;
            tx.commit().await.map_err(failure)?;
            return Err(ExternalChatError::SendExpired.into());
        }
        // Every sending fact is re-checked at the moment of the fence.
        let changed = sqlx::query!(
            r#"UPDATE whatsapp_send s SET dispatch_started_at = clock_timestamp(), allocated_source_id = $4, updated_at = now()
            FROM whatsapp_linked_account a, whatsapp_chat_membership m, external_chat b
            WHERE s.id = $1 AND s.account_id = $2 AND s.claimed_epoch = $3 AND s.state = 'sending' AND s.dispatch_started_at IS NULL
              AND a.id = s.account_id AND a.user_id = s.user_id AND a.generation = s.generation AND a.state = 'connected'
              AND b.id = s.chat_id AND b.state = 'active'
              AND m.chat_id = s.chat_id AND m.account_id = s.account_id AND m.generation = s.generation
              AND m.consent_ended_at IS NULL AND m.reconciled AND m.remote_member AND m.can_post
              AND external_chat_can_view(s.chat_id, s.user_id)"#,
            send,
            account.id,
            scope.lease_epoch,
            source_id
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        if changed.rows_affected() != 1 {
            // Not dispatchable now: return it to the queue unless it is already settled.
            sqlx::query!(
                "UPDATE whatsapp_send SET state = 'pending', claimed_epoch = NULL, updated_at = now() WHERE id = $1 AND account_id = $2 AND state = 'sending' AND dispatch_started_at IS NULL",
                send,
                account.id
            )
            .execute(&mut *tx)
            .await
            .map_err(failure)?;
            tx.commit().await.map_err(failure)?;
            return Err(ExternalChatError::Forbidden.into());
        }
        tx.commit().await.map_err(failure)
    }

    pub(super) async fn record_send_outcome(
        &self,
        scope: SessionScope,
        send: Uuid,
        outcome: &SendOutcome,
    ) -> ExternalChatResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_in(&mut tx, scope).await?;
        let binding = sqlx::query_scalar!(
            "SELECT chat_id FROM whatsapp_send WHERE id = $1 AND account_id = $2",
            send,
            account.id
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?
        .ok_or(ExternalChatError::NotFound)?;
        lock_chat_in(&mut tx, binding).await?;
        let row = sqlx::query!(
            r#"SELECT s.chat_id, s.payload, s.allocated_source_id, s.state, s.created_at
            FROM whatsapp_send s WHERE s.id = $1 AND s.account_id = $2 AND s.dispatch_started_at IS NOT NULL FOR UPDATE"#,
            send,
            account.id
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?
        .ok_or(ExternalChatError::NotFound)?;
        match outcome {
            SendOutcome::Unknown => {
                sqlx::query!(
                    "UPDATE whatsapp_send SET state = 'unknown', claimed_epoch = NULL, updated_at = now() WHERE id = $1 AND state = 'sending'",
                    send
                )
                .execute(&mut *tx)
                .await
                .map_err(failure)?;
            }
            SendOutcome::Rejected { code } => {
                sqlx::query!(
                    "UPDATE whatsapp_send SET state = 'failed', error_code = $2, claimed_epoch = NULL, updated_at = now() WHERE id = $1 AND state IN ('sending', 'unknown')",
                    send,
                    code.chars().take(64).collect::<String>()
                )
                .execute(&mut *tx)
                .await
                .map_err(failure)?;
            }
            SendOutcome::Accepted { server_at } => {
                let source = row
                    .allocated_source_id
                    .ok_or_else(|| corrupt("a dispatched send has no source id"))?;
                let identity = account
                    .identity_jid
                    .clone()
                    .ok_or(ExternalChatError::Disconnected)?;
                let request: SendReply = decode(row.payload)?;
                let binding = sqlx::query_as!(
                    ChatRow,
                    "SELECT id, provider, remote_id, kind, user_id, state, adopted_at FROM external_chat WHERE id = $1",
                    row.chat_id
                )
                .fetch_one(&mut *tx)
                .await
                .map_err(failure)
                .and_then(chat_ref)?;
                let mut media = vec![];
                let mut upload = None;
                let (kind, text, target) = match &request.message {
                    ReplyContent::Media { upload_id, caption } => {
                        let blob = sqlx::query!(
                            "SELECT mime, filename, sha256, octet_length(bytes) AS \"size!\", width, height, duration_seconds FROM external_chat_media_blob WHERE id = $1",
                            upload_id
                        )
                        .fetch_one(&mut *tx)
                        .await
                        .map_err(failure)?;
                        media.push(Media {
                            mime: blob.mime,
                            filename: blob.filename,
                            size: blob.size.max(0) as u64,
                            sha256: blob
                                .sha256
                                .try_into()
                                .map_err(|_| corrupt("sha256 is not 32 bytes"))?,
                            locator: vec![],
                            width: unsigned(blob.width),
                            height: unsigned(blob.height),
                            duration_seconds: unsigned(blob.duration_seconds),
                            presentation: None,
                        });
                        upload = Some(*upload_id);
                        (
                            MessageKind::Text,
                            caption.clone().unwrap_or_default(),
                            match request.reply_to {
                                Some(quoted) => {
                                    target_in(&mut tx, binding.id, quoted, Some(&identity)).await?
                                }
                                None => None,
                            },
                        )
                    }
                    ReplyContent::Text { text, .. } => (
                        MessageKind::Text,
                        text.clone(),
                        match request.reply_to {
                            Some(quoted) => {
                                target_in(&mut tx, binding.id, quoted, Some(&identity)).await?
                            }
                            None => None,
                        },
                    ),
                    ReplyContent::Mutation {
                        message_id,
                        operation,
                        text,
                    } => (
                        match operation {
                            Mutation::Reaction => MessageKind::Reaction,
                            Mutation::Edit => MessageKind::Edit,
                            Mutation::Delete => MessageKind::Delete,
                        },
                        text.clone().unwrap_or_default(),
                        target_in(&mut tx, binding.id, *message_id, Some(&identity)).await?,
                    ),
                };
                if kind != MessageKind::Text && target.is_none() {
                    // The target vanished after dispatch; acceptance stays recorded.
                    sqlx::query!(
                        "UPDATE whatsapp_send SET state = 'accepted', claimed_epoch = NULL, updated_at = now() WHERE id = $1 AND state IN ('sending', 'unknown')",
                        send
                    )
                    .execute(&mut *tx)
                    .await
                    .map_err(failure)?;
                    return tx.commit().await.map_err(failure);
                }
                let event = InboundEvent {
                    event_id: send,
                    group_jid: binding.remote_id.clone(),
                    chat_alternate_jid: None,
                    source_at: *server_at,
                    observed_at: Utc::now(),
                    kind: InboundKind::Message(Message {
                        source_id: source.clone(),
                        sender: Identity {
                            jid: identity,
                            alternate_jid: None,
                            display_name: None,
                        },
                        kind,
                        text,
                        history: false,
                        from_me: true,
                        revision: server_at.timestamp_millis(),
                        target,
                        media,
                        mentions: match &request.message {
                            ReplyContent::Text { mentions, .. } => mentions.clone(),
                            _ => vec![],
                        },
                        forwarded: false,
                        view_once: false,
                        rich: None,
                    }),
                };
                let InboundKind::Message(message) = &event.kind else {
                    return Err(corrupt("an accepted send is not a message"));
                };
                sqlx::query!(
                    "UPDATE whatsapp_send SET state = 'accepted', claimed_epoch = NULL, updated_at = now() WHERE id = $1 AND state IN ('sending', 'unknown')",
                    send
                )
                .execute(&mut *tx)
                .await
                .map_err(failure)?;
                // Without a reservation (target gone, content owner left) the
                // acceptance stays recorded and no group message is written.
                if let ingest::Reserve::Reserved(reservation) = ingest::reserve_in(
                    &mut tx,
                    account.id,
                    account.generation,
                    &binding,
                    &event,
                    message,
                    Some(send),
                )
                .await?
                {
                    let changed =
                        ingest::persist_in(&mut tx, &event, message, &reservation).await?;
                    ingest::finish_in(&mut tx, &reservation, changed).await?;
                    // The staged upload is imported as the attachment's static file.
                    if let Some(upload) = upload {
                        sqlx::query!(
                            r#"UPDATE external_chat_attachment SET blob_id = $4, state = 'downloaded', retry_at = now()
                            WHERE chat_id = $1 AND person_id = $2 AND source_id = $3 AND ordinal = 0 AND state = 'pending'"#,
                            reservation.binding.id,
                            reservation.person,
                            reservation.source,
                            upload
                        )
                        .execute(&mut *tx)
                        .await
                        .map_err(failure)?;
                        notify(&mut tx, external_chat::signals::MEDIA_READY, upload).await?;
                    }
                }
            }
        }
        notify_change(&mut tx, Change::Chat { chat_id: binding }).await?;
        tx.commit().await.map_err(failure)
    }

    pub(super) async fn outbound_media(
        &self,
        scope: SessionScope,
        send: Uuid,
    ) -> ExternalChatResult<OutboundMedia> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_in(&mut tx, scope).await?;
        let row = sqlx::query!(
            r#"SELECT b.mime, b.filename, b.sha256, b.bytes FROM whatsapp_send s
            JOIN external_chat_media_blob b ON b.id = (s.payload->'message'->>'uploadId')::uuid
              AND b.user_id = s.user_id AND b.chat_id = s.chat_id
            WHERE s.id = $1 AND s.account_id = $2 AND s.claimed_epoch = $3 AND s.state = 'sending'
              AND s.payload->'message'->>'type' = 'media'"#,
            send,
            account.id,
            scope.lease_epoch
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?
        .ok_or(ExternalChatError::NotFound)?;
        tx.commit().await.map_err(failure)?;
        Ok(OutboundMedia {
            kind: MediaKind::of(&row.mime)
                .ok_or_else(|| corrupt(format_args!("staged upload type {:?}", row.mime)))?,
            mime: row.mime,
            filename: row.filename,
            sha256: row
                .sha256
                .try_into()
                .map_err(|_| corrupt("sha256 is not 32 bytes"))?,
            bytes: row.bytes,
        })
    }

    pub(super) async fn release_sends(&self, scope: SessionScope) -> ExternalChatResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_in(&mut tx, scope).await?;
        sqlx::query!(
            "UPDATE whatsapp_send SET state = 'pending', claimed_epoch = NULL, updated_at = now() WHERE account_id = $1 AND state = 'sending' AND dispatch_started_at IS NULL",
            account.id
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        tx.commit().await.map_err(failure)
    }
}
