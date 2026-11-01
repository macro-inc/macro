//! The use cases the API drives, and the enrollment changes every path shares.

use chrono::{DateTime, Duration, Utc};
use email::domain::{
    models::{ContactInfo, UserProvider},
    sequence_steps::{CancelExpectation, CancelOutcome, SendingInbox, SequenceStepStore},
};
use macro_user_id::email::EmailStr;
use uuid::Uuid;

use super::{
    models::{
        ContactEnrollment, EnrollResult, EnrollSkip, EnrollmentAction, EnrollmentDetail,
        EnrollmentReason, EnrollmentRow, EnrollmentStatus, EnrollmentSummary, HistoryRow, Owner,
        Recipient, Sequence, SequenceError, SequenceStatus, SequenceSummary, Step, StepStatus,
        normalize_email,
    },
    ports::{NewEnrollment, NewSequence, OwnerAccess, SentStep, SequenceRepo},
    render::{self, InvalidSequence, Problem},
    timing,
};

/// A step this far past its send time and still unsent needs attention.
pub(super) const STUCK_AFTER: Duration = Duration::minutes(30);

/// Most contacts one enroll request may add.
pub const MAX_ENROLL: usize = 50;
/// How far ahead an enrollment may start.
const MAX_START_AHEAD: Duration = Duration::days(366);

/// Changes to a sequence; `None` leaves a field as it is.
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema), schema(as = UpdateSequenceRequest))]
#[serde(rename_all = "camelCase")]
pub struct SequencePatch {
    /// The version the caller last read.
    pub version: i32,
    /// New status.
    pub status: Option<SequenceStatus>,
    /// New name.
    pub name: Option<String>,
    /// New sending inbox.
    pub link_id: Option<Uuid>,
    /// New footer.
    pub footer: Option<String>,
    /// New steps.
    pub steps: Option<Vec<Step>>,
}

/// Contacts to enroll.
#[derive(Debug, Clone, serde::Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct EnrollRequest {
    /// CRM people.
    pub crm_contact_ids: Vec<Uuid>,
    /// When the first step should go; also fixes the local send time.
    pub start: DateTime<Utc>,
    /// IANA time zone the send time is in.
    pub timezone: String,
}

/// Sequences: the owner's API and the sweep, over persistence, the email
/// step port and team access.
pub struct Sequences<R, S, A> {
    pub(super) repo: R,
    pub(super) steps: S,
    pub(super) access: A,
    unsubscribe_base: String,
}

pub(super) fn internal(error: impl std::error::Error + Send + Sync + 'static) -> SequenceError {
    SequenceError::internal(error)
}

fn invalid(problem: Problem) -> SequenceError {
    SequenceError::Invalid(InvalidSequence::new(problem, None))
}

/// Steps as stored: text without control characters, and no wait before the
/// first, which goes at each enrollment's start.
fn clean_steps(steps: Vec<Step>) -> Vec<Step> {
    steps
        .into_iter()
        .enumerate()
        .map(|(index, step)| Step {
            subject: render::clean_text(&step.subject),
            body: render::clean_text(&step.body),
            delay_days: if index == 0 { 0 } else { step.delay_days },
            ..step
        })
        .collect()
}

/// Whether steps can go out from `inbox` for `owner_id`: it is their own Gmail.
fn sends_for(inbox: &SendingInbox, owner_id: &str) -> bool {
    inbox.provider == UserProvider::Gmail && inbox.macro_id == owner_id
}

/// The step still waiting to send, if any.
pub(super) fn in_flight(history: &[HistoryRow]) -> Option<&HistoryRow> {
    history
        .iter()
        .find(|step| step.status == StepStatus::Scheduled)
}

