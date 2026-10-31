//! In-process API for the WhatsApp session service. The replica that holds an
//! account's advisory lock calls these with the [`SessionScope`] it received from
//! [`SessionService::begin_lease`]; every write is fenced by that epoch, and a
//! `Fenced` error means the replica must stop the account immediately.

use super::{
    events::*,
    jid::{Jid, JidKind, is_group_jid, is_person_jid},
    models::*,
    ports::*,
};
use external_chat::domain::{models::*, ports::ExternalChatResult, rich::RichContent};
use std::sync::Arc;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Largest inbound text Macro stores, in UTF-8 bytes.
const INBOUND_TEXT_LIMIT_BYTES: usize = 64 * 1024;

/// Session-service use cases.
#[derive(Clone)]
pub struct SessionService {
    repository: Arc<dyn SessionRepository>,
}

impl SessionService {
    /// Wire the repository at the session service's composition root.
    pub fn new(repository: Arc<dyn SessionRepository>) -> Self {
        Self { repository }
    }

    /// Take over an account after acquiring its advisory lock. Bumps the lease
    /// epoch, which fences every older replica, and records the previous
    /// replica's in-flight sends as `unknown`.
    #[tracing::instrument(name = "whatsapp.session.begin_lease", skip_all, err, fields(account_id = %account, lease_epoch))]
    pub async fn begin_lease(&self, account: Uuid) -> ExternalChatResult<Lease> {
        let lease = self.repository.begin_lease(account).await?;
        tracing::Span::current().record("lease_epoch", lease.scope.lease_epoch);
        if lease.sends_marked_unknown > 0 {
            tracing::warn!(
                count = lease.sends_marked_unknown,
                "Sends left in flight by the previous replica are unknown"
            );
        }
        Ok(lease)
    }

    /// Hand the account over: undispatched claims return to `pending`. Call after
    /// in-flight sends have recorded their outcome and before unlocking.
    #[tracing::instrument(name = "whatsapp.session.release_lease", skip_all, err, fields(account_id = %scope.account_id, lease_epoch = scope.lease_epoch))]
    pub async fn release_lease(&self, scope: SessionScope) -> ExternalChatResult<()> {
        self.repository.release_lease(scope).await
    }

    /// Tell other replicas an unlocked account still needs a session. Call
    /// after unlocking, or the next replica's lock attempt loses the race.
    pub async fn announce_released(&self, account: Uuid) -> ExternalChatResult<()> {
        self.repository.announce_released(account).await
    }

    /// Lifecycle of an account, for discovery and stop decisions.
    pub async fn account_state(&self, account: Uuid) -> ExternalChatResult<Option<AccountState>> {
        self.repository.account_state(account).await
    }

    /// Accounts that need a replica (connected, or pairing with a live
    /// transaction) and whose advisory lock nobody holds, least recently updated first.
    pub async fn discoverable_accounts(&self, limit: i64) -> ExternalChatResult<Vec<Uuid>> {
        self.repository
            .discoverable_accounts(limit.clamp(1, 1000))
            .await
    }

    /// Fleet-wide counts for health checks and monitors.
    pub async fn fleet_health(&self) -> ExternalChatResult<FleetHealth> {
        self.repository.fleet_health().await
    }

    /// Resolve a `whatsapp_pairing_requested` payload. Terminal states mean the
    /// replica should stop pairing (and log out a cancelled device).
    pub async fn pairing_work(&self, pairing: Uuid) -> ExternalChatResult<Option<PairingWork>> {
        self.repository.pairing_work(pairing).await
    }

    /// The account's live pairing transaction, checked after taking a lease.
    pub async fn live_pairing(
        &self,
        scope: SessionScope,
    ) -> ExternalChatResult<Option<PairingWork>> {
        self.repository.live_pairing(scope).await
    }

    /// Report pairing progress. Returns the transaction afterwards so the replica
    /// sees cancellation. A `Success` whose identity does not match a reconnect,
    /// or belongs to another person, fails the transaction with an error; the
    /// replica must then log the device out.
    #[tracing::instrument(name = "whatsapp.session.update_pairing", skip_all, err, fields(account_id = %scope.account_id, pairing_id = %pairing, update))]
    pub async fn update_pairing(
        &self,
        scope: SessionScope,
        pairing: Uuid,
        update: PairingUpdate,
    ) -> ExternalChatResult<PairingWork> {
        let (name, valid) = match &update {
            PairingUpdate::Qr(code) => ("qr", !code.is_empty() && code.len() <= 4096),
            PairingUpdate::PairCode(code) => ("pair_code", !code.is_empty() && code.len() <= 64),
            PairingUpdate::Passkey { challenge } => (
                "passkey",
                challenge.is_object() && challenge.to_string().len() <= PASSKEY_LIMIT_BYTES,
            ),
            PairingUpdate::Success { identity_jid } => (
                "success",
                Jid::parse(identity_jid).is_some_and(|jid| jid.kind == JidKind::Phone),
            ),
            PairingUpdate::Expired => ("expired", true),
            PairingUpdate::Failed => ("failed", true),
        };
        tracing::Span::current().record("update", name);
        if !valid {
            return Err(ExternalChatError::Invalid("invalid pairing update").into());
        }
        self.repository
            .update_pairing(scope, pairing, &update)
            .await
    }

