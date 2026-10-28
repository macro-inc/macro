//! Canonical source identity and direct persistence for adopted WhatsApp groups.
//! Observers converge on one standalone message per (group, person, source id).
//! Text, revisions, reactions and attachment reservations commit atomically.

use super::*;
use crate::domain::events::*;
use chrono::{DateTime, Utc};
use external_chat::domain::rich::RichContent;

/// Deferred and quarantined events kept per account before ingestion pushes back.
const MAX_RETAINED_EVENTS: i64 = 4096;
/// Attempts before a deferred event is dropped.
const MAX_ATTEMPTS: i32 = 20;

/// A locked canonical source reservation, independent of the observing account.
pub(super) struct Reservation {
    /// Account whose observation produced this reservation.
    pub observer: Uuid,
    /// External author of a reaction, distinct from the target's author.
    pub reaction_actor: Option<Uuid>,
    pub binding: ChatRef,
    /// Verified external person who authored the source message.
    pub person: Uuid,
    /// Group message.
    pub message: Uuid,
    /// The group message does not exist yet.
    pub create: bool,
    /// Macro user who deliberately sent it, when it is the echo of a send.
    pub actor: Option<String>,
    /// Verified Macro association of the author, for display only.
    pub associated_user: Option<String>,
    /// Canonical source id, also for mutations of older messages.
    pub source: String,
    pub deleted_at: Option<DateTime<Utc>>,
    pub revision_content: Option<String>,
}

/// What to do with an event for one binding.
pub(super) enum Reserve {
    /// Persist through this reservation.
    Reserved(Box<Reservation>),
    /// Retry later: the target has not arrived.
    Defer,
    /// The sender identity is ambiguous.
    Quarantine,
    /// Nothing to persist now (stored revision waits for its original).
    Skip,
}

/// Namespace of each group's stand-in person: the author of system lines
/// WhatsApp reported without naming anyone.
const GROUP_PERSON_NAMESPACE: Uuid = Uuid::from_u128(0x2f7c_9a41_5d0e_4b83_9c16_7e2a_b04d_51f8);

/// How far before adoption or consent a message may be stamped and still be
/// imported. WhatsApp stamps messages in whole seconds by its own clock, which
/// can differ from ours; comparing exactly drops messages sent in the same
/// second as adoption. Including messages from up to this long before adoption
/// is acceptable.
const CONSENT_SKEW_SECONDS: f64 = 10.0;