impl<R, S, A> Sequences<R, S, A>
where
    R: SequenceRepo,
    S: SequenceStepStore<Conn = R::Conn>,
    A: OwnerAccess,
{
    /// Compose the service. `email_service_url` is the public base of the
    /// email service that serves unsubscribe links.
    pub fn new(repo: R, steps: S, access: A, email_service_url: &str) -> Self {
        Self {
            repo,
            steps,
            access,
            unsubscribe_base: format!(
                "{}/public/sequences/unsubscribe",
                email_service_url.trim_end_matches('/')
            ),
        }
    }

    /// The caller as a sequence owner: in a team that has CRM on.
    async fn owner(&self, user_id: &str) -> Result<Owner, SequenceError> {
        let team_id = self
            .access
            .team_of(user_id)
            .await
            .map_err(internal)?
            .ok_or(SequenceError::NoTeam)?;
        if !self.access.crm_enabled(team_id).await.map_err(internal)? {
            return Err(SequenceError::CrmDisabled);
        }
        Ok(Owner {
            user_id: user_id.to_owned(),
            team_id,
        })
    }

    /// Withdraw every in-flight step; active enrollments keep their place and
    /// resume when the sequence does.
    async fn pause_sequence(&self, tx: &mut R::Tx, sequence_id: Uuid) -> Result<(), SequenceError> {
        for mut row in self
            .repo
            .lock_live_enrollments(tx, sequence_id)
            .await
            .map_err(internal)?
        {
            if let Some(due_at) = self.withdraw_unsent(tx, &row).await?
                && row.status == EnrollmentStatus::Active
            {
                row.due_at = Some(due_at);
                self.repo
                    .update_enrollment(tx, &row)
                    .await
                    .map_err(internal)?;
            }
        }
        Ok(())
    }

    /// The sender must be the owner's own connected Gmail inbox.
    async fn check_sender(
        &self,
        tx: &mut R::Tx,
        owner: &Owner,
        link_id: Option<Uuid>,
        require_healthy: bool,
    ) -> Result<(), SequenceError> {
        let link_id = link_id.ok_or_else(|| invalid(Problem::SenderRequired))?;
        let inbox = self
            .steps
            .sending_inbox(R::conn(tx), link_id)
            .await
            .map_err(internal)?;
        let usable = inbox.is_some_and(|inbox| {
            sends_for(&inbox, &owner.user_id) && (inbox.healthy || !require_healthy)
        });
        if usable {
            Ok(())
        } else {
            Err(invalid(Problem::SenderUnavailable))
        }
    }

    /// The inbox a step may go out from now: the owner's own healthy Gmail.
    pub(super) async fn usable_inbox(
        &self,
        tx: &mut R::Tx,
        link_id: Option<Uuid>,
        owner_id: &str,
    ) -> Result<Option<SendingInbox>, SequenceError> {
        let Some(link_id) = link_id else {
            return Ok(None);
        };
        Ok(self
            .steps
            .sending_inbox(R::conn(tx), link_id)
            .await
            .map_err(internal)?
            .filter(|inbox| inbox.healthy && sends_for(inbox, owner_id)))
    }

    pub(super) fn unsubscribe_url(&self, token: &str) -> String {
        format!("{}/{token}", self.unsubscribe_base)
    }

    async fn pause(&self, tx: &mut R::Tx, row: &mut EnrollmentRow) -> Result<(), SequenceError> {
        if !matches!(
            row.status,
            EnrollmentStatus::Active | EnrollmentStatus::NeedsAttention
        ) {
            return Err(SequenceError::ActionUnavailable);
        }
        // Keep when the next step was due, so resuming early keeps a planned
        // start; a withdrawn step was due when it was scheduled.
        if let Some(due_at) = self.withdraw_unsent(tx, row).await? {
            row.due_at = Some(due_at);
        }
        row.status = EnrollmentStatus::Paused;
        row.reason = None;
        self.repo.update_enrollment(tx, row).await.map_err(internal)
    }

    /// Continue an enrollment. A step still in flight is withdrawn and created
    /// again; one that may have gone out is marked unknown and skipped.
    async fn resume(&self, tx: &mut R::Tx, row: &mut EnrollmentRow) -> Result<(), SequenceError> {
        let now = Utc::now();
        let resumable = match row.status {
            EnrollmentStatus::Paused | EnrollmentStatus::NeedsAttention => true,
            // A stop the server may have misread, or access that may be back
            // (it is checked again before the next step).
            EnrollmentStatus::Stopped => matches!(
                row.reason,
                Some(
                    EnrollmentReason::Replied
                        | EnrollmentReason::Bounced
                        | EnrollmentReason::AccessLost
                )
            ),
            EnrollmentStatus::Active | EnrollmentStatus::Completed => false,
        };
        if !resumable {
            return Err(SequenceError::ActionUnavailable);
        }
        let mut history = self.repo.history(tx, row.id).await.map_err(internal)?;
        if let Some(step) = in_flight(&history).cloned() {
            // Takes back a draft the owner restored; never their own send.
            match self
                .withdraw(tx, row, &step, CancelExpectation::Draft)
                .await?
            {
                CancelOutcome::Cancelled => {}
                // Gmail may have it: never resent, the sequence moves past it.
                CancelOutcome::DeliveryStarted
                    if row.reason == Some(EnrollmentReason::StepStuck)
                        || now > step.scheduled_at + STUCK_AFTER =>
                {
                    self.mark_unknown(tx, row, &step).await?;
                }
                CancelOutcome::Gone => self.mark_unknown(tx, row, &step).await?,
                // The owner scheduled or sent it from Mail: it is theirs until
                // they send or delete it.
                CancelOutcome::Changed => return Err(SequenceError::StepTakenOver),
                CancelOutcome::DeliveryStarted | CancelOutcome::Sent => {
                    return Err(SequenceError::StepInDelivery);
                }
            }
            history = self.repo.history(tx, row.id).await.map_err(internal)?;
        }
        // The reply or bounce that stopped it no longer counts.
        if row.status == EnrollmentStatus::Stopped
            && matches!(
                row.reason,
                Some(EnrollmentReason::Replied | EnrollmentReason::Bounced)
            )
        {
            row.replies_after = Some(now);
        }
        if row.link_id.is_none() {
            row.link_id = row.sequence_link_id;
        }
        // Its inbox was disconnected and the sequence has no other.
        if row.link_id.is_none() {
            return Err(invalid(Problem::SenderUnavailable));
        }
        row.attempts = 0;
        row.reason = None;
        let next = usize::try_from(row.next_step).unwrap_or_default();
        if next >= row.steps.len() {
            row.status = EnrollmentStatus::Completed;
            row.due_at = None;
        } else {
            row.status = EnrollmentStatus::Active;
            row.due_at = Some(next_due(row, &history, next, now));
        }
        self.repo.update_enrollment(tx, row).await.map_err(internal)
    }

    /// Stop every live enrollment of an unsubscribed address, one transaction
    /// each so one failure can't hold back the rest. A failure is healed by
    /// the sweep, which won't send to an unsubscribed address.
    pub(super) async fn stop_address(
        &self,
        team_id: Uuid,
        email: &str,
    ) -> Result<(), SequenceError> {
        let ids = self
            .repo
            .live_enrollments_of_address(team_id, email)
            .await
            .map_err(internal)?;
        let mut failed = None;
        for id in ids {
            let result = async {
                let mut tx = self.repo.begin().await.map_err(internal)?;
                if let Some(mut row) = self
                    .repo
                    .lock_enrollment(&mut tx, id, false)
                    .await
                    .map_err(internal)?
                    && row.status.is_live()
                {
                    self.stop(&mut tx, &mut row, EnrollmentReason::Unsubscribed)
                        .await?;
                }
                self.repo.commit(tx).await.map_err(internal)
            }
            .await;
            if let Err(error) = result {
                tracing::warn!(enrollment_id = %id, error = ?error, "failed to stop an unsubscribed enrollment");
                failed = Some(error);
            }
        }
        failed.map_or(Ok(()), Err)
    }

    // Changes shared by owner actions, the reply hook and the sweep. Each runs
    // in a transaction that holds the enrollment's lock.

    /// Withdraw a step's email; forget the step when it is gone for good.
    pub(super) async fn withdraw(
        &self,
        tx: &mut R::Tx,
        row: &EnrollmentRow,
        step: &HistoryRow,
        expect: CancelExpectation,
    ) -> Result<CancelOutcome, SequenceError> {
        let outcome = self
            .steps
            .cancel_step(R::conn(tx), step.message_id, expect)
            .await
            .map_err(internal)?;
        if outcome == CancelOutcome::Cancelled {
            self.repo
                .delete_step(tx, row.id, step.step)
                .await
                .map_err(internal)?;
        }
        Ok(outcome)
    }

    /// Withdraw the enrollment's unsent step, unless the owner took it over or
    /// it is already sending. Returns when the withdrawn step was due.
    async fn withdraw_unsent(
        &self,
        tx: &mut R::Tx,
        row: &EnrollmentRow,
    ) -> Result<Option<DateTime<Utc>>, SequenceError> {
        let history = self.repo.history(tx, row.id).await.map_err(internal)?;
        let Some(step) = in_flight(&history) else {
            return Ok(None);
        };
        let outcome = self
            .withdraw(tx, row, step, CancelExpectation::Scheduled)
            .await?;
        Ok((outcome == CancelOutcome::Cancelled).then_some(step.scheduled_at))
    }

    /// End an enrollment, withdrawing its in-flight step.
    pub(super) async fn stop(
        &self,
        tx: &mut R::Tx,
        row: &mut EnrollmentRow,
        reason: EnrollmentReason,
    ) -> Result<(), SequenceError> {
        self.withdraw_unsent(tx, row).await?;
        row.status = EnrollmentStatus::Stopped;
        row.reason = Some(reason);
        row.due_at = None;
        self.repo.update_enrollment(tx, row).await.map_err(internal)
    }

    /// Record that a step was sent and move the enrollment on. Only an active
    /// or attention enrollment schedules its next step; a paused one waits.
    pub(super) async fn record_sent(
        &self,
        tx: &mut R::Tx,
        row: &mut EnrollmentRow,
        step: &HistoryRow,
        sent: &SentStep,
        submitted_at: Option<DateTime<Utc>>,
        now: DateTime<Utc>,
    ) -> Result<(), SequenceError> {
        self.repo
            .mark_sent(tx, row.id, step.step, sent)
            .await
            .map_err(internal)?;
        row.next_step = row.next_step.max(step.step + 1);
        row.replies_after = row
            .replies_after
            .or(Some(submitted_at.unwrap_or(sent.sent_at)));
        row.attempts = 0;
        let next = usize::try_from(row.next_step).unwrap_or_default();
        let finished = next >= row.steps.len();
        match row.status {
            EnrollmentStatus::Active | EnrollmentStatus::NeedsAttention => {
                row.reason = None;
                if finished {
                    row.status = EnrollmentStatus::Completed;
                    row.due_at = None;
                } else {
                    row.status = EnrollmentStatus::Active;
                    row.due_at = Some(timing::next_due(
                        step.scheduled_at,
                        row.steps.get(next).map_or(0, |step| step.delay_days),
                        row.clock,
                        now,
                    ));
                }
            }
            EnrollmentStatus::Paused if finished => {
                row.status = EnrollmentStatus::Completed;
            }
            EnrollmentStatus::Paused | EnrollmentStatus::Stopped | EnrollmentStatus::Completed => {}
        }
        self.repo.update_enrollment(tx, row).await.map_err(internal)
    }

    /// Record that a step's email disappeared: it is never sent again.
    pub(super) async fn mark_unknown(
        &self,
        tx: &mut R::Tx,
        row: &mut EnrollmentRow,
        step: &HistoryRow,
    ) -> Result<(), SequenceError> {
        self.repo
            .mark_unknown(tx, row.id, step.step)
            .await
            .map_err(internal)?;
        row.next_step = row.next_step.max(step.step + 1);
        self.repo.update_enrollment(tx, row).await.map_err(internal)
    }

    /// Flag an active or attention enrollment for its owner.
    pub(super) async fn needs_attention(
        &self,
        tx: &mut R::Tx,
        row: &mut EnrollmentRow,
        reason: EnrollmentReason,
    ) -> Result<(), SequenceError> {
        if matches!(
            row.status,
            EnrollmentStatus::Active | EnrollmentStatus::NeedsAttention
        ) && row.reason != Some(reason)
        {
            row.status = EnrollmentStatus::NeedsAttention;
            row.reason = Some(reason);
            row.due_at = None;
            self.repo
                .update_enrollment(tx, row)
                .await
                .map_err(internal)?;
        }
        Ok(())
    }
}

