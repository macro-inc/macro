//! Classifying threads and reading Focus back.

use std::{
    collections::{HashMap, HashSet},
    sync::{Mutex, MutexGuard, PoisonError},
};

use chrono::{DateTime, Duration, NaiveDate, Utc};
use chrono_tz::Tz;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use tracing::{Instrument as _, field::Empty};
use uuid::Uuid;

use super::{
    input::{due_date_input, jev_input},
    models::{
        FocusAnswers, FocusMessage, FocusRecord, FocusThread, FocusVerdict, StaleThread,
        StoredClassification, ThreadFocus,
    },
    ports::{
        DueDateExtractor, FocusClassifier, FocusClassifierError, FocusEnrollment, FocusNotifier,
        FocusStore, ProfileSource,
    },
    questions::FOCUS_QUESTIONS,
    rule::{FOCUS_RULE_VERSION, decide},
    signals::signals,
};

/// Most Focus threads one list returns; one hydration batch.
const MAX_FOCUS_THREADS: i64 = 500;
/// Longest window the Focus list looks back over, in days.
const MAX_WINDOW_DAYS: u16 = 90;
/// Days the owner waits on an answer before a thread joins Focus to follow up.
const FOLLOW_UP_AFTER_DAYS: i64 = 3;
/// Rejections in a row that end a sweep: the classifier is refusing every
/// request (a revoked key, say), not one thread.
const MAX_REJECTIONS_IN_A_ROW: usize = 5;
/// Longest a due date holds up storing a classification.
const DUE_DATE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// What happened to one thread.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClassifyOutcome {
    /// Classified and stored.
    Classified(FocusVerdict),
    /// The stored answers were decided again under the current rule, without
    /// calling the classifier.
    Redecided(FocusVerdict),
    /// Already classified at its latest message under the current rule.
    UpToDate,
    /// The thread is gone, or has no message from anyone but the owner.
    Missing,
    /// The thread is out of the inbox, or outside the signal inbox without
    /// being key mail right now.
    NotSignal,
    /// The inbox's owner is not in the Focus rollout, so nothing left the system.
    NotEnabled,
    /// The classifier was unavailable; a later sweep retries.
    Unavailable,
    /// The classifier refused the thread.
    Rejected,
}

/// Counts from one sweep.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SweepReport {
    /// Inboxes swept: those whose owner is in the rollout.
    pub inboxes: usize,
    /// Inboxes left out because their owner's place in the rollout could not
    /// be read; the next sweep tries them again.
    pub inboxes_unknown: usize,
    /// Threads the sweep found stale.
    pub candidates: usize,
    /// Threads classified.
    pub classified: usize,
    /// Threads decided again from stored answers, without the classifier.
    pub redecided: usize,
    /// Threads skipped as up to date, missing, not signal or not enabled, or
    /// already checked at their latest mail.
    pub skipped: usize,
    /// Threads that failed. A rejected thread waits for new mail; any other
    /// failure is retried by the next sweep.
    pub failed: usize,
    /// Whether the sweep stopped early because the classifier was unavailable
    /// or kept rejecting requests.
    pub stopped_early: bool,
}

/// Where one sweep stands as it moves from inbox to inbox.
#[derive(Default)]
struct SweepProgress {
    report: SweepReport,
    /// Stale threads seen, settled or not.
    seen: HashSet<Uuid>,
    /// Threads checked so far, against the sweep's limit.
    checks: i64,
    rejections_in_a_row: usize,
}

/// Classifies threads for inboxes whose owner is in the Focus rollout.
pub struct FocusService<S, P, C, N, D, E> {
    store: S,
    profiles: P,
    classifier: C,
    notifier: N,
    due_dates: D,
    enrollment: E,
    /// Inboxes last seen with their owner in the rollout, which the sweep
    /// covers along with every inbox holding Focus. In memory: after a restart
    /// an inbox with no Focus yet joins again with its next mail.
    enrolled: Mutex<HashMap<Uuid, MacroUserIdStr<'static>>>,
    /// Threads a sweep checked at their latest mail without storing a result
    /// (rejected, nothing to classify, or a result already stored), so later
    /// sweeps skip them until new mail arrives. In memory: a restart retries
    /// each once.
    settled: Mutex<HashMap<Uuid, DateTime<Utc>>>,
}