/// Bindings whose consent covers this observation. Live messages count from
/// adoption on; earlier messages the owner's phone sends as history go only to
/// the owner's own groups, which asked for them by being added.
pub(super) async fn observed_bindings_in(
    tx: &mut Transaction<'_, Postgres>,
    account: &Fenced,
    group: &str,
    source_at: DateTime<Utc>,
    history: bool,
) -> ExternalChatResult<Vec<ChatRef>> {
    sqlx::query_as!(
        ChatRow,
        r#"SELECT b.id, b.provider, b.remote_id, b.kind, b.user_id, b.state, b.adopted_at
        FROM external_chat b JOIN whatsapp_chat_membership m ON m.chat_id = b.id
        WHERE b.provider = 'whatsapp' AND b.remote_id = $1 AND b.state = 'active'
          AND m.account_id = $2 AND m.generation = $3 AND m.consent_ended_at IS NULL
          AND m.remote_member AND m.reconciled
          AND CASE WHEN $7 THEN b.user_id = $5 ELSE
            $4 >= date_trunc('second', b.adopted_at) - make_interval(secs => $6)
            AND $4 >= date_trunc('second', m.consent_at) - make_interval(secs => $6) END
          AND external_chat_can_view(b.id, $5)
        ORDER BY b.id LIMIT 100"#,
        group,
        account.id,
        account.generation,
        source_at,
        account.user_id,
        CONSENT_SKEW_SECONDS,
        history
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(failure)?
    .into_iter()
    .map(chat_ref)
    .collect()
}

/// Reserve the canonical source under the binding lock. Conflicting aliases are
/// quarantined, never guessed from names or merged by text or time.
pub(super) async fn reserve_in(
    tx: &mut Transaction<'_, Postgres>,
    observer: Uuid,
    generation: i64,
    binding: &ChatRef,
    event: &InboundEvent,
    message: &Message,
    accepted_send: Option<Uuid>,
) -> ExternalChatResult<Reserve> {
    let current = sqlx::query_scalar!(
        "SELECT state FROM external_chat WHERE id = $1 FOR UPDATE",
        binding.id
    )
    .fetch_one(&mut **tx)
    .await
    .map_err(failure)?;
    if current != "active" && accepted_send.is_none() {
        return Ok(Reserve::Skip);
    }
    let sender = &message.sender;
    // A group change WhatsApp made without naming anyone belongs to the
    // group's own stand-in person, which has no alias.
    let group_itself = sender.jid == binding.remote_id;
    let mut aliases = vec![];
    if !group_itself {
        aliases.push(sender.jid.clone());
        aliases.extend(sender.alternate_jid.clone());
    }
    let people = if group_itself {
        vec![Uuid::new_v5(&GROUP_PERSON_NAMESPACE, binding.id.as_bytes())]
    } else {
        sqlx::query_scalar!(
            "SELECT DISTINCT person_id FROM whatsapp_identity_alias WHERE chat_id = $1 AND jid = ANY($2)",
            binding.id,
            &aliases
        )
        .fetch_all(&mut **tx)
        .await
        .map_err(failure)?
    };
    // A LID alone cannot be matched to a phone-number alias already seen.
    if people.len() > 1
        || (people.is_empty() && sender.jid.ends_with("@lid") && sender.alternate_jid.is_none())
    {
        return Ok(Reserve::Quarantine);
    }
    let associated_user = sqlx::query_scalar!(
        "SELECT user_id FROM whatsapp_linked_account WHERE identity_jid = ANY($1) LIMIT 1",
        &aliases
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(failure)?;
    let person = people.first().copied().unwrap_or_else(Uuid::now_v7);
    sqlx::query!(
        r#"INSERT INTO external_chat_person (id, chat_id, user_id, display_name) VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO UPDATE SET display_name = COALESCE(excluded.display_name, external_chat_person.display_name),
            user_id = COALESCE(excluded.user_id, external_chat_person.user_id)"#,
        person,
        binding.id,
        associated_user,
        sender.display_name
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    for alias in &aliases {
        sqlx::query!(
            r#"INSERT INTO whatsapp_identity_alias (chat_id, jid, person_id, evidence_account_id, verified_at)
            VALUES ($1, $2, $3, $4, $5) ON CONFLICT (chat_id, jid) DO NOTHING"#,
            binding.id,
            alias,
            person,
            observer,
            event.observed_at
        )
        .execute(&mut **tx)
        .await
        .map_err(failure)?;
    }
    // Reactions and poll votes belong to the person who sent them, on the
    // target's message.
    if matches!(message.kind, MessageKind::Reaction | MessageKind::PollVote) {
        let target = message
            .target
            .as_ref()
            .ok_or(ExternalChatError::Invalid("reaction without a target"))?;
        let row = sqlx::query!(
            r#"SELECT m.person_id, m.message_id, m.origin, m.deleted_at, m.revision_content, m.content_revision, m.revised_at
            FROM external_chat_message m JOIN whatsapp_identity_alias a ON a.chat_id = m.chat_id AND a.person_id = m.person_id
            WHERE m.chat_id = $1 AND a.jid = $2 AND m.source_id = $3"#,
            binding.id,
            target.sender_jid,
            target.source_id
        )
        .fetch_optional(&mut **tx)
        .await
        .map_err(failure)?;
        let Some((row, message_id)) = row.and_then(|row| row.message_id.map(|id| (row, id))) else {
            return Ok(Reserve::Defer);
        };
        return Ok(Reserve::Reserved(Box::new(Reservation {
            observer,
            reaction_actor: Some(person),
            binding: binding.clone(),
            person: row.person_id,
            message: message_id,
            create: false,
            actor: None,
            associated_user,
            source: target.source_id.clone(),
            deleted_at: row.deleted_at,
            revision_content: row.revision_content,
        })));
    }
    let revision = matches!(message.kind, MessageKind::Edit | MessageKind::Delete);
    let source = if revision {
        message
            .target
            .as_ref()
            .ok_or(ExternalChatError::Invalid("revision without a target"))?
            .source_id
            .clone()
    } else {
        message.source_id.clone()
    };
    // The echo of a deliberate Macro send converges on the send's preallocated id.
    // Edits and deletes keep the original message's author and attribution.
    let send = if revision {
        None
    } else {
        sqlx::query!(
        r#"SELECT s.id, s.user_id FROM whatsapp_send s JOIN whatsapp_linked_account a ON a.id = s.account_id
        WHERE s.chat_id = $1 AND s.allocated_source_id = $2 AND a.identity_jid = ANY($3) AND s.dispatch_started_at IS NOT NULL
          AND ($4::uuid IS NULL OR s.id = $4)"#,
        binding.id,
        source,
        &aliases,
        accepted_send
        )
        .fetch_optional(&mut **tx)
        .await
        .map_err(failure)?
    };
    if accepted_send.is_some() && !revision && send.is_none() {
        return Err(ExternalChatError::Conflict.into());
    }
    let new_origin = if send.is_some() {
        "macro"
    } else if message.history {
        "history"
    } else {
        "remote"
    };
    let deleted = (message.kind == MessageKind::Delete).then_some(event.source_at);
    let content = (message.kind == MessageKind::Edit).then(|| message.text.clone());
    let content_revision = if revision { message.revision.max(1) } else { 0 };
    let entry_kind = if message.kind == MessageKind::System {
        "system"
    } else {
        "message"
    };
    let rich = message
        .rich
        .as_ref()
        .map(serde_json::to_value)
        .transpose()
        .map_err(failure)?;
    // A redelivered or re-imported message fills in what an earlier copy
    // lacked (an older importer stored polls and the like as placeholders);
    // revisions carry none of it and keep what is stored.
    sqlx::query!(
        r#"INSERT INTO external_chat_message (id, chat_id, person_id, source_id, origin, source_at, content_revision, deleted_at, revision_content, revised_at,
            kind, rich, mentions, forwarded, view_once)
        VALUES ($11, $1, $2, $3, $4, $5, $6, $7, $8, $9, $12, $13, $14, $15, $16)
        ON CONFLICT (chat_id, person_id, source_id) DO UPDATE SET
            deleted_at = COALESCE(external_chat_message.deleted_at, excluded.deleted_at),
            revision_content = CASE WHEN excluded.content_revision > external_chat_message.content_revision
                THEN excluded.revision_content ELSE external_chat_message.revision_content END,
            revised_at = CASE WHEN excluded.content_revision > external_chat_message.content_revision
                THEN excluded.revised_at ELSE external_chat_message.revised_at END,
            content_revision = GREATEST(external_chat_message.content_revision, excluded.content_revision),
            source_at = CASE WHEN $10 THEN external_chat_message.source_at ELSE excluded.source_at END,
            kind = CASE WHEN $10 THEN external_chat_message.kind ELSE excluded.kind END,
            rich = CASE WHEN $10 THEN external_chat_message.rich ELSE COALESCE(excluded.rich, external_chat_message.rich) END,
            mentions = CASE WHEN $10 OR cardinality(excluded.mentions) = 0 THEN external_chat_message.mentions ELSE excluded.mentions END,
            forwarded = external_chat_message.forwarded OR excluded.forwarded,
            view_once = external_chat_message.view_once OR excluded.view_once"#,
        binding.id,
        person,
        source,
        new_origin,
        event.source_at,
        content_revision,
        deleted,
        content,
        revision.then_some(event.source_at),
        revision,
        send.as_ref().map_or_else(Uuid::now_v7, |s| s.id),
        entry_kind,
        rich,
        &message.mentions,
        message.forwarded,
        message.view_once
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    sqlx::query!(
        r#"INSERT INTO whatsapp_message_observation (chat_id, person_id, source_id, account_id, generation, observed_at)
        VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING"#,
        binding.id,
        person,
        source,
        observer,
        generation,
        event.observed_at
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    let row = sqlx::query!(
        r#"SELECT id, message_id, origin, deleted_at, revision_content, content_revision, revised_at
        FROM external_chat_message WHERE chat_id = $1 AND person_id = $2 AND source_id = $3"#,
        binding.id,
        person,
        source
    )
    .fetch_one(&mut **tx)
    .await
    .map_err(failure)?;
    // A revision that arrives before its original is applied with the original.
    if revision && row.message_id.is_none() {
        return Ok(Reserve::Skip);
    }
    Ok(Reserve::Reserved(Box::new(Reservation {
        observer,
        reaction_actor: None,
        binding: binding.clone(),
        person,
        message: row.message_id.unwrap_or(row.id),
        create: row.message_id.is_none(),
        actor: send.map(|s| s.user_id),
        associated_user,
        source,
        deleted_at: row.deleted_at,
        revision_content: row.revision_content,
    })))
}

/// A declared pixel size, when it is one.
fn dimension(value: Option<u32>) -> Option<i32> {
    value
        .filter(|value| *value > 0)
        .map(|value| value.min(i32::MAX as u32) as i32)
}

/// One reservation per attachment ordinal. Every observer offers its sealed
/// locator; a pending reservation takes the newest one so a working observer
/// can download it. Unsupported types fail at once.
async fn reserve_attachments_in(
    tx: &mut Transaction<'_, Postgres>,
    r: &Reservation,
    message: &Message,
) -> ExternalChatResult<()> {
    for (ordinal, media) in message.media.iter().enumerate() {
        let state = if MediaKind::of(&media.mime).is_some() {
            "pending"
        } else {
            "failed"
        };
        sqlx::query!(
            r#"INSERT INTO external_chat_attachment (chat_id, person_id, source_id, ordinal, blob_id, sha256, state, account_id, locator, mime, filename, size,
                width, height, duration_seconds, presentation)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            ON CONFLICT (chat_id, person_id, source_id, ordinal) DO UPDATE SET account_id = excluded.account_id, locator = excluded.locator
            WHERE external_chat_attachment.state = 'pending'
              AND (external_chat_attachment.claimed_until IS NULL OR external_chat_attachment.claimed_until < now())"#,
            r.binding.id,
            r.person,
            r.source,
            ordinal as i16,
            Uuid::now_v7(),
            &media.sha256[..],
            state,
            r.observer,
            &media.locator,
            media.mime,
            media.filename.chars().take(255).collect::<String>(),
            media.size.min(i64::MAX as u64) as i64,
            dimension(media.width),
            dimension(media.height),
            media.duration_seconds.map(|seconds| seconds.min(i32::MAX as u32) as i32),
            media.presentation.map(MediaPresentation::as_str)
        )
        .execute(&mut **tx)
        .await
        .map_err(failure)?;
    }
    Ok(())
}

/// Persist the standalone group message or mutation, without chat_id effects.
pub(super) async fn persist_in(
    tx: &mut Transaction<'_, Postgres>,
    event: &InboundEvent,
    message: &Message,
    r: &Reservation,
) -> ExternalChatResult<bool> {
    if message.kind == MessageKind::PollVote {
        let (Some(actor), Some(RichContent::PollVote(vote))) = (r.reaction_actor, &message.rich)
        else {
            return Err(ExternalChatError::Invalid("poll vote without a choice").into());
        };
        return Ok(sqlx::query!(
            r#"INSERT INTO external_chat_poll_vote (message_id, person_id, selected, user_id, source_id, revision, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (message_id, person_id) DO UPDATE SET selected = excluded.selected, user_id = excluded.user_id,
                source_id = excluded.source_id, revision = excluded.revision, updated_at = excluded.updated_at
            WHERE (excluded.revision, excluded.updated_at, excluded.source_id)
                > (external_chat_poll_vote.revision, external_chat_poll_vote.updated_at, external_chat_poll_vote.source_id)"#,
            r.message,
            actor,
            &vote.selected,
            r.associated_user,
            message.source_id,
            message.revision,
            event.source_at
        )
        .execute(&mut **tx)
        .await
        .map_err(failure)?
        .rows_affected()
            > 0);
    }
    if let Some(actor) = r.reaction_actor {
        return Ok(sqlx::query!(r#"INSERT INTO external_chat_reaction (message_id,person_id,emoji,user_id,source_id,revision,updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            ON CONFLICT (message_id,person_id) DO UPDATE SET emoji = excluded.emoji,user_id = excluded.user_id,
                source_id = excluded.source_id,revision = excluded.revision,updated_at = excluded.updated_at
            WHERE (excluded.revision,excluded.updated_at,excluded.source_id) > (external_chat_reaction.revision,external_chat_reaction.updated_at,external_chat_reaction.source_id)"#,
            r.message,actor,message.text,r.associated_user,message.source_id,message.revision,event.source_at)
            .execute(&mut **tx).await.map_err(failure)?.rows_affected() > 0);
    }
    let reply_to = if r.create {
        match message.target.as_ref() {
            Some(target) => sqlx::query_scalar!(r#"SELECT m.id FROM external_chat_message m
                JOIN whatsapp_identity_alias a ON a.chat_id = m.chat_id AND a.person_id = m.person_id
                WHERE m.chat_id = $1 AND m.source_id = $2 AND a.jid = $3 AND m.message_id IS NOT NULL"#,
                r.binding.id,target.source_id,target.sender_jid).fetch_optional(&mut **tx).await.map_err(failure)?,
            None => None,
        }
    } else {
        None
    };
    let content = if r.deleted_at.is_some() {
        ""
    } else {
        r.revision_content.as_deref().unwrap_or(&message.text)
    };
    let changed = sqlx::query!(
        r#"UPDATE external_chat_message SET body = $4,
        reply_to = COALESCE(reply_to,$5), message_id = id
        WHERE chat_id = $1 AND person_id = $2 AND source_id = $3
          AND (message_id IS NULL OR body IS DISTINCT FROM $4)"#,
        r.binding.id,
        r.person,
        r.source,
        content,
        reply_to
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?
    .rows_affected()
        > 0;
    if matches!(message.kind, MessageKind::Text | MessageKind::Unsupported) {
        reserve_attachments_in(tx, r, message).await?;
    }
    if r.deleted_at.is_some() {
        sqlx::query!("UPDATE external_chat_attachment SET state = 'deleted', file_id = NULL WHERE chat_id = $1 AND person_id = $2 AND source_id = $3",r.binding.id,r.person,r.source)
            .execute(&mut **tx).await.map_err(failure)?;
    }
    Ok(r.create || changed || matches!(message.kind, MessageKind::Edit | MessageKind::Delete))
}

/// Link the reservation to its group message, queue publication, and settle
/// the send it echoes.
pub(super) async fn finish_in(
    tx: &mut Transaction<'_, Postgres>,
    r: &Reservation,
    changed: bool,
) -> ExternalChatResult<()> {
    if r.reaction_actor.is_none() {
        sqlx::query!(
            r#"UPDATE external_chat_message SET message_id = $4, effect_revision = effect_revision + CASE WHEN $5 THEN 1 ELSE 0 END,
                notification_retry_at = now(), origin = CASE WHEN $6 THEN 'macro' ELSE origin END
            WHERE chat_id = $1 AND person_id = $2 AND source_id = $3"#,
            r.binding.id,
            r.person,
            r.source,
            r.message,
            changed,
            r.actor.is_some()
        )
        .execute(&mut **tx)
        .await
        .map_err(failure)?;
    } else if changed {
        sqlx::query!(
            r#"UPDATE external_chat_message SET effect_revision = effect_revision + 1, notification_retry_at = now()
            WHERE chat_id = $1 AND person_id = $2 AND source_id = $3"#,
            r.binding.id,
            r.person,
            r.source
        )
        .execute(&mut **tx)
        .await
        .map_err(failure)?;
    }
    if let Some(actor) = &r.actor {
        sqlx::query!(
            r#"UPDATE whatsapp_send SET state = CASE WHEN state IN ('sending', 'unknown') THEN 'accepted' ELSE state END,
                message_id = $4, claimed_epoch = NULL, updated_at = now()
            WHERE chat_id = $1 AND user_id = $2 AND allocated_source_id = $3 AND dispatch_started_at IS NOT NULL"#,
            r.binding.id,
            actor,
            r.source,
            r.message
        )
        .execute(&mut **tx)
        .await
        .map_err(failure)?;
    }
    if changed {
        notify(tx, external_chat::signals::CHAT_EFFECTS, r.message).await?;
    }
    if changed || r.actor.is_some() {
        notify_change(
            tx,
            Change::Chat {
                chat_id: r.binding.id,
            },
        )
        .await?;
    }
    Ok(())
}

fn is_lid(jid: &str) -> bool {
    jid.ends_with("@lid")
}

/// The sender with both halves of its phone-number/LID pair when the account
/// knows them. A message with WhatsApp's from-me flag is the account's own,
/// whatever address it carries. A LID-only sender takes its phone number from
/// the account's roster of the group, which lists each participant's pair as
/// WhatsApp reported it. Anything still LID-only is quarantined by
/// `reserve_in`.
async fn resolve_sender_in(
    tx: &mut Transaction<'_, Postgres>,
    account: &Fenced,
    group: &str,
    message: &Message,
) -> ExternalChatResult<Identity> {
    let mut sender = message.sender.clone();
    if message.from_me
        && let Some(own) = &account.identity_jid
    {
        let lid = [Some(&sender.jid), sender.alternate_jid.as_ref()]
            .into_iter()
            .flatten()
            .find(|jid| is_lid(jid))
            .cloned();
        sender.jid = own.clone();
        sender.alternate_jid = lid;
        return Ok(sender);
    }
    if !is_lid(&sender.jid) || sender.alternate_jid.is_some() {
        return Ok(sender);
    }
    sender.alternate_jid = sqlx::query_scalar!(
        r#"SELECT p->>'jid' AS "jid!" FROM whatsapp_roster r
        CROSS JOIN LATERAL jsonb_array_elements(r.metadata->'participants') p
        WHERE r.account_id = $1 AND r.group_jid = $2 AND p->>'alternateJid' = $3
          AND p->>'jid' LIKE '%@s.whatsapp.net'
        LIMIT 1"#,
        account.id,
        group,
        sender.jid
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(failure)?;
    Ok(sender)
}

/// Retain an event for later ingestion or retry, bounded per account.
async fn retain_in(
    tx: &mut Transaction<'_, Postgres>,
    account: &Fenced,
    event: &InboundEvent,
    state: &str,
) -> ExternalChatResult<()> {
    let retained = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM whatsapp_inbound_event WHERE account_id = $1"#,
        account.id
    )
    .fetch_one(&mut **tx)
    .await
    .map_err(failure)?;
    if retained >= MAX_RETAINED_EVENTS {
        return Err(ExternalChatError::Backlogged.into());
    }
    let payload = serde_json::to_value(event).map_err(failure)?;
    sqlx::query!(
        r#"INSERT INTO whatsapp_inbound_event (account_id, event_id, generation, payload, state, retry_at)
        VALUES ($1, $2, $3, $4, $5, now() + interval '10 seconds')
        ON CONFLICT (account_id, event_id) DO UPDATE SET state = excluded.state, attempts = whatsapp_inbound_event.attempts + 1,
            retry_at = now() + least(interval '10 seconds' * power(2, whatsapp_inbound_event.attempts), interval '1 hour')"#,
        account.id,
        event.event_id,
        account.generation,
        payload,
        state
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    Ok(())
}

async fn apply_in(
    tx: &mut Transaction<'_, Postgres>,
    account: &Fenced,
    event: &InboundEvent,
) -> ExternalChatResult<IngestOutcome> {
    match &event.kind {
        InboundKind::Left => {
            groups::left_in(tx, account, &event.group_jid, event.observed_at).await?;
            Ok(IngestOutcome::Applied)
        }
        InboundKind::Receipt(receipt) => {
            let stored = sqlx::query!(
                r#"INSERT INTO whatsapp_participant_receipt (account_id, chat_id, source_id, participant_jid, receipt_state, source_at)
                SELECT $1, b.id, source.id, $5, $6, $7
                FROM external_chat b JOIN whatsapp_chat_membership m ON m.chat_id = b.id
                CROSS JOIN (SELECT DISTINCT unnest($4::text[]) AS id) source
                WHERE b.provider = 'whatsapp' AND b.remote_id = $2 AND m.account_id = $1 AND m.generation = $3 AND m.consent_ended_at IS NULL
                  AND external_chat_can_view(b.id, $8)
                ON CONFLICT (account_id, chat_id, source_id, participant_jid, receipt_state)
                DO UPDATE SET source_at = GREATEST(whatsapp_participant_receipt.source_at, excluded.source_at)"#,
                account.id,
                event.group_jid,
                account.generation,
                &receipt.source_ids,
                receipt.participant_jid,
                receipt.state.as_ref(),
                event.source_at,
                account.user_id
            )
            .execute(&mut **tx)
            .await
            .map_err(failure)?
            .rows_affected();
            Ok(if stored > 0 {
                IngestOutcome::Applied
            } else {
                tracing::debug!(account_id = %account.id, event_id = %event.event_id, reason = "no_observing_binding", "WhatsApp receipt not observed");
                IngestOutcome::NotObserved
            })
        }
        InboundKind::Message(message) => {
            let message = &Message {
                sender: resolve_sender_in(tx, account, &event.group_jid, message).await?,
                ..message.clone()
            };
            let bindings = observed_bindings_in(
                tx,
                account,
                &event.group_jid,
                event.source_at,
                message.history,
            )
            .await?;
            if bindings.is_empty() {
                tracing::debug!(
                    account_id = %account.id,
                    event_id = %event.event_id,
                    reason = "no_binding_observes_group_at_source_time",
                    "WhatsApp message not observed"
                );
                return Ok(IngestOutcome::NotObserved);
            }
            for binding in &bindings {
                match reserve_in(
                    tx,
                    account.id,
                    account.generation,
                    binding,
                    event,
                    message,
                    None,
                )
                .await?
                {
                    Reserve::Reserved(reservation) => {
                        let changed = persist_in(tx, event, message, &reservation).await?;
                        finish_in(tx, &reservation, changed).await?;
                    }
                    Reserve::Skip => {}
                    Reserve::Defer => {
                        retain_in(tx, account, event, "pending").await?;
                        return Ok(IngestOutcome::Deferred);
                    }
                    Reserve::Quarantine => {
                        retain_in(tx, account, event, "quarantined").await?;
                        return Ok(IngestOutcome::Quarantined);
                    }
                }
            }
            Ok(IngestOutcome::Applied)
        }
    }
}

impl PgWhatsAppRepository {
    pub(super) async fn ingest_event(
        &self,
        scope: SessionScope,
        event: &InboundEvent,
    ) -> ExternalChatResult<IngestOutcome> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_in(&mut tx, scope).await?;
        if account.state != AccountState::Connected {
            tracing::debug!(account_id = %account.id, event_id = %event.event_id, reason = "account_not_connected", "WhatsApp event not observed");
            return Ok(IngestOutcome::NotObserved);
        }
        match apply_in(&mut tx, &account, event).await {
            Ok(outcome) => {
                if matches!(outcome, IngestOutcome::Applied | IngestOutcome::NotObserved) {
                    sqlx::query!(
                        "DELETE FROM whatsapp_inbound_event WHERE account_id = $1 AND event_id = $2",
                        account.id,
                        event.event_id
                    )
                    .execute(&mut *tx)
                    .await
                    .map_err(failure)?;
                }
                tx.commit().await.map_err(failure)?;
                Ok(outcome)
            }
            Err(error) if matches!(error.current_context(), ExternalChatError::Unavailable) => {
                // Infrastructure failure: retain the event for retry when possible.
                tx.rollback().await.map_err(failure)?;
                let mut tx = self.pool.begin().await.map_err(failure)?;
                let account = fence_in(&mut tx, scope).await?;
                retain_in(&mut tx, &account, event, "pending").await?;
                tx.commit().await.map_err(failure)?;
                tracing::warn!(
                    event_id = %event.event_id,
                    code = error.current_context().code(),
                    error = %error,
                    "WhatsApp event deferred after a persistence failure"
                );
                Ok(IngestOutcome::Deferred)
            }
            Err(error) => {
                // A permanent rejection never applies; drop any stored copy.
                tx.rollback().await.map_err(failure)?;
                sqlx::query!(
                    "DELETE FROM whatsapp_inbound_event WHERE account_id = $1 AND event_id = $2",
                    scope.account_id,
                    event.event_id
                )
                .execute(&self.pool)
                .await
                .map_err(failure)?;
                Err(error)
            }
        }
    }

    pub(super) async fn enqueue_inbound(
        &self,
        scope: SessionScope,
        event: &InboundEvent,
    ) -> ExternalChatResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_in(&mut tx, scope).await?;
        let observed = sqlx::query_scalar!(
            r#"SELECT EXISTS(SELECT 1 FROM external_chat g
            JOIN whatsapp_chat_membership m ON m.chat_id=g.id
            WHERE g.provider='whatsapp' AND g.remote_id=$1 AND g.state='active' AND m.account_id=$2 AND m.generation=$3
              AND m.consent_ended_at IS NULL AND m.remote_member AND m.reconciled
              AND external_chat_can_view(g.id,$4)) AS "observed!""#,
            event.group_jid,
            account.id,
            account.generation,
            account.user_id
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(failure)?;
        if !observed {
            return Ok(());
        }
        let retained = sqlx::query_scalar!(
            r#"SELECT count(*) AS "count!" FROM whatsapp_inbound_event WHERE account_id = $1"#,
            account.id
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(failure)?;
        if retained >= MAX_RETAINED_EVENTS {
            return Err(ExternalChatError::Backlogged.into());
        }
        let payload = serde_json::to_value(event).map_err(failure)?;
        sqlx::query!(
            r#"INSERT INTO whatsapp_inbound_event (account_id, event_id, generation, payload, state, retry_at)
            VALUES ($1, $2, $3, $4, 'pending', now()) ON CONFLICT (account_id, event_id) DO NOTHING"#,
            account.id,
            event.event_id,
            account.generation,
            payload
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        tx.commit().await.map_err(failure)
    }

    pub(super) async fn due_events(
        &self,
        scope: SessionScope,
        limit: i64,
    ) -> ExternalChatResult<Vec<InboundEvent>> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_in(&mut tx, scope).await?;
        let dropped = sqlx::query_scalar!(
            "DELETE FROM whatsapp_inbound_event WHERE account_id = $1 AND (attempts >= $2 OR generation <> $3) RETURNING event_id",
            account.id,
            MAX_ATTEMPTS,
            account.generation
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(failure)?;
        if !dropped.is_empty() {
            tracing::warn!(
                count = dropped.len(),
                "Dropped WhatsApp events that never applied"
            );
        }
        let payloads = sqlx::query_scalar!(
            "SELECT payload FROM whatsapp_inbound_event WHERE account_id = $1 AND retry_at <= now() ORDER BY retry_at, event_id LIMIT $2",
            account.id,
            limit
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(failure)?;
        tx.commit().await.map_err(failure)?;
        payloads.into_iter().map(decode).collect()
    }
}
