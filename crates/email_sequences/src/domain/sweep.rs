//! The sweep that creates and watches steps, and the hook that stops
//! enrollments when a reply or bounce arrives.

use chrono::{DateTime, Duration, Utc};
use email::domain::{
    models::{ContactInfo, ScheduledSendStatus},
    sequence_steps::{
        CancelExpectation, InboundMessage, NewStep, ReplySearch, SequenceStepStore, StepState,
    },
};
use uuid::Uuid;

use super::{
    models::{
        EnrollmentReason, EnrollmentRow, EnrollmentStatus, HistoryRow, Recipient, SequenceError,
        SequenceStatus, StepStatus,
    },
    ports::{DueEnrollment, OwnerAccess, ReplyCandidates, SentStep, SequenceRepo},
    render,
    replies::{self, Enrolled, Incoming, Response, SentIdentity},
    service::{STUCK_AFTER, Sequences, in_flight, internal, next_step, recipient_contact},
    timing,
};

/// Rows per sweep page.
const PAGE: i64 = 100;
/// The soonest a new step may send: its send time is in the future when
/// committed, and a reply or unsubscribe in that minute can still withdraw it.
const MIN_LEAD: Duration = Duration::seconds(60);
/// Sends from one inbox are at least this far apart, so it never bursts.
const SPACING: Duration = Duration::seconds(30);
/// A step is created only when its slot is this close; later ones wait.
const MAX_LEAD: Duration = Duration::seconds(90);
/// Most steps one inbox sends in any 24 hours, well under Gmail's daily
/// sending limits; more wait until the earliest of them is a day old.
pub(crate) const DAILY_LIMIT: u32 = 100;

/// What trying to create a step did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Creation {
    Created,
    Skipped,
    /// Nothing can go from the inbox in this pass: its next slot isn't near,
    /// it sent its [`DAILY_LIMIT`], it can't send, or its owner lost access.
    /// Its enrollments stay due.
    InboxWaits(Uuid),
}

/// What one sweep did.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct SweepReport {
    /// In-flight steps examined.
    pub resolved: u32,
    /// Steps created.
    pub created: u32,
    /// Items that failed and will be retried.
    pub failed: u32,
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