impl<S, P, C, N, D, E> FocusService<S, P, C, N, D, E>
where
    S: FocusStore,
    P: ProfileSource,
    C: FocusClassifier,
    N: FocusNotifier,
    D: DueDateExtractor,
    E: FocusEnrollment,
{
    /// Classify only inboxes whose owner `enrollment` puts in the rollout.
    pub fn new(
        store: S,
        profiles: P,
        classifier: C,
        notifier: N,
        due_dates: D,
        enrollment: E,
    ) -> Self {
        Self {
            store,
            profiles,
            classifier,
            notifier,
            due_dates,
            enrollment,
            enrolled: Mutex::default(),
            settled: Mutex::default(),
        }
    }

    fn settled(&self) -> MutexGuard<'_, HashMap<Uuid, DateTime<Utc>>> {
        self.settled.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn enrolled(&self) -> MutexGuard<'_, HashMap<Uuid, MacroUserIdStr<'static>>> {
        self.enrolled.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Whether the owner of inbox `link_id` is in the rollout now, remembering
    /// the answer so the sweep covers the inbox while they are.
    async fn is_enrolled(
        &self,
        link_id: Uuid,
        owner: &MacroUserIdStr<'static>,
    ) -> Result<bool, Report> {
        let enrolled = self.enrollment.is_enrolled(owner).await?;
        let mut inboxes = self.enrolled();
        if enrolled {
            inboxes.insert(link_id, owner.clone());
        } else {
            inboxes.remove(&link_id);
        }
        Ok(enrolled)
    }

    /// Classify a thread as it stands now. Safe to call repeatedly: a thread
    /// already classified at its latest message under the current rule is left
    /// alone, and one classified under an older rule is decided again from its
    /// stored answers without calling the classifier.
    #[tracing::instrument(
        skip(self),
        err,
        fields(
            is_focus = tracing::field::Empty,
            pinned = tracing::field::Empty,
            calendar_held = tracing::field::Empty,
            awaiting_reply = tracing::field::Empty,
            category = tracing::field::Empty,
            importance = tracing::field::Empty,
            importance_rate = tracing::field::Empty,
            redecided = tracing::field::Empty,
        )
    )]
    pub async fn classify_thread(&self, thread_id: Uuid) -> Result<ClassifyOutcome, Report> {
        let Some(inbox) = self.store.thread_inbox(thread_id).await? else {
            return Ok(ClassifyOutcome::Missing);
        };
        if !inbox.inbox_visible {
            return Ok(ClassifyOutcome::NotSignal);
        }
        // Checked after the single-row read, and before any message content.
        if !self.is_enrolled(inbox.link_id, &inbox.owner).await? {
            return Ok(ClassifyOutcome::NotEnabled);
        }
        let mail = self.store.thread_mail(&inbox).await?;
        let thread = FocusThread::new(inbox, mail);
        let Some(latest) = thread.messages.last() else {
            return Ok(ClassifyOutcome::Missing);
        };
        if thread.messages.iter().all(|message| message.is_sent) {
            return Ok(ClassifyOutcome::Missing);
        }
        let stored = thread
            .classified
            .as_ref()
            .filter(|stored| stored.message_id == latest.id);
        if stored.is_some_and(|stored| stored.rule_version == FOCUS_RULE_VERSION) {
            return Ok(ClassifyOutcome::UpToDate);
        }
        let signals = signals(&thread);
        // Same mail, older rule: nothing new for the classifier or the due date
        // extractor to read, so the stored date stands.
        if let Some(StoredClassification {
            answers: Some(answers),
            model,
            due_on,
            ..
        }) = stored
        {
            let verdict = decide(answers, &signals);
            let saved = self
                .save_verdict(&thread, latest, verdict, *answers, model.clone(), *due_on)
                .await?;
            if !saved {
                return Ok(ClassifyOutcome::UpToDate);
            }
            record_verdict(&verdict, true);
            return Ok(ClassifyOutcome::Redecided(verdict));
        }
        if !thread.is_signal && !signals.is_key_mail(Utc::now()) {
            return Ok(ClassifyOutcome::NotSignal);
        }

        // The profile only sharpens the answers; classify without it rather than not at all.
        let profile = self
            .profiles
            .profile(&thread.owner)
            .await
            .inspect_err(|error| tracing::warn!(error = ?error, "focus profile unavailable"))
            .ok()
            .flatten();
        let input = jev_input(&thread, profile.as_deref());
        let probabilities = match self
            .classifier
            .answer(&thread.owner, thread.thread_id, &input, &FOCUS_QUESTIONS)
            .await
        {
            Ok(probabilities) => probabilities,
            Err(FocusClassifierError::Unavailable) => return Ok(ClassifyOutcome::Unavailable),
            Err(FocusClassifierError::Rejected) => return Ok(ClassifyOutcome::Rejected),
        };
        let Some(answers) = FocusAnswers::from_probabilities(&probabilities) else {
            tracing::warn!(
                answers = probabilities.len(),
                "focus classifier returned the wrong number of answers"
            );
            return Ok(ClassifyOutcome::Rejected);
        };
        let verdict = decide(&answers, &signals);
        let model = self.classifier.model().to_owned();
        let due_on = self.due_on(&thread, &verdict).await;
        let saved = self
            .save_verdict(&thread, latest, verdict, answers, model, due_on)
            .await?;
        if !saved {
            // A concurrent classification of a later message won.
            return Ok(ClassifyOutcome::UpToDate);
        }
        record_verdict(&verdict, false);
        Ok(ClassifyOutcome::Classified(verdict))
    }

    /// The day newly classified mail says the thread is due, for a thread that can
    /// be in Focus for a reason other than a calendar hold. A failure costs the date,
    /// never the classification, and the wait for one is bounded.
    async fn due_on(&self, thread: &FocusThread, verdict: &FocusVerdict) -> Option<NaiveDate> {
        if !verdict.is_focus && !verdict.awaiting_reply {
            return None;
        }
        let span = tracing::info_span!(
            "email_focus.due_date",
            thread_id = %thread.thread_id,
            messages = Empty,
            outcome = Empty,
            otel.status_code = Empty,
        );
        let extraction = async {
            // Only sharpens which day a message counts from; carry on without it.
            let time_zone = self
                .profiles
                .time_zone(&thread.owner)
                .await
                .inspect_err(|error| tracing::warn!(error = ?error, "owner time zone unavailable"))
                .ok()
                .flatten()
                .and_then(|name| name.parse::<Tz>().ok());
            let input = due_date_input(thread, time_zone);
            tracing::Span::current().record("messages", input.messages.len());
            if input.messages.is_empty() {
                return Ok(None);
            }
            self.due_dates
                .due_on(&thread.owner, thread.thread_id, &input)
                .await
        };
        async {
            let current = tracing::Span::current();
            match tokio::time::timeout(DUE_DATE_TIMEOUT, extraction).await {
                Ok(Ok(due_on)) => {
                    current.record("outcome", if due_on.is_some() { "due" } else { "no_date" });
                    due_on
                }
                Ok(Err(error)) => {
                    current.record("outcome", "failed");
                    current.record("otel.status_code", "error");
                    tracing::warn!(error = ?error, "focus due date unavailable");
                    None
                }
                Err(_) => {
                    current.record("outcome", "timeout");
                    current.record("otel.status_code", "error");
                    tracing::warn!("focus due date timed out");
                    None
                }
            }
        }
        .instrument(span)
        .await
    }

    async fn save_verdict(
        &self,
        thread: &FocusThread,
        latest: &FocusMessage,
        verdict: FocusVerdict,
        answers: FocusAnswers,
        model: String,
        due_on: Option<NaiveDate>,
    ) -> Result<bool, Report> {
        let stored = self
            .store
            .save(&FocusRecord {
                thread_id: thread.thread_id,
                link_id: thread.link_id,
                classified_message_id: latest.id,
                classified_message_ts: latest.at,
                verdict,
                answers,
                model,
                classified_at: Utc::now(),
                due_on,
            })
            .await?;
        if stored {
            self.notifier.focus_changed(&thread.owner, thread.link_id);
        }
        Ok(stored)
    }

    /// Check up to `limit` stale threads from the last `window` in the inboxes
    /// whose owner is in the rollout, each inbox newest first, and classify
    /// those that need it. Stops at the first sign the classifier is
    /// unavailable, or after a run of rejections.
    ///
    /// The inboxes are every inbox holding Focus, so none is forgotten across a
    /// restart, and every inbox seen in the rollout since; an owner who left the
    /// rollout drops out here. A thread checked without storing a result stays
    /// stale in the store, so the sweep pages past those: taking only the newest
    /// `limit` would hand every sweep the same threads once enough of them pile
    /// up, and never reach older ones.
    #[tracing::instrument(skip(self), err)]
    pub async fn sweep(&self, window: Duration, limit: i64) -> Result<SweepReport, Report> {
        let since = Utc::now() - window;
        let mut inboxes: HashMap<Uuid, MacroUserIdStr<'static>> = self
            .store
            .inboxes_with_focus()
            .await?
            .into_iter()
            .map(|inbox| (inbox.link_id, inbox.owner))
            .collect();
        inboxes.extend(
            self.enrolled()
                .iter()
                .map(|(link_id, owner)| (*link_id, owner.clone())),
        );

        let mut progress = SweepProgress::default();
        let mut saw_them_all = true;
        for (link_id, owner) in inboxes {
            match self.is_enrolled(link_id, &owner).await {
                Ok(true) => {}
                Ok(false) => continue,
                Err(error) => {
                    tracing::warn!(error = ?error, %link_id, "focus sweep left out an inbox: its rollout is unknown");
                    progress.report.inboxes_unknown += 1;
                    saw_them_all = false;
                    continue;
                }
            }
            progress.report.inboxes += 1;
            if !self
                .sweep_inbox(link_id, since, limit, &mut progress)
                .await?
            {
                saw_them_all = false;
                break;
            }
        }

        // Only stale threads can be skipped, so the map stays as small as one
        // full sweep. A sweep that stopped short hasn't seen the rest.
        if saw_them_all {
            self.settled()
                .retain(|thread_id, _| progress.seen.contains(thread_id));
        }
        Ok(progress.report)
    }

    /// Page through one inbox's stale threads, classifying them until the
    /// sweep's `limit` of checks. Returns whether the sweep can go on to the
    /// next inbox: false once it hits the limit or must stop early.
    async fn sweep_inbox(
        &self,
        link_id: Uuid,
        since: DateTime<Utc>,
        limit: i64,
        progress: &mut SweepProgress,
    ) -> Result<bool, Report> {
        let mut after = None;
        loop {
            let page = self
                .store
                .stale_threads(link_id, since, after, limit)
                .await?;
            progress.report.candidates += page.len();
            let last_page = i64::try_from(page.len()).is_ok_and(|len| len < limit);
            after = page.last().copied();
            if after.is_none() {
                return Ok(true);
            }
            for StaleThread {
                thread_id,
                latest_at,
            } in page
            {
                progress.seen.insert(thread_id);
                if self.settled().get(&thread_id) == Some(&latest_at) {
                    progress.report.skipped += 1;
                    continue;
                }
                if progress.checks >= limit {
                    return Ok(false);
                }
                progress.checks += 1;
                let outcome = self.classify_thread(thread_id).await;
                if !matches!(outcome, Ok(ClassifyOutcome::Rejected)) {
                    progress.rejections_in_a_row = 0;
                }
                let report = &mut progress.report;
                match outcome {
                    Ok(ClassifyOutcome::Classified(_)) => {
                        report.classified += 1;
                        self.settled().remove(&thread_id);
                    }
                    Ok(ClassifyOutcome::Redecided(_)) => {
                        report.redecided += 1;
                        self.settled().remove(&thread_id);
                    }
                    Ok(ClassifyOutcome::Unavailable) => {
                        report.failed += 1;
                        report.stopped_early = true;
                        return Ok(false);
                    }
                    Ok(ClassifyOutcome::Rejected) => {
                        report.failed += 1;
                        self.settled().insert(thread_id, latest_at);
                        progress.rejections_in_a_row += 1;
                        if progress.rejections_in_a_row >= MAX_REJECTIONS_IN_A_ROW {
                            tracing::warn!(
                                rejections_in_a_row = progress.rejections_in_a_row,
                                "focus sweep stopped: the classifier rejects every thread"
                            );
                            report.stopped_early = true;
                            return Ok(false);
                        }
                    }
                    Ok(_) => {
                        report.skipped += 1;
                        self.settled().insert(thread_id, latest_at);
                    }
                    Err(error) => {
                        tracing::warn!(error = ?error, %thread_id, "focus sweep could not classify a thread");
                        report.failed += 1;
                    }
                }
            }
            if last_page {
                return Ok(true);
            }
        }
    }
}