    /// Take the owner's passkey assertion, once, to forward to WhatsApp.
    pub async fn take_passkey_response(
        &self,
        scope: SessionScope,
        pairing: Uuid,
    ) -> ExternalChatResult<Option<serde_json::Value>> {
        self.repository.take_passkey_response(scope, pairing).await
    }

    /// Attachments this account observed and should download now. Each claim
    /// lasts five minutes; call again to retry the unfinished ones later.
    #[tracing::instrument(name = "whatsapp.session.claim_media", skip_all, err, fields(account_id = %scope.account_id, count))]
    pub async fn claim_media_imports(
        &self,
        scope: SessionScope,
        limit: i64,
    ) -> ExternalChatResult<Vec<MediaImport>> {
        let claimed = self
            .repository
            .claim_media_imports(scope, limit.clamp(1, 16))
            .await?;
        tracing::Span::current().record("count", claimed.len());
        Ok(claimed)
    }

    /// Hand over decrypted bytes for an import. DSS stores them as a static
    /// file.
    #[tracing::instrument(name = "whatsapp.session.complete_media", skip_all, err, fields(account_id = %scope.account_id, size = bytes.len()))]
    pub async fn complete_media_import(
        &self,
        scope: SessionScope,
        attachment: &AttachmentRef,
        bytes: &[u8],
    ) -> ExternalChatResult<()> {
        if bytes.is_empty() || bytes.len() > MEDIA_LIMIT_BYTES {
            return Err(ExternalChatError::Invalid("attachment is empty or too large").into());
        }
        self.repository
            .complete_media_import(scope, attachment, bytes)
            .await
    }

    /// Report a failed download.
    #[tracing::instrument(name = "whatsapp.session.fail_media", skip_all, err, fields(account_id = %scope.account_id, failure = ?failure))]
    pub async fn fail_media_import(
        &self,
        scope: SessionScope,
        attachment: &AttachmentRef,
        failure: MediaFailure,
    ) -> ExternalChatResult<()> {
        self.repository
            .fail_media_import(scope, attachment, failure)
            .await
    }

    /// Bytes to upload for a claimed media send, before `begin_dispatch`.
    #[tracing::instrument(name = "whatsapp.session.outbound_media", skip_all, err, fields(account_id = %scope.account_id, send_id = %send))]
    pub async fn outbound_media(
        &self,
        scope: SessionScope,
        send: Uuid,
    ) -> ExternalChatResult<OutboundMedia> {
        self.repository.outbound_media(scope, send).await
    }

    /// WhatsApp logged the device out or rejected its credentials. Consent ends;
    /// the owner must reconnect explicitly.
    #[tracing::instrument(name = "whatsapp.session.logged_out", skip_all, err, fields(account_id = %scope.account_id))]
    pub async fn logged_out(&self, scope: SessionScope) -> ExternalChatResult<()> {
        self.repository.logged_out(scope).await
    }

    /// Report full metadata for the account's groups. With `complete`, the list
    /// is every group the account is in, and missing groups count as left.
    #[tracing::instrument(name = "whatsapp.session.update_groups", skip_all, err, fields(account_id = %scope.account_id, count = groups.len(), complete = complete))]
    pub async fn update_groups(
        &self,
        scope: SessionScope,
        groups: &[GroupInfo],
        complete: bool,
    ) -> ExternalChatResult<()> {
        if groups.len() > 10_000
            || groups.iter().any(|g| {
                !is_group_jid(&g.jid) || g.name.len() > 1024 || g.participants.len() > 5_000
            })
        {
            return Err(ExternalChatError::Invalid("invalid group metadata").into());
        }
        self.repository.update_groups(scope, groups, complete).await
    }

