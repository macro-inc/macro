//! Classifying threads and reading Focus back.

use std::{
    collections::{HashMap, HashSet},
    sync::{
        Mutex, MutexGuard, PoisonError,
        atomic::{AtomicBool, Ordering},
    },
};

use chrono::{DateTime, Duration, Utc};
use chrono_tz::Tz;
use futures::{StreamExt as _, stream};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use tracing::{Instrument as _, field::Empty};
use uuid::Uuid;

use super::{
    dates::focus_dates,
    input::{due_date_input, jev_input, last_written_on},
    models::{
        FocusAnswers, FocusDates, FocusInboxOwner, FocusMessage, FocusRecord, FocusThread,
        FocusVerdict, StaleThread, StoredClassification, ThreadDates, ThreadFocus,
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
/// Days the owner waits on an answer before a thread they wrote last on comes
/// back to Focus to follow up.
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
    /// Nobody whose Focus tab shows the inbox is in the rollout (which leaves
    /// out people away from Macro), so nothing left the system.
    NotEnabled,
    /// The classifier was unavailable; a later sweep retries.
    Unavailable,
    /// The classifier refused the thread.
    Rejected,
}

/// Counts from one sweep.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SweepReport {
    /// Inboxes swept: those in the rollout.
    pub inboxes: usize,
    /// Inboxes left out because their place in the rollout could not be
    /// read; the next sweep tries them again.
    pub inboxes_unknown: usize,
    /// Inboxes a thread found out of the rollout partway through, because who
    /// reads them changed since they were found in it; their other threads
    /// wait for a sweep or a backfill that finds them in again.
    pub inboxes_left: usize,
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

/// One look at every connected inbox's place in the rollout.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EnrolledInboxes {
    /// Inboxes in the rollout.
    pub enrolled: Vec<FocusInboxOwner>,
    /// Inboxes whose place could not be read; the next look tries again.
    pub unknown: usize,
}

/// Which newly classified mail gets its due date read, for a thread that can be
/// in Focus for a reason other than a calendar hold.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DueDates {
    /// Every thread's.
    Read,
    /// Only a thread's whose latest mail is from this time on; older ones store
    /// no date. For the old mail a backfill reaches past the top of the tab,
    /// where a date costs more than it shows; the thread's next mail reads one.
    ReadSince(DateTime<Utc>),
}

impl DueDates {
    /// Whether a thread last active at `latest_at` gets its due date read.
    fn reads(self, latest_at: DateTime<Utc>) -> bool {
        match self {
            Self::Read => true,
            Self::ReadSince(since) => latest_at >= since,
        }
    }
}

/// Stale threads one backfill read asks for at a time.
const BACKFILL_PAGE: i64 = 500;

/// How one inbox's stale threads are walked.
struct Walk {
    since: DateTime<Utc>,
    /// Stale threads read at a time.
    page: i64,
    /// Checks the whole sweep may make; no limit when `None`.
    budget: Option<i64>,
    /// Threads at the classifier at once.
    at_once: usize,
    due_dates: DueDates,
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

/// Classifies threads for inboxes in the Focus rollout: those with anyone
/// whose Focus tab shows them in it.
pub struct FocusService<S, P, C, N, D, E> {
    store: S,
    profiles: P,
    classifier: C,
    notifier: N,
    due_dates: D,
    enrollment: E,
    /// Inboxes last seen in the rollout, which the sweep covers along with
    /// every inbox holding Focus. In memory: after a restart an inbox with no
    /// Focus yet joins again with its next mail.
    enrolled: Mutex<HashMap<Uuid, FocusInboxOwner>>,
    /// Threads a sweep checked at their latest mail without storing a result
    /// (rejected, nothing to classify, or a result already stored), so later
    /// sweeps skip them until new mail arrives. Never a thread found out of
    /// the rollout: that depends on who reads its inbox, not on its mail. In
    /// memory: a restart retries each once.
    settled: Mutex<HashMap<Uuid, DateTime<Utc>>>,
    /// Inboxes being backfilled, which the sweep leaves to the backfill so no
    /// thread goes to the classifier twice at once.
    backfilling: Mutex<HashSet<Uuid>>,
}

/// Marks an inbox as backfilling until dropped, however the backfill ends.
struct Backfilling<'a> {
    inboxes: &'a Mutex<HashSet<Uuid>>,
    link_id: Uuid,
}