/// When step `next` is due: by the timing rule from the last recorded step,
/// or, when nothing was recorded, when it was planned (its start) and no
/// sooner than allowed.
pub(super) fn next_due(
    row: &EnrollmentRow,
    history: &[HistoryRow],
    next: usize,
    now: DateTime<Utc>,
) -> DateTime<Utc> {
    match history
        .iter()
        .filter(|step| step.status != StepStatus::Scheduled)
        .max_by_key(|step| step.step)
    {
        Some(last) => timing::next_due(
            last.scheduled_at,
            row.steps.get(next).map_or(0, |step| step.delay_days),
            row.clock,
            now,
        ),
        None => timing::first_due(row.due_at.unwrap_or(now), now),
    }
}

/// The recipient a step addresses.
pub(super) fn recipient_contact(row: &EnrollmentRow) -> ContactInfo {
    ContactInfo {
        email: row.email.clone(),
        name: row.contact_name.clone(),
        photo_url: None,
    }
}

impl<R, S, A> super::ports::SequencesApi for Sequences<R, S, A>
where
    R: SequenceRepo,
    S: SequenceStepStore<Conn = R::Conn>,
    A: OwnerAccess,
{
    /// The owner's sequences.
    async fn list(&self, user_id: &str) -> Result<Vec<SequenceSummary>, SequenceError> {
        let owner = self.owner(user_id).await?;
        self.repo.list_sequences(&owner).await.map_err(internal)
    }
    /// Create a draft sequence.
    async fn create(&self, user_id: &str, input: NewSequence) -> Result<Sequence, SequenceError> {
        let owner = self.owner(user_id).await?;
        let input = NewSequence {
            name: render::clean_text(&input.name),
            link_id: input.link_id,
            footer: render::clean_text(&input.footer),
            steps: clean_steps(input.steps),
        };
        render::check_limits(&input.name, &input.footer, &input.steps)?;
        if input.link_id.is_some() {
            let mut tx = self.repo.begin().await.map_err(internal)?;
            self.check_sender(&mut tx, &owner, input.link_id, false)
                .await?;
        }
        self.repo
            .insert_sequence(&owner, &input)
            .await
            .map_err(internal)
    }
    /// A sequence with its enrollments.
    async fn get(
        &self,
        user_id: &str,
        id: Uuid,
    ) -> Result<(Sequence, Vec<EnrollmentSummary>), SequenceError> {
        let owner = self.owner(user_id).await?;
        let sequence = self
            .repo
            .sequence(&owner, id)
            .await
            .map_err(internal)?
            .ok_or(SequenceError::NotFound)?;
        let enrollments = self.repo.enrollments(id).await.map_err(internal)?;
        Ok((sequence, enrollments))
    }
    /// Edit a draft or paused sequence, or change its status.
    #[tracing::instrument(skip_all, fields(sequence_id = %id), err)]
    async fn update(
        &self,
        user_id: &str,
        id: Uuid,
        patch: SequencePatch,
    ) -> Result<Sequence, SequenceError> {
        let owner = self.owner(user_id).await?;
        let mut tx = self.repo.begin().await.map_err(internal)?;
        let mut sequence = self
            .repo
            .lock_sequence(&mut tx, &owner, id, false)
            .await
            .map_err(internal)?
            .ok_or(SequenceError::NotFound)?;
        if sequence.version != patch.version {
            return Err(SequenceError::VersionConflict);
        }
        let edits = patch.name.is_some()
            || patch.link_id.is_some()
            || patch.footer.is_some()
            || patch.steps.is_some();
        if edits && sequence.status == SequenceStatus::Active {
            return Err(SequenceError::InvalidTransition);
        }
        if let Some(name) = patch.name {
            sequence.name = render::clean_text(&name);
        }
        if let Some(footer) = patch.footer {
            sequence.footer = render::clean_text(&footer);
        }
        if let Some(steps) = patch.steps {
            sequence.steps = clean_steps(steps);
        }
        render::check_limits(&sequence.name, &sequence.footer, &sequence.steps)?;
        if let Some(link_id) = patch.link_id {
            self.check_sender(&mut tx, &owner, Some(link_id), false)
                .await?;
            sequence.link_id = Some(link_id);
        }
        match (sequence.status, patch.status) {
            (_, None) => {}
            (current, Some(target)) if current == target => {}
            (SequenceStatus::Draft | SequenceStatus::Paused, Some(SequenceStatus::Active)) => {
                render::check_complete(&sequence.name, &sequence.footer, &sequence.steps)?;
                self.check_sender(&mut tx, &owner, sequence.link_id, true)
                    .await?;
                sequence.status = SequenceStatus::Active;
            }
            (SequenceStatus::Active, Some(SequenceStatus::Paused)) => {
                self.pause_sequence(&mut tx, sequence.id).await?;
                sequence.status = SequenceStatus::Paused;
            }
            _ => return Err(SequenceError::InvalidTransition),
        }
        let saved = self
            .repo
            .save_sequence(&mut tx, &sequence)
            .await
            .map_err(internal)?;
        self.repo.commit(tx).await.map_err(internal)?;
        Ok(saved)
    }
    /// Delete a sequence, withdrawing its in-flight steps.
    #[tracing::instrument(skip_all, fields(sequence_id = %id), err)]
    async fn delete(&self, user_id: &str, id: Uuid) -> Result<(), SequenceError> {
        let owner = self.owner(user_id).await?;
        let mut tx = self.repo.begin().await.map_err(internal)?;
        self.repo
            .lock_sequence(&mut tx, &owner, id, false)
            .await
            .map_err(internal)?
            .ok_or(SequenceError::NotFound)?;
        for row in self
            .repo
            .lock_live_enrollments(&mut tx, id)
            .await
            .map_err(internal)?
        {
            self.withdraw_unsent(&mut tx, &row).await?;
        }
        self.repo
            .delete_sequence(&mut tx, id)
            .await
            .map_err(internal)?;
        self.repo.commit(tx).await.map_err(internal)
    }
    /// Enroll CRM people into an active sequence.
    #[tracing::instrument(skip_all, fields(sequence_id = %id, contacts = request.crm_contact_ids.len()), err)]
    async fn enroll(
        &self,
        user_id: &str,
        id: Uuid,
        request: EnrollRequest,
    ) -> Result<Vec<EnrollResult>, SequenceError> {
        let owner = self.owner(user_id).await?;
        if request.crm_contact_ids.len() > MAX_ENROLL {
            return Err(SequenceError::TooManyContacts);
        }
        let timezone: chrono_tz::Tz = request
            .timezone
            .parse()
            .map_err(|_| SequenceError::InvalidTimezone)?;
        let now = Utc::now();
        if request.start > now + MAX_START_AHEAD {
            return Err(SequenceError::InvalidStart);
        }
        let people = self
            .access
            .people(user_id, &request.crm_contact_ids)
            .await
            .map_err(internal)?;

        let mut tx = self.repo.begin().await.map_err(internal)?;
        let sequence = self
            .repo
            .lock_sequence(&mut tx, &owner, id, true)
            .await
            .map_err(internal)?
            .ok_or(SequenceError::NotFound)?;
        if sequence.status != SequenceStatus::Active {
            return Err(SequenceError::SequenceNotActive);
        }
        // Its inbox was disconnected: nothing could send.
        if sequence.link_id.is_none() {
            return Err(invalid(Problem::SenderUnavailable));
        }

        let mut results = Vec::with_capacity(request.crm_contact_ids.len());
        let mut accepted: Vec<(Uuid, String, Option<String>)> = Vec::new();
        for crm_contact_id in request.crm_contact_ids {
            let skip = |skipped| EnrollResult {
                crm_contact_id,
                enrollment_id: None,
                skipped: Some(skipped),
            };
            if results
                .iter()
                .any(|result: &EnrollResult| result.crm_contact_id == crm_contact_id)
                || accepted.iter().any(|(id, _, _)| *id == crm_contact_id)
            {
                continue;
            }
            let Some(person) = people
                .iter()
                .find(|person| person.id == crm_contact_id && person.team_id == owner.team_id)
            else {
                results.push(skip(EnrollSkip::NotFound));
                continue;
            };
            let email = normalize_email(&person.email);
            if email.is_empty() {
                results.push(skip(EnrollSkip::NoEmail));
            } else if EmailStr::parse_from_str(&email).is_err() {
                results.push(skip(EnrollSkip::InvalidEmail));
            } else if accepted.iter().any(|(_, other, _)| *other == email) {
                results.push(skip(EnrollSkip::AlreadyEnrolled));
            } else {
                accepted.push((
                    crm_contact_id,
                    email,
                    person.name.as_deref().and_then(render::sanitize_name),
                ));
            }
        }

        let mut emails: Vec<String> = accepted.iter().map(|(_, email, _)| email.clone()).collect();
        emails.sort();
        let recipients = self
            .repo
            .upsert_recipients(&mut tx, owner.team_id, &emails)
            .await
            .map_err(internal)?;
        let clock = timing::send_clock(request.start, timezone);
        let due_at = timing::first_due(request.start, now);
        let timezone_name = timezone.name();
        for (crm_contact_id, email, name) in accepted {
            let Some((_, recipient)) = recipients.iter().find(|(address, _)| *address == email)
            else {
                return Err(internal(std::io::Error::other("recipient row missing")));
            };
            if recipient.unsubscribed {
                results.push(EnrollResult {
                    crm_contact_id,
                    enrollment_id: None,
                    skipped: Some(EnrollSkip::Unsubscribed),
                });
                continue;
            }
            let steps = render::render_steps(
                &sequence.steps,
                &sequence.footer,
                &Recipient {
                    email: email.clone(),
                    name: name.clone(),
                },
                &self.unsubscribe_url(recipient.token.as_str()),
            );
            let enrollment_id = self
                .repo
                .insert_enrollment(
                    &mut tx,
                    &NewEnrollment {
                        sequence_id: sequence.id,
                        team_id: owner.team_id,
                        link_id: sequence.link_id,
                        crm_contact_id,
                        email: &email,
                        contact_name: name.as_deref(),
                        steps: &steps,
                        due_at,
                        timezone: timezone_name,
                        send_time: clock.send_time,
                    },
                )
                .await
                .map_err(internal)?;
            results.push(EnrollResult {
                crm_contact_id,
                skipped: enrollment_id
                    .is_none()
                    .then_some(EnrollSkip::AlreadyEnrolled),
                enrollment_id,
            });
        }
        self.repo.commit(tx).await.map_err(internal)?;
        Ok(results)
    }
    /// One of the owner's enrollments with its rendered steps.
    async fn enrollment(&self, user_id: &str, id: Uuid) -> Result<EnrollmentDetail, SequenceError> {
        let owner = self.owner(user_id).await?;
        self.repo
            .enrollment_detail(&owner, id)
            .await
            .map_err(internal)?
            .ok_or(SequenceError::NotFound)
    }
    /// Pause, resume, stop or unsubscribe one of the owner's enrollments.
    #[tracing::instrument(skip_all, fields(enrollment_id = %id, action = <&'static str>::from(action)), err)]
    async fn act(
        &self,
        user_id: &str,
        id: Uuid,
        action: EnrollmentAction,
    ) -> Result<EnrollmentSummary, SequenceError> {
        let owner = self.owner(user_id).await?;
        let enrollment = self
            .repo
            .owned_enrollment(&owner, id)
            .await
            .map_err(internal)?
            .ok_or(SequenceError::NotFound)?;
        match action {
            // From any status: a contact can ask to be removed after replying.
            EnrollmentAction::Unsubscribe => {
                self.repo
                    .unsubscribe_address(owner.team_id, &enrollment.email)
                    .await
                    .map_err(internal)?;
                // The opt-out is committed; stopping is best effort and self-healing.
                let _ = self.stop_address(owner.team_id, &enrollment.email).await;
            }
            EnrollmentAction::Pause | EnrollmentAction::Resume | EnrollmentAction::Stop => {
                let mut tx = self.repo.begin().await.map_err(internal)?;
                let mut row = self
                    .repo
                    .lock_enrollment(&mut tx, id, false)
                    .await
                    .map_err(internal)?
                    .ok_or(SequenceError::NotFound)?;
                match action {
                    EnrollmentAction::Pause => self.pause(&mut tx, &mut row).await?,
                    EnrollmentAction::Resume => self.resume(&mut tx, &mut row).await?,
                    _ => {
                        if !row.status.is_live() {
                            return Err(SequenceError::ActionUnavailable);
                        }
                        self.stop(&mut tx, &mut row, EnrollmentReason::Manual)
                            .await?;
                    }
                }
                self.repo.commit(tx).await.map_err(internal)?;
            }
        }
        self.repo
            .owned_enrollment(&owner, id)
            .await
            .map_err(internal)?
            .ok_or(SequenceError::NotFound)
    }
    /// A CRM person's enrollments, as any teammate sees them.
    async fn contact_enrollments(
        &self,
        user_id: &str,
        crm_contact_id: Uuid,
    ) -> Result<Vec<ContactEnrollment>, SequenceError> {
        let owner = self.owner(user_id).await?;
        let person = self
            .access
            .people(user_id, &[crm_contact_id])
            .await
            .map_err(internal)?
            .into_iter()
            .find(|person| person.id == crm_contact_id && person.team_id == owner.team_id)
            .ok_or(SequenceError::NotFound)?;
        self.repo
            .contact_enrollments(owner.team_id, &normalize_email(&person.email), user_id)
            .await
            .map_err(internal)
    }
    /// Record a one-click unsubscribe. `false` for a token that isn't ours.
    #[tracing::instrument(skip_all, err)]
    async fn unsubscribe(&self, token: &str) -> Result<bool, SequenceError> {
        let Some(token) = super::models::UnsubscribeToken::parse(token) else {
            return Ok(false);
        };
        let Some((team_id, email)) = self
            .repo
            .unsubscribe_token(&token)
            .await
            .map_err(internal)?
        else {
            return Ok(false);
        };
        // The opt-out is committed; stopping is best effort and self-healing.
        let _ = self.stop_address(team_id, &email).await;
        Ok(true)
    }
}