impl<R, S, A> Sequences<R, S, A>
where
    R: SequenceRepo,
    S: SequenceStepStore<Conn = R::Conn>,
    A: OwnerAccess,
{
    /// One pass: resolve in-flight steps, then create due ones.
    #[tracing::instrument(name = "sequences.sweep", skip_all, fields(resolved, created, failed))]
    pub async fn sweep(&self, now: DateTime<Utc>) -> SweepReport {
        let mut report = SweepReport::default();
        self.resolve_all(now, &mut report).await;
        self.create_due(&mut report).await;
        let span = tracing::Span::current();
        span.record("resolved", report.resolved);
        span.record("created", report.created);
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
        let live = matches!(
            row.status,
            EnrollmentStatus::Active | EnrollmentStatus::NeedsAttention
        );
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
            // Gmail refused it. It shows in Mail like any failed send; a paused
            // or stopped enrollment's (it was delivering when they changed) goes.
            StepState::Scheduled {
                status: ScheduledSendStatus::Failed,
                ..
            } => {
                if live {
                    self.needs_attention(&mut tx, &mut row).await?;
                } else {
                    self.withdraw(&mut tx, &row, &step, CancelExpectation::Scheduled)
                        .await?;
                }
            }
            StepState::Scheduled { status, send_time } => {
                // An unsubscribe's stops or the reply hook may have failed
                // after committing; the step hasn't gone yet.
                if live
                    && status == ScheduledSendStatus::Pending
                    && let Some(reason) = self.stop_check(&mut tx, &row, &history).await?
                {
                    self.stop(&mut tx, &mut row, reason).await?;
                } else if now > send_time + STUCK_AFTER {
                    self.needs_attention(&mut tx, &mut row).await?;
                }
            }
            // The owner cancelled or trashed it in Mail. Once the enrollment has
            // ended, the step is forgotten and the draft left to them.
            StepState::Unscheduled => match row.status {
                EnrollmentStatus::Stopped | EnrollmentStatus::Completed => self
                    .repo
                    .delete_step(&mut tx, row.id, step.step_id)
                    .await
                    .map_err(internal)?,
                _ => self.needs_attention(&mut tx, &mut row).await?,
            },
            // Its inbox or message was deleted; it may have gone out, so it is
            // never sent again.
            StepState::Gone => {
                self.repo
                    .mark_unknown(&mut tx, row.id, step.step_id)
                    .await
                    .map_err(internal)?;
                self.needs_attention(&mut tx, &mut row).await?;
            }
        }
        self.repo.commit(tx).await.map_err(internal)
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
        Ok(messages
            .iter()
            .find_map(|message| replies::stop_reason(&enrolled, &incoming(message, Vec::new()))))
    }

    async fn create_due(&self, report: &mut SweepReport) {
        // An inbox that can't take a step now is skipped for the rest of the
        // pass, so a backlog or outage costs one check, not one per enrollment,
        // and doesn't hold up the others.
        let mut waiting = std::collections::HashSet::new();
        let mut after = None;
        loop {
            let skip: Vec<Uuid> = waiting.iter().copied().collect();
            let page = match self.repo.due_page(after, PAGE, &skip).await {
                Ok(page) => page,
                Err(error) => {
                    tracing::error!(error = ?error, "failed to list due enrollments");
                    report.failed += 1;
                    return;
                }
            };
            for due in &page {
                if waiting.contains(&due.link_id) {
                    continue;
                }
                match self.create_step(due).await {
                    Ok(Creation::Created) => report.created += 1,
                    Ok(Creation::Skipped) => {}
                    Ok(Creation::InboxWaits(link_id)) => {
                        waiting.insert(link_id);
                    }
                    Err(error) => {
                        tracing::warn!(enrollment_id = %due.id, error = ?error, "failed to create a sequence step");
                        report.failed += 1;
                    }
                }
            }
            if page.len() < PAGE as usize {
                return;
            }
            after = page.last().map(|due| (due.due_at, due.id));
        }
    }

    /// Create an enrollment's next step, rendered from the sequence as it is
    /// now and the CRM person's current name, if every check passes.
    pub(super) async fn create_step(&self, due: &DueEnrollment) -> Result<Creation, SequenceError> {
        // A long pass must not schedule against a stale clock.
        let now = Utc::now();
        let has_access = self.access.team_of(&due.owner_id).await.map_err(internal)?
            == Some(due.team_id)
            && self
                .access
                .crm_enabled(due.team_id)
                .await
                .map_err(internal)?;
        if !has_access {
            return Ok(Creation::InboxWaits(due.link_id));
        }
        let mut tx = self.repo.begin().await.map_err(internal)?;
        let Some(inbox) = self
            .usable_inbox(&mut tx, due.link_id, &due.owner_id)
            .await?
        else {
            return Ok(Creation::InboxWaits(due.link_id));
        };
        let person = match due.crm_contact_id {
            Some(id) => self
                .access
                .people(&due.owner_id, &[id])
                .await
                .map_err(internal)?
                .into_iter()
                .find(|person| person.id == id && person.team_id == due.team_id),
            None => None,
        };
        let name = person
            .as_ref()
            .and_then(|person| person.name.as_deref())
            .and_then(render::sanitize_name);

        // Contacts are shared across messages: upsert them before taking locks.
        let contacts = self
            .steps
            .upsert_contacts(
                R::conn(&mut tx),
                inbox.link_id,
                &ContactInfo {
                    email: inbox.email_address.clone(),
                    name: None,
                    photo_url: None,
                },
                &ContactInfo {
                    email: due.email.clone(),
                    name: name.clone(),
                    photo_url: None,
                },
            )
            .await
            .map_err(internal)?;
        self.repo.commit(tx).await.map_err(internal)?;

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
        let sequence = self
            .repo
            .current_sequence(&mut tx, row.sequence_id)
            .await
            .map_err(internal)?
            .ok_or(SequenceError::NotFound)?;
        if row.status != EnrollmentStatus::Active
            || sequence.status != SequenceStatus::Active
            || row.link_id.or(sequence.link_id) != Some(inbox.link_id)
            || row.due_at.is_none_or(|due_at| due_at > now)
            || in_flight(&history).is_some()
        {
            return Ok(Creation::Skipped);
        }
        if person.is_none() {
            return self
                .stop_and_commit(tx, &mut row, EnrollmentReason::ContactRemoved)
                .await;
        }
        if let Some(reason) = self.stop_check(&mut tx, &row, &history).await? {
            return self.stop_and_commit(tx, &mut row, reason).await;
        }
        let Some((index, step)) = next_step(&sequence.steps, &history) else {
            row.status = EnrollmentStatus::Completed;
            row.due_at = None;
            self.repo
                .update_enrollment(&mut tx, &row)
                .await
                .map_err(internal)?;
            self.repo.commit(tx).await.map_err(internal)?;
            return Ok(Creation::Skipped);
        };

        self.repo
            .lock_send_slot(&mut tx, inbox.link_id)
            .await
            .map_err(internal)?;
        let latest = self
            .steps
            .latest_send_until(R::conn(&mut tx), inbox.link_id, now + MAX_LEAD)
            .await
            .map_err(internal)?;
        let slot = latest.map_or(now + MIN_LEAD, |latest| {
            (latest + SPACING).max(now + MIN_LEAD)
        });
        if slot > now + MAX_LEAD {
            return Ok(Creation::InboxWaits(inbox.link_id));
        }
        // A step held back by the daily limit waits out the weekend.
        let weekday = timing::on_weekday(slot, row.clock);
        if weekday != slot {
            row.due_at = Some(weekday);
            self.repo
                .update_enrollment(&mut tx, &row)
                .await
                .map_err(internal)?;
            self.repo.commit(tx).await.map_err(internal)?;
            return Ok(Creation::Skipped);
        }
        if self
            .repo
            .steps_since(&mut tx, inbox.link_id, now - Duration::days(1))
            .await
            .map_err(internal)?
            >= DAILY_LIMIT
        {
            return Ok(Creation::InboxWaits(inbox.link_id));
        }

        let recipient = self
            .repo
            .recipient(&mut tx, row.team_id, &row.email)
            .await
            .map_err(internal)?
            .ok_or_else(|| internal(std::io::Error::other("recipient row missing")))?;
        let rendered = render::render(
            &sequence.steps,
            index,
            &sequence.footer,
            &Recipient {
                email: row.email.clone(),
                name: name.clone(),
            },
            &self.unsubscribe_url(recipient.token.as_str()),
        );
        let parent = if step.as_reply {
            self.reply_parent(&mut tx, &sequence.steps, &history, index, inbox.link_id)
                .await?
        } else {
            None
        };
        let subject = match &parent {
            Some((_, subject)) => render::reply_subject(subject),
            None => rendered.subject,
        };
        row.link_id = Some(inbox.link_id);
        row.contact_name = name;
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
                    body_text: &rendered.body,
                    reply_to: parent.map(|(message_id, _)| message_id),
                    send_time: slot,
                    list_unsubscribe_url: &self.unsubscribe_url(recipient.token.as_str()),
                },
            )
            .await
            .map_err(internal)?;
        self.repo
            .insert_step(&mut tx, row.id, step.id, message_id, slot)
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

    async fn stop_and_commit(
        &self,
        mut tx: R::Tx,
        row: &mut EnrollmentRow,
        reason: EnrollmentReason,
    ) -> Result<Creation, SequenceError> {
        self.stop(&mut tx, row, reason).await?;
        self.repo.commit(tx).await.map_err(internal)?;
        Ok(Creation::Skipped)
    }

    /// The sent email a reply step answers, with the subject it went out
    /// with: the latest one sent in its thread that is still a sent message
    /// in this inbox.
    async fn reply_parent(
        &self,
        tx: &mut R::Tx,
        steps: &[super::models::Step],
        history: &[HistoryRow],
        index: usize,
        link_id: Uuid,
    ) -> Result<Option<(Uuid, String)>, SequenceError> {
        for earlier in steps.iter().take(index).rev() {
            if let Some(sent) = history
                .iter()
                .find(|row| row.step_id == earlier.id && row.status == StepStatus::Sent)
                && let Some(subject) = self
                    .steps
                    .sent_subject(R::conn(tx), link_id, sent.message_id)
                    .await
                    .map_err(internal)?
            {
                return Ok(Some((sent.message_id, subject)));
            }
            if !earlier.as_reply {
                return Ok(None);
            }
        }
        Ok(None)
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
            // An automatic reply answers nothing.
            if replies::classify(&message.headers, message.from.as_deref()) == Response::AutoReply {
                return Ok(());
            }
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
        let Some(reason) = replies::stop_reason(&enrolled, incoming) else {
            return Ok(false);
        };
        self.stop(&mut tx, &mut row, reason).await?;
        self.repo.commit(tx).await.map_err(internal)?;
        Ok(true)
    }
}