/// Put why a thread landed where it did on the classification's span.
fn record_verdict(verdict: &FocusVerdict, redecided: bool) {
    let span = tracing::Span::current();
    span.record("is_focus", verdict.is_focus);
    span.record("pinned", verdict.pinned);
    span.record("calendar_held", verdict.calendar_hold_until.is_some());
    span.record("awaiting_reply", verdict.awaiting_reply);
    span.record("category", tracing::field::display(verdict.category));
    span.record("importance", verdict.importance);
    span.record("importance_rate", verdict.importance_rate);
    span.record("redecided", redecided);
}

/// The latest time a thread's waiting can have started and still count now.
fn waiting_before(now: DateTime<Utc>) -> DateTime<Utc> {
    now - Duration::days(FOLLOW_UP_AFTER_DAYS)
}

/// Reads the Focus view needs.
pub struct FocusQueries<S> {
    store: S,
}

impl<S: FocusStore> FocusQueries<S> {
    /// Read Focus from `store`.
    pub fn new(store: S) -> Self {
        Self { store }
    }

    /// The owner's Focus threads still in the inbox with mail in the last
    /// `window_days` (at most 90), newest first by latest message time in
    /// either direction, so the limit keeps the newest threads.
    pub async fn focus_thread_ids(
        &self,
        owner: &MacroUserIdStr<'static>,
        window_days: u16,
    ) -> Result<Vec<Uuid>, Report> {
        let days = window_days.clamp(1, MAX_WINDOW_DAYS);
        let now = Utc::now();
        self.store
            .focus_thread_ids(
                owner,
                now - Duration::days(i64::from(days)),
                waiting_before(now),
                now,
                MAX_FOCUS_THREADS,
            )
            .await
    }

    /// Classifications of the owner's threads among `thread_ids`, as they stand
    /// now.
    pub async fn focus_for_threads(
        &self,
        owner: &MacroUserIdStr<'static>,
        thread_ids: &[Uuid],
    ) -> Result<HashMap<Uuid, ThreadFocus>, Report> {
        if thread_ids.is_empty() {
            return Ok(HashMap::new());
        }
        let now = Utc::now();
        self.store
            .focus_for_threads(owner, thread_ids, waiting_before(now), now)
            .await
    }
}

#[cfg(test)]
mod test;