    /// Report the current metadata of one group after a live group event (joined,
    /// renamed, participants changed). Signals pages only when something changed.
    #[tracing::instrument(name = "whatsapp.session.update_group", skip_all, err, fields(account_id = %scope.account_id))]
    pub async fn update_group(
        &self,
        scope: SessionScope,
        group: &GroupInfo,
    ) -> ExternalChatResult<()> {
        self.update_groups(scope, std::slice::from_ref(group), false)
            .await
    }

    /// The account is no longer in this group, as a live group event or a
    /// refused metadata read showed.
    #[tracing::instrument(name = "whatsapp.session.group_left", skip_all, err, fields(account_id = %scope.account_id))]
    pub async fn group_left(
        &self,
        scope: SessionScope,
        group: &str,
        observed_at: chrono::DateTime<chrono::Utc>,
    ) -> ExternalChatResult<()> {
        if !is_group_jid(group) {
            return Err(ExternalChatError::Invalid("invalid group").into());
        }
        self.repository.group_left(scope, group, observed_at).await
    }

    /// Groups to keep: events from any other group are dropped before storage.
    pub async fn observed_groups(&self, scope: SessionScope) -> ExternalChatResult<Vec<String>> {
        self.repository.observed_groups(scope).await
    }

    /// Record what the account learned about chats in its WhatsApp chat list
    /// (history sync, live messages, contact and chat-setting updates). A
    /// batch is a whole history sync, so a chat whose JID or kind is invalid
    /// is skipped (counted on the span) rather than refusing the rest.
    #[tracing::instrument(name = "whatsapp.session.update_chats", skip_all, err, fields(account_id = %scope.account_id, count = chats.len(), skipped))]
    pub async fn update_chats(
        &self,
        scope: SessionScope,
        chats: &[ChatUpdate],
    ) -> ExternalChatResult<()> {
        let valid: Vec<ChatUpdate> = chats
            .iter()
            .filter(|chat| match chat.kind {
                ExternalChatKind::Group => is_group_jid(&chat.jid),
                ExternalChatKind::Direct => is_person_jid(&chat.jid),
            })
            .cloned()
            .collect();
        let skipped = chats.len() - valid.len();
        tracing::Span::current().record("skipped", skipped);
        if skipped > 0 {
            tracing::debug!(
                account_id = %scope.account_id,
                skipped,
                reason = "invalid_chat_jid",
                "Skipped WhatsApp chats with an invalid JID"
            );
        }
        if valid.is_empty() {
            return Ok(());
        }
        self.repository.update_chats(scope, &valid).await
    }

    /// The owner's groups still importing earlier messages from the phone.
    #[tracing::instrument(name = "whatsapp.session.backfill_work", skip_all, err, fields(account_id = %scope.account_id, count))]
    pub async fn backfill_work(
        &self,
        scope: SessionScope,
    ) -> ExternalChatResult<Vec<BackfillWork>> {
        let work = self.repository.backfill_work(scope).await?;
        tracing::Span::current().record("count", work.len());
        Ok(work)
    }

    /// Phone-number lookups the account's session should answer now.
    pub async fn pending_lookups(
        &self,
        scope: SessionScope,
    ) -> ExternalChatResult<Vec<LookupWork>> {
        self.repository.pending_lookups(scope).await
    }

    /// Record what WhatsApp answered about a looked-up number; a registered
    /// number's direct chat joins the chat list, ready to add.
    #[tracing::instrument(name = "whatsapp.session.complete_lookup", skip_all, err, fields(account_id = %scope.account_id, lookup_id = %lookup))]
    pub async fn complete_lookup(
        &self,
        scope: SessionScope,
        lookup: Uuid,
        answer: &LookupAnswer,
    ) -> ExternalChatResult<()> {
        if let LookupAnswer::Found { jid, .. } = answer
            && Jid::parse(jid).is_none_or(|jid| jid.kind != JidKind::Phone)
        {
            return Err(ExternalChatError::Invalid("a lookup found no phone-number JID").into());
        }
        self.repository.complete_lookup(scope, lookup, answer).await
    }

    /// No message of an added chat is known to start importing from.
    #[tracing::instrument(name = "whatsapp.session.backfill_waiting_for_message", skip_all, err, fields(account_id = %scope.account_id, chat_id = %group))]
    pub async fn backfill_waiting_for_message(
        &self,
        scope: SessionScope,
        group: Uuid,
    ) -> ExternalChatResult<()> {
        self.repository
            .backfill_waiting_for_message(scope, group)
            .await
    }

    /// A page of earlier messages was requested from the phone just now.
    #[tracing::instrument(name = "whatsapp.session.backfill_requested", skip_all, err, fields(account_id = %scope.account_id, chat_id = %group))]
    pub async fn backfill_requested(
        &self,
        scope: SessionScope,
        group: Uuid,
    ) -> ExternalChatResult<()> {
        self.repository.backfill_requested(scope, group).await
    }

