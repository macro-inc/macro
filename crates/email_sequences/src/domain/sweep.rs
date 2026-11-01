//! The sweep that creates, watches and withdraws steps, and the hook that
//! stops enrollments when a reply or bounce arrives.

use chrono::{DateTime, Duration, Utc};
use email::domain::{
    models::{ContactInfo, ScheduledSendStatus, UserProvider},
    sequence_steps::{
        CancelExpectation, CancelOutcome, InboundMessage, NewStep, ReplySearch, SequenceStepStore,
        StepState,
    },
};
use uuid::Uuid;

use super::{
    models::{EnrollmentReason, EnrollmentRow, EnrollmentStatus, HistoryRow, StepStatus},
    ports::{DueEnrollment, OwnerAccess, ReplyCandidates, SentStep, SequenceRepo},
    render,
    replies::{self, Enrolled, Incoming, Response, SentIdentity},
    service::{STUCK_AFTER, Sequences, in_flight, internal, recipient_contact},
};
use crate::domain::models::SequenceError;

/// Rows per sweep page.
const PAGE: i64 = 100;
/// Due enrollments per creation page.
const DUE_PAGE: i64 = 50;
/// The soonest a new step may send, so its schedule is in the future when committed.
const MIN_LEAD: Duration = Duration::seconds(60);
/// Sends from one inbox are at least this far apart.
const SPACING: Duration = Duration::seconds(30);
/// A step is created only when its slot is this close; later ones wait.
const MAX_LEAD: Duration = Duration::seconds(90);
/// Waits before automatic retries of a step Gmail refused.
const RETRY_DELAYS: [Duration; 3] = [
    Duration::minutes(5),
    Duration::minutes(15),
    Duration::minutes(45),
];
/// How long an enrollment waits after its step couldn't be created.
const CREATE_BACKOFF: Duration = Duration::minutes(5);

/// What trying to create a step did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Creation {
    Created,
    Skipped,
    /// The inbox's next send slot isn't near yet.
    InboxFull(Uuid),
}

/// What one sweep did.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct SweepReport {
    /// In-flight steps examined.
    pub resolved: u32,
    /// Steps created.
    pub created: u32,
    /// Orphaned schedules withdrawn.
    pub withdrawn: u32,
    /// Items that failed and will be retried.
    pub failed: u32,
}

/// The sending inbox, when a step may go out from it now.
fn usable_inbox(
    inbox: Option<email::domain::sequence_steps::SendingInbox>,
    owner_id: &str,
) -> Option<email::domain::sequence_steps::SendingInbox> {
    inbox.filter(|inbox| {
        inbox.healthy && inbox.provider == UserProvider::Gmail && inbox.macro_id == owner_id
    })
}

fn identities(history: &[HistoryRow]) -> Vec<SentIdentity> {
    history
        .iter()
        .map(|step| SentIdentity {
            message_id: step.message_id,
            delivery_message_id: step.delivery_message_id.clone(),
            provider_message_id: step.provider_message_id.clone(),
        })
        .collect()
}

/// Incoming mail after this can answer the enrollment: its first send, or
/// before that, its first step's planned time.
fn reply_cutoff(row: &EnrollmentRow, history: &[HistoryRow]) -> Option<DateTime<Utc>> {
    row.replies_after
        .or_else(|| history.iter().map(|step| step.scheduled_at).min())
}

fn incoming(message: &InboundMessage, resolved: Vec<Uuid>) -> Incoming {
    let response = replies::classify(&message.headers, message.from.as_deref());
    Incoming {
        received_at: message.received_at,
        from: message.from.clone(),
        replying_to_id: message.replying_to_id,
        references: replies::references(&message.headers),
        referenced_message_ids: resolved,
        failed_recipients: replies::failed_recipients(&message.headers),
        bounce_text: (response == Response::Bounce)
            .then(|| message.body_text.as_deref().map(str::to_lowercase))
            .flatten(),
        response,
    }
}

