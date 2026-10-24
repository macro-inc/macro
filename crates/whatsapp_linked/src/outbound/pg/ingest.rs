//! Canonical source identity and direct persistence for adopted WhatsApp groups.
//! Observers converge on one standalone message per (group, person, source id).
//! Text, revisions, reactions and attachment reservations commit atomically.

use super::*;
use crate::domain::events::*;
use chrono::{DateTime, Utc};

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
    pub binding: Binding,
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
    /// Retry later: the target has not arrived or the binding needs an owner.
    Defer,
    /// The sender identity is ambiguous.
    Quarantine,
    /// Nothing to persist now (stored revision waits for its original).
    Skip,
}

/// How far before adoption or consent a message may be stamped and still be
/// imported. WhatsApp stamps messages in whole seconds by its own clock, which
/// can differ from ours; comparing exactly drops messages sent in the same
/// second as adoption. Including messages from up to this long before adoption
/// is acceptable.
const CONSENT_SKEW_SECONDS: f64 = 10.0;

/// Bindings whose consent covers this observation.
pub(super) async fn observed_bindings_in(
    tx: &mut Transaction<'_, Postgres>,
    account: &Fenced,
    group: &str,
    source_at: DateTime<Utc>,
) -> LinkedResult<Vec<Binding>> {
    sqlx::query_as!(
        bindings::BindingRow,
        r#"SELECT b.id, b.team_id, b.group_jid, b.user_id, b.state, b.ownership_state, b.adopted_at
        FROM whatsapp_group b JOIN whatsapp_group_membership m ON m.binding_id = b.id
        WHERE b.group_jid = $1 AND b.state = 'active'
          AND m.account_id = $2 AND m.generation = $3 AND m.consent_ended_at IS NULL
          AND m.remote_member AND m.reconciled
          AND $4 >= date_trunc('second', b.adopted_at) - make_interval(secs => $6)
          AND $4 >= date_trunc('second', m.consent_at) - make_interval(secs => $6)
          AND whatsapp_group_can_view(b.id, $5)
        ORDER BY b.id LIMIT 100"#,
        group,
        account.id,
        account.generation,
        source_at,
        account.user_id,
        CONSENT_SKEW_SECONDS
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(failure)?
    .into_iter()
    .map(bindings::binding)
    .collect()
}

/// Reserve the canonical source under the binding lock. Conflicting aliases are
/// quarantined, never guessed from names or merged by text or time.
pub(super) async fn reserve_in(
    tx: &mut Transaction<'_, Postgres>,
    observer: Uuid,
    generation: i64,
    binding: &Binding,
    event: &InboundEvent,
    message: &Message,
    accepted_send: Option<Uuid>,
) -> LinkedResult<Reserve> {
    let current = sqlx::query!(
        "SELECT state, ownership_state FROM whatsapp_group WHERE id = $1 FOR UPDATE",
        binding.id
    )
    .fetch_one(&mut **tx)
    .await
    .map_err(failure)?;
    if current.state != "active" && accepted_send.is_none() {
        return Ok(Reserve::Skip);
    }
    if current.ownership_state != "active" {
        return Ok(Reserve::Defer);
    }
    let sender = &message.sender;
    let mut aliases = vec![sender.jid.clone()];
    aliases.extend(sender.alternate_jid.clone());
    let people = sqlx::query_scalar!(
        "SELECT DISTINCT person_id FROM whatsapp_identity_alias WHERE binding_id = $1 AND jid = ANY($2)",
        binding.id,
        &aliases
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(failure)?;
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
        r#"INSERT INTO whatsapp_external_person (id, binding_id, user_id, display_name) VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO UPDATE SET display_name = COALESCE(excluded.display_name, whatsapp_external_person.display_name),
            user_id = COALESCE(excluded.user_id, whatsapp_external_person.user_id)"#,
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
            r#"INSERT INTO whatsapp_identity_alias (binding_id, jid, person_id, evidence_account_id, verified_at)
            VALUES ($1, $2, $3, $4, $5) ON CONFLICT (binding_id, jid) DO NOTHING"#,
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
    if message.kind == MessageKind::Reaction {
        let target = message
            .target
            .as_ref()
            .ok_or(LinkedError::Invalid("reaction without a target"))?;
        let row = sqlx::query!(
            r#"SELECT m.person_id, m.message_id, m.origin, m.deleted_at, m.revision_content, m.content_revision, m.revised_at
            FROM whatsapp_group_message m JOIN whatsapp_identity_alias a ON a.binding_id = m.binding_id AND a.person_id = m.person_id
            WHERE m.binding_id = $1 AND a.jid = $2 AND m.source_id = $3"#,
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
            .ok_or(LinkedError::Invalid("revision without a target"))?
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
        WHERE s.binding_id = $1 AND s.allocated_source_id = $2 AND a.identity_jid = ANY($3) AND s.dispatch_started_at IS NOT NULL
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
        return Err(LinkedError::Conflict.into());
    }
    let new_origin = if send.is_some() {
        "macro"
    } else if message.history {
        "history"
    } else {
        "whatsapp"
    };
    let deleted = (message.kind == MessageKind::Delete).then_some(event.source_at);
    let content = (message.kind == MessageKind::Edit).then(|| message.text.clone());
    let content_revision = if revision { message.revision.max(1) } else { 0 };
    sqlx::query!(
        r#"INSERT INTO whatsapp_group_message (id, binding_id, person_id, source_id, origin, source_at, content_revision, deleted_at, revision_content, revised_at)
        VALUES ($11, $1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (binding_id, person_id, source_id) DO UPDATE SET
            deleted_at = COALESCE(whatsapp_group_message.deleted_at, excluded.deleted_at),
            revision_content = CASE WHEN excluded.content_revision > whatsapp_group_message.content_revision
                THEN excluded.revision_content ELSE whatsapp_group_message.revision_content END,
            revised_at = CASE WHEN excluded.content_revision > whatsapp_group_message.content_revision
                THEN excluded.revised_at ELSE whatsapp_group_message.revised_at END,
            content_revision = GREATEST(whatsapp_group_message.content_revision, excluded.content_revision),
            source_at = CASE WHEN $10 THEN whatsapp_group_message.source_at ELSE excluded.source_at END"#,
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
        send.as_ref().map_or_else(Uuid::now_v7, |s| s.id)
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    sqlx::query!(
        r#"INSERT INTO whatsapp_message_observation (binding_id, person_id, source_id, account_id, generation, observed_at)
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
        FROM whatsapp_group_message WHERE binding_id = $1 AND person_id = $2 AND source_id = $3"#,
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

/// One reservation per attachment ordinal. Every observer offers its sealed
/// locator; a pending reservation takes the newest one so a working observer
/// can download it. Unsupported types fail at once.
async fn reserve_attachments_in(
    tx: &mut Transaction<'_, Postgres>,
    r: &Reservation,
    message: &Message,
) -> LinkedResult<()> {
    for (ordinal, media) in message.media.iter().enumerate() {
        let state = if MediaKind::of(&media.mime).is_some() {
            "pending"
        } else {
            "failed"
        };
        sqlx::query!(
            r#"INSERT INTO whatsapp_group_attachment (binding_id, person_id, source_id, ordinal, document_id, sha256, state, account_id, locator, mime, filename, size)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (binding_id, person_id, source_id, ordinal) DO UPDATE SET account_id = excluded.account_id, locator = excluded.locator
            WHERE whatsapp_group_attachment.state = 'pending'
              AND (whatsapp_group_attachment.claimed_until IS NULL OR whatsapp_group_attachment.claimed_until < now())"#,
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
            media.size.min(i64::MAX as u64) as i64
        )
        .execute(&mut **tx)
        .await
        .map_err(failure)?;
    }
    Ok(())
}

/// Persist the standalone group message or mutation, without group_id effects.
pub(super) async fn persist_in(
    tx: &mut Transaction<'_, Postgres>,
    event: &InboundEvent,
    message: &Message,
    r: &Reservation,
) -> LinkedResult<bool> {
    if let Some(actor) = r.reaction_actor {
        return Ok(sqlx::query!(r#"INSERT INTO whatsapp_group_reaction (message_id,person_id,emoji,user_id,source_id,revision,updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            ON CONFLICT (message_id,person_id) DO UPDATE SET emoji = excluded.emoji,user_id = excluded.user_id,
                source_id = excluded.source_id,revision = excluded.revision,updated_at = excluded.updated_at
            WHERE (excluded.revision,excluded.updated_at,excluded.source_id) > (whatsapp_group_reaction.revision,whatsapp_group_reaction.updated_at,whatsapp_group_reaction.source_id)"#,
            r.message,actor,message.text,r.associated_user,message.source_id,message.revision,event.source_at)
            .execute(&mut **tx).await.map_err(failure)?.rows_affected() > 0);
    }
    let reply_to = if r.create {
        match message.target.as_ref() {
            Some(target) => sqlx::query_scalar!(r#"SELECT m.id FROM whatsapp_group_message m
                JOIN whatsapp_identity_alias a ON a.binding_id = m.binding_id AND a.person_id = m.person_id
                WHERE m.binding_id = $1 AND m.source_id = $2 AND a.jid = $3 AND m.message_id IS NOT NULL"#,
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
        r#"UPDATE whatsapp_group_message SET body = $4,
        reply_to = COALESCE(reply_to,$5), message_id = id
        WHERE binding_id = $1 AND person_id = $2 AND source_id = $3
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
        sqlx::query!("UPDATE whatsapp_group_attachment SET state = 'deleted' WHERE binding_id = $1 AND person_id = $2 AND source_id = $3",r.binding.id,r.person,r.source)
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
) -> LinkedResult<()> {
    if r.reaction_actor.is_none() {
        sqlx::query!(
            r#"UPDATE whatsapp_group_message SET message_id = $4, effect_revision = effect_revision + CASE WHEN $5 THEN 1 ELSE 0 END,
                notification_retry_at = now(), origin = CASE WHEN $6 THEN 'macro' ELSE origin END
            WHERE binding_id = $1 AND person_id = $2 AND source_id = $3"#,
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
            r#"UPDATE whatsapp_group_message SET effect_revision = effect_revision + 1, notification_retry_at = now()
            WHERE binding_id = $1 AND person_id = $2 AND source_id = $3"#,
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
            WHERE binding_id = $1 AND user_id = $2 AND allocated_source_id = $3 AND dispatch_started_at IS NOT NULL"#,
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
        notify(tx, signals::GROUP_EFFECTS, r.message).await?;
    }
    Ok(())
}

/// Retain an event for later ingestion or retry, bounded per account.
async fn retain_in(
    tx: &mut Transaction<'_, Postgres>,
    account: &Fenced,
    event: &InboundEvent,
    state: &str,
) -> LinkedResult<()> {
    let retained = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM whatsapp_inbound_event WHERE account_id = $1"#,
        account.id
    )
    .fetch_one(&mut **tx)
    .await
    .map_err(failure)?;
    if retained >= MAX_RETAINED_EVENTS {
        return Err(LinkedError::Unavailable.into());
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
) -> LinkedResult<IngestOutcome> {
    match &event.kind {
        InboundKind::Left => {
            groups::left_in(tx, account, &event.group_jid, event.observed_at).await?;
            Ok(IngestOutcome::Applied)
        }
        InboundKind::Receipt(receipt) => {
            let mut stored = 0;
            for source in &receipt.source_ids {
                stored += sqlx::query!(
                    r#"INSERT INTO whatsapp_participant_receipt (account_id, binding_id, source_id, participant_jid, receipt_state, source_at)
                    SELECT $1, b.id, $4, $5, $6, $7 FROM whatsapp_group b JOIN whatsapp_group_membership m ON m.binding_id = b.id
                    WHERE b.group_jid = $2 AND m.account_id = $1 AND m.generation = $3 AND m.consent_ended_at IS NULL
                      AND whatsapp_group_can_view(b.id, $8)
                    ON CONFLICT (account_id, binding_id, source_id, participant_jid, receipt_state)
                    DO UPDATE SET source_at = GREATEST(whatsapp_participant_receipt.source_at, excluded.source_at)"#,
                    account.id,
                    event.group_jid,
                    account.generation,
                    source,
                    receipt.participant_jid,
                    receipt.state,
                    event.source_at,
                    account.user_id
                )
                .execute(&mut **tx)
                .await
                .map_err(failure)?
                .rows_affected();
            }
            Ok(if stored > 0 {
                IngestOutcome::Applied
            } else {
                tracing::debug!(account_id = %account.id, event_id = %event.event_id, reason = "no_observing_binding", "WhatsApp receipt not observed");
                IngestOutcome::NotObserved
            })
        }
        InboundKind::Message(message) => {
            let bindings =
                observed_bindings_in(tx, account, &event.group_jid, event.source_at).await?;
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

impl PgLinkedRepository {
    pub(super) async fn ingest_event(
        &self,
        scope: SessionScope,
        event: &InboundEvent,
    ) -> LinkedResult<IngestOutcome> {
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
            Err(error) if matches!(error.current_context(), LinkedError::Unavailable) => {
                // Infrastructure failure: retain the event for retry when possible.
                tx.rollback().await.map_err(failure)?;
                let mut tx = self.pool.begin().await.map_err(failure)?;
                let account = fence_in(&mut tx, scope).await?;
                retain_in(&mut tx, &account, event, "pending").await?;
                tx.commit().await.map_err(failure)?;
                tracing::warn!(
                    event_id = %event.event_id,
                    code = error.current_context().code(),
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
    ) -> LinkedResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_in(&mut tx, scope).await?;
        let observed = sqlx::query_scalar!(
            r#"SELECT EXISTS(SELECT 1 FROM whatsapp_group g
            JOIN whatsapp_group_membership m ON m.binding_id=g.id
            WHERE g.group_jid=$1 AND g.state='active' AND m.account_id=$2 AND m.generation=$3
              AND m.consent_ended_at IS NULL AND m.remote_member AND m.reconciled
              AND whatsapp_group_can_view(g.id,$4)) AS "observed!""#,
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
            return Err(LinkedError::Unavailable.into());
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
    ) -> LinkedResult<Vec<InboundEvent>> {
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