    /// The phone did not answer; the import waits for it.
    #[tracing::instrument(name = "whatsapp.session.backfill_unanswered", skip_all, err, fields(account_id = %scope.account_id, chat_id = %group))]
    pub async fn backfill_unanswered(
        &self,
        scope: SessionScope,
        group: Uuid,
    ) -> ExternalChatResult<()> {
        self.repository.backfill_unanswered(scope, group).await
    }

    /// The phone sent a page of a chat's earlier messages (the messages
    /// themselves are ingested as history events).
    #[tracing::instrument(name = "whatsapp.session.backfill_page", skip_all, err, fields(account_id = %scope.account_id, messages = page.messages, complete = page.complete))]
    pub async fn backfill_page(
        &self,
        scope: SessionScope,
        page: &HistoryPage,
    ) -> ExternalChatResult<Vec<(Uuid, BackfillState)>> {
        if !is_group_jid(&page.chat_jid) && !is_person_jid(&page.chat_jid) {
            return Err(ExternalChatError::Invalid("a history page names no WhatsApp chat").into());
        }
        self.repository.backfill_page(scope, page).await
    }

    /// Persist one event from an observed group. Safe to repeat: every observing
    /// account converges on one group message per (binding, sender, source id).
    #[tracing::instrument(
        name = "whatsapp.session.ingest",
        skip_all, err,
        fields(account_id = %scope.account_id, event_id = %event.event_id, outcome, code)
    )]
    pub async fn ingest_event(
        &self,
        scope: SessionScope,
        event: &InboundEvent,
    ) -> ExternalChatResult<IngestOutcome> {
        let result = match validate_event(event) {
            Ok(()) => self.repository.ingest(scope, event).await,
            Err(error) => Err(error),
        };
        let span = tracing::Span::current();
        match &result {
            Ok(outcome) => span.record("outcome", tracing::field::debug(outcome)),
            Err(error) => span.record("code", error.current_context().code()),
        };
        result
    }

    /// Persist an event durably without notification or document work, so the protocol event can
    /// be acknowledged right after; `replay_deferred` ingests it. Idempotent on
    /// `event_id`. `Backlogged` when the account's backlog is full: do not ack.
    #[tracing::instrument(name = "whatsapp.session.enqueue_inbound", skip_all, err, fields(account_id = %scope.account_id, event_id = %event.event_id))]
    pub async fn enqueue_inbound(
        &self,
        scope: SessionScope,
        event: &InboundEvent,
    ) -> ExternalChatResult<()> {
        validate_event(event)?;
        self.repository.enqueue_inbound(scope, event).await
    }

    /// Ingest enqueued events and retry deferred ones whose time has come.
    /// Returns how many applied. Call after `enqueue_inbound` and periodically.
    #[tracing::instrument(name = "whatsapp.session.replay_deferred", skip_all, err, fields(account_id = %scope.account_id, due, applied))]
    pub async fn replay_deferred(&self, scope: SessionScope) -> ExternalChatResult<usize> {
        let due = self.repository.due_events(scope, 64).await?;
        tracing::Span::current().record("due", due.len());
        let mut applied = 0;
        for event in &due {
            match self.repository.ingest(scope, event).await {
                Ok(IngestOutcome::Applied) => applied += 1,
                Ok(_) => {}
                Err(error) if matches!(error.current_context(), ExternalChatError::Fenced) => {
                    return Err(error);
                }
                // One bad event never blocks the others; it stays deferred.
                Err(error) => tracing::warn!(
                    event_id = %event.event_id,
                    code = error.current_context().code(),
                    error = %error,
                    "Deferred WhatsApp event will retry"
                ),
            }
        }
        tracing::Span::current().record("applied", applied);
        Ok(applied)
    }

    /// Claim pending sends in group order. Answer `whatsapp_send_requested`.
    #[tracing::instrument(name = "whatsapp.session.claim_sends", skip_all, err, fields(account_id = %scope.account_id, count))]
    pub async fn claim_sends(
        &self,
        scope: SessionScope,
        limit: i64,
    ) -> ExternalChatResult<Vec<ClaimedSend>> {
        let claimed = self
            .repository
            .claim_sends(scope, limit.clamp(1, 64))
            .await?;
        tracing::Span::current().record("count", claimed.len());
        Ok(claimed)
    }

    /// Record that this send is about to be submitted with this WhatsApp message
    /// id. Only submit after this succeeds; afterwards the send is never retried.
    #[tracing::instrument(name = "whatsapp.session.begin_dispatch", skip_all, err, fields(account_id = %scope.account_id, send_id = %send))]
    pub async fn begin_dispatch(
        &self,
        scope: SessionScope,
        send: Uuid,
        source_id: &str,
    ) -> ExternalChatResult<()> {
        if source_id.is_empty() || source_id.len() > 256 {
            return Err(ExternalChatError::Invalid("invalid message id").into());
        }
        self.repository.begin_dispatch(scope, send, source_id).await
    }

    /// Record the outcome of a dispatched send.
    #[tracing::instrument(name = "whatsapp.session.send_outcome", skip_all, err, fields(account_id = %scope.account_id, send_id = %send, outcome))]
    pub async fn record_send_outcome(
        &self,
        scope: SessionScope,
        send: Uuid,
        outcome: SendOutcome,
    ) -> ExternalChatResult<()> {
        let name = match &outcome {
            SendOutcome::Accepted { .. } => "accepted",
            SendOutcome::Rejected { .. } => "rejected",
            SendOutcome::Unknown => "unknown",
        };
        tracing::Span::current().record("outcome", name);
        self.repository
            .record_send_outcome(scope, send, &outcome)
            .await
    }
}