impl Drop for Backfilling<'_> {
    fn drop(&mut self) {
        self.inboxes
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&self.link_id);
    }
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
    /// Classify only inboxes whose owner or a user they are linked to
    /// `enrollment` puts in the rollout.
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
            backfilling: Mutex::default(),
        }
    }

    fn backfilling(&self) -> MutexGuard<'_, HashSet<Uuid>> {
        self.backfilling
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    fn settled(&self) -> MutexGuard<'_, HashMap<Uuid, DateTime<Utc>>> {
        self.settled.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn enrolled(&self) -> MutexGuard<'_, HashMap<Uuid, FocusInboxOwner>> {
        self.enrolled.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Whether inbox `link_id` is in the rollout now, remembering the answer
    /// so the sweep covers the inbox while it is.
    ///
    /// An inbox is in when anyone whose Focus tab shows it is: its owner or a
    /// user it is linked to, so a linked inbox follows the flag of the person
    /// reading it. Their places are read owner first, and the first one in
    /// settles it. A place that can't be read leaves the answer unknown only
    /// when nobody else's says yes.
    async fn is_enrolled(
        &self,
        link_id: Uuid,
        owner: &MacroUserIdStr<'static>,
        delegates: &[MacroUserIdStr<'static>],
    ) -> Result<bool, Report> {
        let mut enrolled = false;
        let mut unknown = None;
        for reader in std::iter::once(owner).chain(delegates) {
            match self.enrollment.is_enrolled(reader).await {
                Ok(true) => {
                    enrolled = true;
                    break;
                }
                Ok(false) => {}
                Err(error) => {
                    unknown.get_or_insert(error);
                }
            }
        }
        if !enrolled && let Some(error) = unknown {
            return Err(error);
        }

        let mut inboxes = self.enrolled();
        if enrolled {
            inboxes.insert(
                link_id,
                FocusInboxOwner {
                    link_id,
                    owner: owner.clone(),
                    delegates: delegates.to_vec(),
                },
            );
        } else {
            inboxes.remove(&link_id);
        }
        Ok(enrolled)
    }

    /// Classify a thread as it stands now. Safe to call repeatedly: a thread
    /// already classified at its latest message under the current rule is left
    /// alone, and one classified under an older rule is decided again from its
    /// stored answers without calling the classifier.
    pub async fn classify_thread(&self, thread_id: Uuid) -> Result<ClassifyOutcome, Report> {
        self.classify(thread_id, true).await
    }

    /// [`Self::classify_thread`], reading the due date of newly classified mail
    /// only when `read_due_date`.
    #[tracing::instrument(
        name = "classify_thread",
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
    async fn classify(
        &self,
        thread_id: Uuid,
        read_due_date: bool,
    ) -> Result<ClassifyOutcome, Report> {
        let Some(inbox) = self.store.thread_inbox(thread_id).await? else {
            return Ok(ClassifyOutcome::Missing);
        };
        if !inbox.inbox_visible {
            return Ok(ClassifyOutcome::NotSignal);
        }
        // Checked after the single-row read, and before any message content.
        if !self
            .is_enrolled(inbox.link_id, &inbox.owner, &inbox.delegates)
            .await?
        {
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
        // extractor to read, so the stored dates stand.
        if let Some(StoredClassification {
            answers: Some(answers),
            model,
            dates,
            ..
        }) = stored
        {
            let verdict = decide(answers, &signals);
            let saved = self
                .save_verdict(&thread, latest, verdict, *answers, model.clone(), *dates)
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
        let dates = if read_due_date {
            self.dates(&thread, &verdict, &answers, latest.at).await
        } else {
            FocusDates::default()
        };
        let saved = self
            .save_verdict(&thread, latest, verdict, answers, model, dates)
            .await?;
        if !saved {
            // A concurrent classification of a later message won.
            return Ok(ClassifyOutcome::UpToDate);
        }
        record_verdict(&verdict, false);
        Ok(ClassifyOutcome::Classified(verdict))
    }

    /// What newly classified mail says about a thread's days, for a thread that
    /// can be in Focus for a reason other than a calendar hold, and when they take
    /// effect for its owner. A failure costs the dates, never the classification,
    /// and the wait for them is bounded.
    async fn dates(
        &self,
        thread: &FocusThread,
        verdict: &FocusVerdict,
        answers: &FocusAnswers,
        latest_at: DateTime<Utc>,
    ) -> FocusDates {
        if !verdict.is_focus && !verdict.awaiting_reply {
            return FocusDates::default();
        }
        let span = tracing::info_span!(
            "email_focus.due_date",
            thread_id = %thread.thread_id,
            messages = Empty,
            outcome = Empty,
            event_found = Empty,
            event_counts = Empty,
            otel.status_code = Empty,
        );
        let extraction = async {
            // Only sharpens which day a message counts from and when a day begins
            // for the owner; carry on without it.
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
                return Ok((ThreadDates::default(), time_zone));
            }
            self.due_dates
                .dates(&thread.owner, thread.thread_id, &input)
                .await
                .map(|dates| (dates, time_zone))
        };
        async {
            let current = tracing::Span::current();
            match tokio::time::timeout(DUE_DATE_TIMEOUT, extraction).await {
                Ok(Ok((dates, time_zone))) => {
                    current.record(
                        "outcome",
                        if dates.due_on.is_some() {
                            "due"
                        } else {
                            "no_date"
                        },
                    );
                    current.record("event_found", dates.event_on.is_some());
                    let last_written_on = last_written_on(thread, time_zone);
                    let dates = focus_dates(
                        dates,
                        time_zone,
                        verdict,
                        answers,
                        latest_at,
                        last_written_on,
                    );
                    // Whether the meeting's day decides when the thread leaves.
                    current.record("event_counts", dates.event_over_at.is_some());
                    dates
                }
                Ok(Err(error)) => {
                    current.record("outcome", "failed");
                    current.record("otel.status_code", "error");
                    tracing::warn!(error = ?error, "focus due date unavailable");
                    FocusDates::default()
                }
                Err(_) => {
                    current.record("outcome", "timeout");
                    current.record("otel.status_code", "error");
                    tracing::warn!("focus due date timed out");
                    FocusDates::default()
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
        dates: FocusDates,
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
                dates,
            })
            .await?;
        if stored {
            self.notifier.focus_changed(&thread.owner, thread.link_id);
        }
        Ok(stored)
    }

    /// Which connected inboxes are in the rollout now, checking up to
    /// `checks_at_once` inboxes at a time. Every inbox found in it is
    /// remembered for the sweep, so a person who joins is found without mail
    /// of theirs arriving, and a restart forgets nobody for longer than one look.
    #[tracing::instrument(
        name = "email_focus.enrollment_scan",
        skip(self),
        err,
        fields(inboxes = Empty, enrolled = Empty, unknown = Empty)
    )]
    pub async fn enrolled_inboxes(&self, checks_at_once: usize) -> Result<EnrolledInboxes, Report> {
        let inboxes = self.store.syncing_inboxes().await?;
        let span = tracing::Span::current();
        span.record("inboxes", inboxes.len());
        let mut checks = stream::iter(inboxes)
            .map(|inbox| async move {
                let enrolled = self
                    .is_enrolled(inbox.link_id, &inbox.owner, &inbox.delegates)
                    .await;
                (inbox, enrolled)
            })
            .buffer_unordered(checks_at_once.max(1));
        let mut found = EnrolledInboxes::default();
        while let Some((inbox, enrolled)) = checks.next().await {
            match enrolled {
                Ok(true) => found.enrolled.push(inbox),
                Ok(false) => {}
                Err(error) => {
                    tracing::warn!(error = ?error, link_id = %inbox.link_id, "focus rollout unknown for an inbox");
                    found.unknown += 1;
                }
            }
        }
        span.record("enrolled", found.enrolled.len());
        span.record("unknown", found.unknown);
        Ok(found)
    }

    /// Classify every stale thread in `inbox` from the last `window`, newest
    /// first, `at_once` at a time: what fills an inbox that just joined the
    /// rollout. `due_dates` says whether newly classified mail gets a due
    /// date. Stops on the same signs as a sweep, and the sweep leaves
    /// the inbox alone meanwhile. An inbox outside the rollout gets nothing.
    #[tracing::instrument(
        name = "email_focus.backfill",
        skip(self, inbox),
        err,
        fields(
            link_id = %inbox.link_id,
            candidates = Empty,
            classified = Empty,
            stopped_early = Empty,
        )
    )]
    pub async fn backfill(
        &self,
        inbox: &FocusInboxOwner,
        window: Duration,
        at_once: usize,
        due_dates: DueDates,
    ) -> Result<SweepReport, Report> {
        let mut progress = SweepProgress::default();
        if !self
            .is_enrolled(inbox.link_id, &inbox.owner, &inbox.delegates)
            .await?
        {
            return Ok(progress.report);
        }
        self.backfilling().insert(inbox.link_id);
        let _backfilling = Backfilling {
            inboxes: &self.backfilling,
            link_id: inbox.link_id,
        };
        progress.report.inboxes = 1;
        let walk = Walk {
            since: Utc::now() - window,
            page: BACKFILL_PAGE,
            budget: None,
            at_once: at_once.max(1),
            due_dates,
        };
        self.sweep_inbox(inbox.link_id, &walk, &mut progress)
            .await?;
        let span = tracing::Span::current();
        span.record("candidates", progress.report.candidates);
        span.record("classified", progress.report.classified);
        span.record("stopped_early", progress.report.stopped_early);
        Ok(progress.report)
    }

    /// Check up to `limit` stale threads from the last `window` in the inboxes
    /// in the rollout, each inbox newest first, and classify those that need
    /// it. Stops at the first sign the classifier is
    /// unavailable, or after a run of rejections.
    ///
    /// The inboxes are every inbox holding Focus, so none is forgotten across a
    /// restart, and every inbox seen in the rollout since; an inbox that left the
    /// rollout drops out here, and an inbox being backfilled is left to the
    /// backfill. A thread checked without storing a result stays stale in the
    /// store, so the sweep pages past those: taking only the newest `limit`
    /// would hand every sweep the same threads once enough of them pile up, and
    /// never reach older ones.
    #[tracing::instrument(skip(self), err)]
    pub async fn sweep(&self, window: Duration, limit: i64) -> Result<SweepReport, Report> {
        let walk = Walk {
            since: Utc::now() - window,
            page: limit,
            budget: Some(limit),
            at_once: 1,
            due_dates: DueDates::Read,
        };
        let mut inboxes: HashMap<Uuid, FocusInboxOwner> = self
            .store
            .inboxes_with_focus()
            .await?
            .into_iter()
            .map(|inbox| (inbox.link_id, inbox))
            .collect();
        // Who an inbox is linked to as just read beats what was remembered.
        for (link_id, inbox) in self.enrolled().iter() {
            inboxes.entry(*link_id).or_insert_with(|| inbox.clone());
        }

        let mut progress = SweepProgress::default();
        let mut saw_them_all = true;
        for (link_id, inbox) in inboxes {
            if self.backfilling().contains(&link_id) {
                saw_them_all = false;
                continue;
            }
            match self
                .is_enrolled(link_id, &inbox.owner, &inbox.delegates)
                .await
            {
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
            if !self.sweep_inbox(link_id, &walk, &mut progress).await? {
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

    /// Page through one inbox's stale threads as `walk` says, until the sweep
    /// has made its budget of checks. Returns whether the sweep can go on to
    /// the next inbox: false once it hits the budget or must stop early.
    async fn sweep_inbox(
        &self,
        link_id: Uuid,
        walk: &Walk,
        progress: &mut SweepProgress,
    ) -> Result<bool, Report> {
        let mut after = None;
        loop {
            let threads = self
                .store
                .stale_threads(link_id, walk.since, after, walk.page)
                .await?;
            progress.report.candidates += threads.len();
            let last_page = i64::try_from(threads.len()).is_ok_and(|len| len < walk.page);
            after = threads.last().copied();
            if after.is_none() {
                return Ok(true);
            }
            let mut to_check = Vec::with_capacity(threads.len());
            let mut out_of_budget = false;
            for StaleThread {
                thread_id,
                latest_at,
            } in threads
            {
                progress.seen.insert(thread_id);
                if self.settled().get(&thread_id) == Some(&latest_at) {
                    progress.report.skipped += 1;
                    continue;
                }
                if walk.budget.is_some_and(|budget| progress.checks >= budget) {
                    out_of_budget = true;
                    break;
                }
                progress.checks += 1;
                to_check.push((thread_id, latest_at));
            }

            // Once one result says stop, the threads not yet started stay for
            // a later sweep; those already at the classifier finish. Once a
            // thread finds the inbox out of the rollout, so do the rest of it.
            let stop = AtomicBool::new(false);
            let left = AtomicBool::new(false);
            let mut outcomes = stream::iter(to_check)
                .map(|(thread_id, latest_at)| {
                    let stop = &stop;
                    let left = &left;
                    async move {
                        if stop.load(Ordering::Relaxed) || left.load(Ordering::Relaxed) {
                            return (thread_id, latest_at, None);
                        }
                        (
                            thread_id,
                            latest_at,
                            Some(
                                self.classify(thread_id, walk.due_dates.reads(latest_at))
                                    .await,
                            ),
                        )
                    }
                })
                .buffer_unordered(walk.at_once);
            while let Some((thread_id, latest_at, outcome)) = outcomes.next().await {
                let Some(outcome) = outcome else {
                    progress.checks -= 1;
                    continue;
                };
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
                        stop.store(true, Ordering::Relaxed);
                    }
                    Ok(ClassifyOutcome::Rejected) => {
                        report.failed += 1;
                        self.settled().insert(thread_id, latest_at);
                        progress.rejections_in_a_row += 1;
                        if progress.rejections_in_a_row >= MAX_REJECTIONS_IN_A_ROW
                            && !stop.swap(true, Ordering::Relaxed)
                        {
                            tracing::warn!(
                                rejections_in_a_row = progress.rejections_in_a_row,
                                "focus sweep stopped: the classifier rejects every thread"
                            );
                            report.stopped_early = true;
                        }
                    }
                    // Not settled: the answer depends on who reads the inbox,
                    // not on its mail, so the thread is checked again once the
                    // inbox is back in the rollout.
                    Ok(ClassifyOutcome::NotEnabled) => {
                        report.skipped += 1;
                        if !left.swap(true, Ordering::Relaxed) {
                            report.inboxes_left += 1;
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
            if progress.report.stopped_early || out_of_budget {
                return Ok(false);
            }
            if last_page || left.load(Ordering::Relaxed) {
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