fn stop_reason(response: Response) -> EnrollmentReason {
    match response {
        Response::Bounce => EnrollmentReason::Bounced,
        Response::Reply | Response::AutoReply => EnrollmentReason::Replied,
    }
}

impl<R, S, A> Sequences<R, S, A>
where
    R: SequenceRepo,
    S: SequenceStepStore<Conn = R::Conn>,
    A: OwnerAccess,
{
    /// One pass: resolve in-flight steps, create due ones, withdraw orphans.
    #[tracing::instrument(
        name = "sequences.sweep",
        skip_all,
        fields(resolved, created, withdrawn, failed)
    )]
    pub async fn sweep(&self, now: DateTime<Utc>) -> SweepReport {
        let mut report = SweepReport::default();
        self.resolve_all(now, &mut report).await;
        self.create_due(now, &mut report).await;
        self.withdraw_orphans(&mut report).await;
        let span = tracing::Span::current();
        span.record("resolved", report.resolved);
        span.record("created", report.created);
        span.record("withdrawn", report.withdrawn);
        span.record("failed", report.failed);
        report
    }

    async fn resolve_all(&self, now: DateTime<Utc>, report: &mut SweepReport) {
        let mut after = None;
        loop {
            let page = match self.repo.scheduled_page(after, PAGE).await {
                Ok(page) => page,
                Err(error) => {
                    tracing::error!(error = ?error, "failed to list in-flight sequence steps");
                    report.failed += 1;
                    return;
                }
            };
            for &(_, enrollment_id) in &page {
                match self.resolve(enrollment_id, now).await {
                    Ok(()) => report.resolved += 1,
                    Err(error) => {
                        tracing::warn!(%enrollment_id, error = ?error, "failed to resolve a sequence step");
                        report.failed += 1;
                    }
                }
            }
            if page.len() < PAGE as usize {
                return;
            }
            after = page.last().copied();
        }
    }

    /// Act on what happened to an enrollment's in-flight step.
    pub(super) async fn resolve(
        &self,
        enrollment_id: Uuid,
        now: DateTime<Utc>,
    ) -> Result<(), SequenceError> {
        let mut tx = self.repo.begin().await.map_err(internal)?;
        let Some(mut row) = self
            .repo
            .lock_enrollment(&mut tx, enrollment_id, true)
            .await
            .map_err(internal)?
        else {
            return Ok(());
        };
        let history = self
            .repo
            .history(&mut tx, enrollment_id)
            .await
            .map_err(internal)?;
        let Some(step) = in_flight(&history).cloned() else {
            return Ok(());
        };
        let state = self
            .steps
            .step_state(R::conn(&mut tx), step.message_id)
            .await
            .map_err(internal)?;
        match state {
            StepState::Sent {
                sent_at,
                submitted_at,
                delivery_message_id,
                global_id,
            } => {
                let sent = SentStep {
                    sent_at,
                    delivery_message_id,
                    provider_message_id: global_id
                        .map(|id| id.trim_matches(|c| c == '<' || c == '>').to_owned()),
                };
                self.record_sent(&mut tx, &mut row, &step, &sent, submitted_at, now)
                    .await?;
            }
            StepState::Scheduled {
                status: ScheduledSendStatus::Failed,
                ..
            } => self.failed(&mut tx, &mut row, &step, now).await?,
            StepState::Scheduled { status, send_time } => {
                if status == ScheduledSendStatus::Pending {
                    match row.status {
                        // Every path off `active` withdraws its step; heal one that didn't.
                        EnrollmentStatus::Paused
                        | EnrollmentStatus::Stopped
                        | EnrollmentStatus::Completed => {
                            self.withdraw(&mut tx, &row, &step, CancelExpectation::Scheduled)
                                .await?;
                        }
                        EnrollmentStatus::Active | EnrollmentStatus::NeedsAttention => {
                            if !self
                                .recheck_pending(&mut tx, &mut row, &history, &step)
                                .await?
                            {
                                return self.repo.commit(tx).await.map_err(internal);
                            }
                        }
                    }
                }
                if row.status == EnrollmentStatus::Active && now > send_time + STUCK_AFTER {
                    self.needs_attention(&mut tx, &mut row, EnrollmentReason::StepStuck)
                        .await?;
                }
            }
            // The owner is handling it in Mail; record it once it is sent.
            StepState::TakenOver => {
                if row.status == EnrollmentStatus::Active {
                    self.needs_attention(&mut tx, &mut row, EnrollmentReason::StepWithdrawn)
                        .await?;
                }
            }
            StepState::Discarded => {
                // It was never sent, so a draft already gone is withdrawn too.
                match self
                    .withdraw(&mut tx, &row, &step, CancelExpectation::Draft)
                    .await?
                {
                    CancelOutcome::Cancelled => {}
                    CancelOutcome::Gone => self
                        .repo
                        .delete_step(&mut tx, row.id, step.step)
                        .await
                        .map_err(internal)?,
                    // It moved on; the next sweep records what happened.
                    CancelOutcome::Sent
                    | CancelOutcome::DeliveryStarted
                    | CancelOutcome::Changed => {
                        return self.repo.commit(tx).await.map_err(internal);
                    }
                }
                self.needs_attention(&mut tx, &mut row, EnrollmentReason::StepWithdrawn)
                    .await?;
            }
            StepState::Gone => {
                self.mark_unknown(&mut tx, &mut row, &step).await?;
                let inbox = match row.link_id {
                    Some(link_id) => self
                        .steps
                        .sending_inbox(R::conn(&mut tx), link_id)
                        .await
                        .map_err(internal)?,
                    None => None,
                };
                let reason = if usable_inbox(inbox, &row.owner_id).is_some() {
                    EnrollmentReason::StepUnknown
                } else {
                    EnrollmentReason::InboxUnavailable
                };
                self.needs_attention(&mut tx, &mut row, reason).await?;
            }
        }
        self.repo.commit(tx).await.map_err(internal)
    }

    /// A step Gmail refused: retry it a few times, then ask the owner.
    async fn failed(
        &self,
        tx: &mut R::Tx,
        row: &mut EnrollmentRow,
        step: &HistoryRow,
        now: DateTime<Utc>,
    ) -> Result<(), SequenceError> {
        match row.status {
            EnrollmentStatus::Active => {
                let inbox = match row.link_id {
                    Some(link_id) => self
                        .steps
                        .sending_inbox(R::conn(tx), link_id)
                        .await
                        .map_err(internal)?,
                    None => None,
                };
                let healthy = usable_inbox(inbox, &row.owner_id).is_some();
                let retry = usize::try_from(row.attempts)
                    .ok()
                    .and_then(|attempt| RETRY_DELAYS.get(attempt));
                match (healthy, retry) {
                    (true, Some(delay)) => {
                        if self
                            .withdraw(tx, row, step, CancelExpectation::Scheduled)
                            .await?
                            == CancelOutcome::Cancelled
                        {
                            row.attempts += 1;
                            row.due_at = Some(now + *delay);
                            self.repo
                                .update_enrollment(tx, row)
                                .await
                                .map_err(internal)?;
                        }
                    }
                    (true, None) => {
                        self.needs_attention(tx, row, EnrollmentReason::StepFailed)
                            .await?;
                    }
                    (false, _) => {
                        self.needs_attention(tx, row, EnrollmentReason::InboxUnavailable)
                            .await?;
                    }
                }
            }
            EnrollmentStatus::NeedsAttention => {
                if !matches!(
                    row.reason,
                    Some(EnrollmentReason::StepFailed | EnrollmentReason::InboxUnavailable)
                ) {
                    self.needs_attention(tx, row, EnrollmentReason::StepFailed)
                        .await?;
                }
            }
            EnrollmentStatus::Paused | EnrollmentStatus::Stopped | EnrollmentStatus::Completed => {
                self.withdraw(tx, row, step, CancelExpectation::Scheduled)
                    .await?;
            }
        }
        Ok(())
    }

    /// Before an unclaimed step sends, check again what may have changed since
    /// it was created. Returns `false` when the enrollment stopped or paused.
    async fn recheck_pending(
        &self,
        tx: &mut R::Tx,
        row: &mut EnrollmentRow,
        history: &[HistoryRow],
        step: &HistoryRow,
    ) -> Result<bool, SequenceError> {
        if let Some(reason) = self.stop_check(tx, row, history).await? {
            self.stop(tx, row, reason).await?;
            return Ok(false);
        }
        let inbox = match row.link_id {
            Some(link_id) => self
                .steps
                .sending_inbox(R::conn(tx), link_id)
                .await
                .map_err(internal)?,
            None => None,
        };
        if usable_inbox(inbox, &row.owner_id).is_none()
            && self
                .withdraw(tx, row, step, CancelExpectation::Scheduled)
                .await?
                == CancelOutcome::Cancelled
        {
            self.needs_attention(tx, row, EnrollmentReason::InboxUnavailable)
                .await?;
            return Ok(false);
        }
        Ok(true)
    }

    /// Why the enrollment must stop before sending: an unsubscribe, or an
    /// answer to its emails found by reading the inbox.
    async fn stop_check(
        &self,
        tx: &mut R::Tx,
        row: &EnrollmentRow,
        history: &[HistoryRow],
    ) -> Result<Option<EnrollmentReason>, SequenceError> {
        if self
            .repo
            .recipient(tx, row.team_id, &row.email)
            .await
            .map_err(internal)?
            .is_some_and(|recipient| recipient.unsubscribed)
        {
            return Ok(Some(EnrollmentReason::Unsubscribed));
        }
        let (Some(link_id), Some(since)) = (row.link_id, reply_cutoff(row, history)) else {
            return Ok(None);
        };
        let step_message_ids: Vec<Uuid> = history.iter().map(|step| step.message_id).collect();
        let messages = self
            .steps
            .replies_since(
                R::conn(tx),
                ReplySearch {
                    link_id,
                    email: &row.email,
                    step_message_ids: &step_message_ids,
                    since,
                },
            )
            .await
            .map_err(internal)?;
        let steps = identities(history);
        let enrolled = Enrolled {
            email: &row.email,
            replies_after: Some(since),
            steps: &steps,
        };
        Ok(messages.iter().find_map(|message| {
            replies::stop_reason(&enrolled, &incoming(message, Vec::new())).map(stop_reason)
        }))
    }

    async fn create_due(&self, now: DateTime<Utc>, report: &mut SweepReport) {
        match self
            .repo
            .heal_stranded(now + super::timing::LEAD_TIME)
            .await
        {
            Ok(0) => {}
            Ok(healed) => tracing::warn!(healed, "gave stranded enrollments a due time"),
            Err(error) => {
                tracing::error!(error = ?error, "failed to heal stranded enrollments");
                report.failed += 1;
            }
        }
        // An inbox whose next send slot is too far out is skipped for the rest
        // of the pass, so a backlog on one inbox costs one check, not one per
        // enrollment, and doesn't hold up the others.
        let mut full_inboxes = std::collections::HashSet::new();
        let mut after = None;
        loop {
            let page = match self.repo.due_page(after, DUE_PAGE).await {
                Ok(page) => page,
                Err(error) => {
                    tracing::error!(error = ?error, "failed to list due enrollments");
                    report.failed += 1;
                    return;
                }
            };
            for due in &page {
                if due
                    .link_id
                    .is_some_and(|link_id| full_inboxes.contains(&link_id))
                {
                    continue;
                }
                match self.create_step(due).await {
                    Ok(Creation::Created) => report.created += 1,
                    Ok(Creation::Skipped) => {}
                    Ok(Creation::InboxFull(link_id)) => {
                        full_inboxes.insert(link_id);
                    }
                    Err(error) => {
                        tracing::warn!(enrollment_id = %due.id, error = ?error, "failed to create a sequence step");
                        report.failed += 1;
                        if let Err(error) =
                            self.repo.defer(due.id, Utc::now() + CREATE_BACKOFF).await
                        {
                            tracing::error!(enrollment_id = %due.id, error = ?error, "failed to defer an enrollment");
                        }
                    }
                }
            }
            if page.len() < DUE_PAGE as usize {
                return;
            }
            after = page.last().map(|due| (due.due_at, due.id));
        }
    }

    /// Create an enrollment's next step if every check passes.
    pub(super) async fn create_step(&self, due: &DueEnrollment) -> Result<Creation, SequenceError> {
        // A long pass must not schedule against a stale clock.
        let now = Utc::now();
        // Contacts are shared across messages: upsert them before taking locks.
        let contacts = match due.link_id {
            Some(link_id) => {
                let mut tx = self.repo.begin().await.map_err(internal)?;
                let inbox = self
                    .steps
                    .sending_inbox(R::conn(&mut tx), link_id)
                    .await
                    .map_err(internal)?;
                let contacts = match inbox {
                    Some(inbox) => Some(
                        self.steps
                            .upsert_contacts(
                                R::conn(&mut tx),
                                link_id,
                                &ContactInfo {
                                    email: inbox.email_address,
                                    name: None,
                                    photo_url: None,
                                },
                                &ContactInfo {
                                    email: due.email.clone(),
                                    name: due.contact_name.clone(),
                                    photo_url: None,
                                },
                            )
                            .await
                            .map_err(internal)?,
                    ),
                    None => None,
                };
                self.repo.commit(tx).await.map_err(internal)?;
                contacts
            }
            None => None,
        };

        let mut tx = self.repo.begin().await.map_err(internal)?;
        let Some(mut row) = self
            .repo
            .lock_enrollment(&mut tx, due.id, true)
            .await
            .map_err(internal)?
        else {
            return Ok(Creation::Skipped);
        };
        let history = self.repo.history(&mut tx, row.id).await.map_err(internal)?;
        if row.status != EnrollmentStatus::Active
            || row.sequence_status != super::models::SequenceStatus::Active
            || row.due_at.is_none_or(|due_at| due_at > now)
            || in_flight(&history).is_some()
        {
            return Ok(Creation::Skipped);
        }

        let access = self.access.team_of(&row.owner_id).await.map_err(internal)?
            == Some(row.team_id)
            && self
                .access
                .crm_enabled(row.team_id)
                .await
                .map_err(internal)?;
        if !access {
            self.stop(&mut tx, &mut row, EnrollmentReason::AccessLost)
                .await?;
            return self
                .repo
                .commit(tx)
                .await
                .map(|()| Creation::Skipped)
                .map_err(internal);
        }
        let inbox = match row.link_id {
            Some(link_id) => self
                .steps
                .sending_inbox(R::conn(&mut tx), link_id)
                .await
                .map_err(internal)?,
            None => None,
        };
        let (Some(inbox), Some(contacts)) = (usable_inbox(inbox, &row.owner_id), contacts) else {
            self.needs_attention(&mut tx, &mut row, EnrollmentReason::InboxUnavailable)
                .await?;
            return self
                .repo
                .commit(tx)
                .await
                .map(|()| Creation::Skipped)
                .map_err(internal);
        };
        if let Some(reason) = self.stop_check(&mut tx, &row, &history).await? {
            self.stop(&mut tx, &mut row, reason).await?;
            return self
                .repo
                .commit(tx)
                .await
                .map(|()| Creation::Skipped)
                .map_err(internal);
        }

        let index = usize::try_from(row.next_step).unwrap_or_default();
        let Some(step) = row.steps.get(index).cloned() else {
            row.status = EnrollmentStatus::Completed;
            row.due_at = None;
            self.repo
                .update_enrollment(&mut tx, &row)
                .await
                .map_err(internal)?;
            return self
                .repo
                .commit(tx)
                .await
                .map(|()| Creation::Skipped)
                .map_err(internal);
        };
        let parent = if step.as_reply {
            self.reply_parent(&mut tx, &row, &history, index, inbox.link_id)
                .await?
        } else {
            None
        };
        let subject = match (step.as_reply, parent) {
            (true, None) => render::standalone_subject(&step.subject).to_owned(),
            _ => step.subject.clone(),
        };

        let latest = self
            .steps
            .lock_send_slot(R::conn(&mut tx), inbox.link_id)
            .await
            .map_err(internal)?;
        let slot = latest.map_or(now + MIN_LEAD, |latest| {
            (latest + SPACING).max(now + MIN_LEAD)
        });
        if slot > now + MAX_LEAD {
            // Stays due; the next pass tries again once the slot is near.
            return Ok(Creation::InboxFull(inbox.link_id));
        }

        let recipient = self
            .repo
            .recipient(&mut tx, row.team_id, &row.email)
            .await
            .map_err(internal)?
            .ok_or_else(|| internal(std::io::Error::other("recipient row missing")))?;
        let url = self.unsubscribe_url(recipient.token.as_str());
        let message_id = self
            .steps
            .create_step(
                R::conn(&mut tx),
                &NewStep {
                    link_id: inbox.link_id,
                    actor: &row.owner_id,
                    contacts: &contacts,
                    to: &recipient_contact(&row),
                    subject: &subject,
                    body_text: &step.body,
                    reply_to: parent,
                    send_time: slot,
                    list_unsubscribe_url: &url,
                },
            )
            .await
            .map_err(internal)?;
        let index = i16::try_from(index).map_err(internal)?;
        self.repo
            .insert_step(&mut tx, row.id, index, message_id, slot)
            .await
            .map_err(internal)?;
        row.due_at = None;
        self.repo
            .update_enrollment(&mut tx, &row)
            .await
            .map_err(internal)?;
        self.repo.commit(tx).await.map_err(internal)?;
        Ok(Creation::Created)
    }

    /// The sent step a reply step answers: the latest one sent in its thread
    /// that is still a sent message in this inbox.
    async fn reply_parent(
        &self,
        tx: &mut R::Tx,
        row: &EnrollmentRow,
        history: &[HistoryRow],
        index: usize,
        link_id: Uuid,
    ) -> Result<Option<Uuid>, SequenceError> {
        for earlier in (0..index).rev() {
            if let Some(step) = history
                .iter()
                .find(|step| usize::try_from(step.step).ok() == Some(earlier))
                && step.status == StepStatus::Sent
                && self
                    .steps
                    .is_sent_in(R::conn(tx), link_id, step.message_id)
                    .await
                    .map_err(internal)?
            {
                return Ok(Some(step.message_id));
            }
            if !row.steps.get(earlier).is_some_and(|step| step.as_reply) {
                return Ok(None);
            }
        }
        Ok(None)
    }

    async fn withdraw_orphans(&self, report: &mut SweepReport) {
        let mut after = None;
        loop {
            let pending = async {
                let mut tx = self.repo.begin().await.map_err(internal)?;
                self.steps
                    .pending_steps(R::conn(&mut tx), after, PAGE)
                    .await
                    .map_err(internal)
            }
            .await;
            let pending = match pending {
                Ok(pending) => pending,
                Err(error) => {
                    tracing::error!(error = ?error, "failed to list pending sequence schedules");
                    report.failed += 1;
                    return;
                }
            };
            let ids: Vec<Uuid> = pending.iter().map(|step| step.message_id).collect();
            let known = match self.repo.known_steps(&ids).await {
                Ok(known) => known,
                Err(error) => {
                    tracing::error!(error = ?error, "failed to match pending sequence schedules");
                    report.failed += 1;
                    return;
                }
            };
            for orphan in pending
                .iter()
                .filter(|step| !known.contains(&step.message_id))
            {
                let withdrawn = async {
                    let mut tx = self.repo.begin().await.map_err(internal)?;
                    let outcome = self
                        .steps
                        .cancel_step(
                            R::conn(&mut tx),
                            orphan.message_id,
                            CancelExpectation::Scheduled,
                        )
                        .await
                        .map_err(internal)?;
                    self.repo.commit(tx).await.map_err(internal)?;
                    Ok::<_, SequenceError>(outcome)
                }
                .await;
                match withdrawn {
                    Ok(CancelOutcome::Cancelled) => report.withdrawn += 1,
                    Ok(_) => {}
                    Err(error) => {
                        tracing::warn!(message_id = %orphan.message_id, error = ?error, "failed to withdraw an orphaned sequence step");
                        report.failed += 1;
                    }
                }
            }
            if pending.len() < PAGE as usize {
                return;
            }
            after = ids.last().copied();
        }
    }

    /// Stop enrollments a newly synced message answers. Safe to repeat.
    #[tracing::instrument(name = "sequences.message_synced", skip(self), fields(stopped), err)]
    pub async fn message_synced(
        &self,
        link_id: Uuid,
        message_id: Uuid,
    ) -> Result<(), SequenceError> {
        if !self
            .repo
            .has_live_enrollments(link_id)
            .await
            .map_err(internal)?
        {
            return Ok(());
        }
        let (message, resolved) = {
            let mut tx = self.repo.begin().await.map_err(internal)?;
            let Some(message) = self
                .steps
                .inbound_message(R::conn(&mut tx), link_id, message_id)
                .await
                .map_err(internal)?
            else {
                return Ok(());
            };
            let references = replies::references(&message.headers);
            let mut resolved = self
                .steps
                .resolve_references(R::conn(&mut tx), link_id, &references)
                .await
                .map_err(internal)?;
            resolved.extend(message.replying_to_id);
            (message, resolved)
        };
        let incoming = incoming(&message, resolved);
        if incoming.response == Response::AutoReply {
            return Ok(());
        }
        let candidates = self
            .repo
            .reply_candidates(ReplyCandidates {
                link_id,
                from: incoming.from.as_deref(),
                failed_recipients: &incoming.failed_recipients,
                references: &incoming.references,
                message_ids: &incoming.referenced_message_ids,
                bounce_text: incoming.bounce_text.as_deref(),
            })
            .await
            .map_err(internal)?;
        let mut stopped = 0_u32;
        let mut failed = None;
        // One enrollment failing must not leave the others sending.
        for enrollment_id in candidates {
            match self.stop_if_answered(enrollment_id, &incoming).await {
                Ok(true) => stopped += 1,
                Ok(false) => {}
                Err(error) => {
                    tracing::warn!(%enrollment_id, error = ?error, "failed to stop an answered enrollment");
                    failed = Some(error);
                }
            }
        }
        tracing::Span::current().record("stopped", stopped);
        failed.map_or(Ok(()), Err)
    }

    /// Stop the enrollment if the message answers its emails.
    async fn stop_if_answered(
        &self,
        enrollment_id: Uuid,
        incoming: &Incoming,
    ) -> Result<bool, SequenceError> {
        let mut tx = self.repo.begin().await.map_err(internal)?;
        let Some(mut row) = self
            .repo
            .lock_enrollment(&mut tx, enrollment_id, false)
            .await
            .map_err(internal)?
        else {
            return Ok(false);
        };
        if !row.status.is_live() {
            return Ok(false);
        }
        let history = self.repo.history(&mut tx, row.id).await.map_err(internal)?;
        let steps = identities(&history);
        let enrolled = Enrolled {
            email: &row.email,
            replies_after: reply_cutoff(&row, &history),
            steps: &steps,
        };
        let Some(response) = replies::stop_reason(&enrolled, incoming) else {
            return Ok(false);
        };
        self.stop(&mut tx, &mut row, stop_reason(response)).await?;
        self.repo.commit(tx).await.map_err(internal)?;
        Ok(true)
    }
}