pub(crate) fn validate_event(event: &InboundEvent) -> ExternalChatResult<()> {
    let direct = is_person_jid(&event.group_jid);
    if !is_group_jid(&event.group_jid) && !direct {
        return Err(ExternalChatError::Invalid("invalid chat").into());
    }
    if event
        .chat_alternate_jid
        .as_deref()
        .is_some_and(|alternate| !direct || !is_person_jid(alternate))
    {
        return Err(ExternalChatError::Invalid("invalid chat").into());
    }
    match &event.kind {
        InboundKind::Left => Ok(()),
        InboundKind::Receipt(receipt) => {
            if receipt.source_ids.is_empty()
                || receipt.source_ids.len() > 256
                || receipt
                    .source_ids
                    .iter()
                    .any(|id| id.is_empty() || id.len() > 256)
                || !is_person_jid(&receipt.participant_jid)
            {
                return Err(ExternalChatError::Invalid("invalid receipt").into());
            }
            Ok(())
        }
        InboundKind::Message(message) => {
            let sender = &message.sender;
            // A group change WhatsApp made without naming who did it is the
            // group's own.
            let group_itself = message.kind == MessageKind::System
                && sender.jid == event.group_jid
                && sender.alternate_jid.is_none();
            if message.source_id.is_empty()
                || message.source_id.len() > 256
                || !(is_person_jid(&sender.jid) || group_itself)
                || sender
                    .alternate_jid
                    .as_deref()
                    .is_some_and(|jid| !is_person_jid(jid))
                || sender
                    .display_name
                    .as_deref()
                    .is_some_and(|name| name.len() > 512)
                || message.text.len() > INBOUND_TEXT_LIMIT_BYTES
                || message.revision < 0
                || message.media.len() > 10
            {
                return Err(ExternalChatError::Invalid("invalid message").into());
            }
            let needs_target = matches!(
                message.kind,
                MessageKind::Reaction
                    | MessageKind::Edit
                    | MessageKind::Delete
                    | MessageKind::PollVote
            );
            if needs_target && message.target.is_none() {
                return Err(
                    ExternalChatError::Invalid("message operation without a target").into(),
                );
            }
            let rich_fits = match (message.kind, &message.rich) {
                (MessageKind::System, Some(RichContent::System(_)))
                | (MessageKind::PollVote, Some(RichContent::PollVote(_)))
                | (
                    MessageKind::Rich,
                    Some(
                        RichContent::Poll(_)
                        | RichContent::Location(_)
                        | RichContent::Contacts(_)
                        | RichContent::Event(_),
                    ),
                ) => true,
                (MessageKind::System | MessageKind::PollVote | MessageKind::Rich, _) => false,
                (_, rich) => rich.is_none(),
            };
            if !rich_fits || message.mentions.len() > 256 {
                return Err(ExternalChatError::Invalid("invalid message content").into());
            }
            // Only the verified author edits or deletes. Admin deletions need
            // separate role evidence and are not imported.
            if matches!(message.kind, MessageKind::Edit | MessageKind::Delete)
                && message.target.as_ref().is_some_and(|target| {
                    target.sender_jid != sender.jid
                        && sender.alternate_jid.as_deref() != Some(target.sender_jid.as_str())
                })
            {
                return Err(ExternalChatError::Forbidden.into());
            }
            Ok(())
        }
    }
}
