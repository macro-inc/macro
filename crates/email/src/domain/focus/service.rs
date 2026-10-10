//! Classifying threads and reading Focus back.

use std::{
    collections::{HashMap, HashSet},
    sync::{Mutex, MutexGuard, PoisonError},
};

use chrono::{DateTime, Duration, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use uuid::Uuid;

use super::{
    input::jev_input,
    models::{FocusAnswers, FocusRecord, FocusThread, FocusVerdict, StaleThread, ThreadFocus},
    ports::{FocusClassifier, FocusClassifierError, FocusStore, ProfileSource},
    questions::FOCUS_QUESTIONS,
    rule::decide,
    signals::signals,
};

/// Most Focus threads one list returns; one hydration batch.
const MAX_FOCUS_THREADS: i64 = 500;
/// Longest window the Focus list looks back over, in days.
const MAX_WINDOW_DAYS: u16 = 90;
/// Rejections in a row that end a sweep: the classifier is refusing every
/// request (a revoked key, say), not one thread.
const MAX_REJECTIONS_IN_A_ROW: usize = 5;

/// What happened to one thread.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClassifyOutcome {
    /// Classified and stored.
    Classified(FocusVerdict),
    /// Already classified at its latest message.
    UpToDate,
    /// The thread is gone, or has no message from anyone but the owner.
    Missing,
    /// The thread is not in the signal inbox.
    NotSignal,
    /// The inbox is not on the allowlist, so nothing left the system.
    NotEnabled,
    /// The classifier was unavailable; a later sweep retries.
    Unavailable,
    /// The classifier refused the thread.
    Rejected,
}

/// Counts from one sweep.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SweepReport {
    /// Threads the sweep found stale.
    pub candidates: usize,
    /// Threads classified.
    pub classified: usize,
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

/// Classifies threads for inboxes on the allowlist.
pub struct FocusService<S, P, C> {
    store: S,
    profiles: P,
    classifier: C,
    enabled_domains: Vec<String>,
    /// Threads a sweep checked at their latest mail without storing a result
    /// (rejected, nothing to classify, or a result already stored), so later
    /// sweeps skip them until new mail arrives. In memory: a restart retries
    /// each once.
    settled: Mutex<HashMap<Uuid, DateTime<Utc>>>,
}

impl<S, P, C> FocusService<S, P, C>
where
    S: FocusStore,
    P: ProfileSource,
    C: FocusClassifier,
{
    /// Classify only inboxes whose address is at one of `enabled_domains`;
    /// with none, nothing is classified.
    pub fn new(store: S, profiles: P, classifier: C, enabled_domains: Vec<String>) -> Self {
        let enabled_domains = enabled_domains
            .into_iter()
            .map(|domain| domain.trim().to_lowercase())
            .filter(|domain| !domain.is_empty())
            .collect();
        Self {
            store,
            profiles,
            classifier,
            enabled_domains,
            settled: Mutex::default(),
        }
    }

    fn settled(&self) -> MutexGuard<'_, HashMap<Uuid, DateTime<Utc>>> {
        self.settled.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn is_enabled(&self, address: &str) -> bool {
        let address = address.to_lowercase();
        address
            .rsplit_once('@')
            .is_some_and(|(_, domain)| self.enabled_domains.iter().any(|enabled| enabled == domain))
    }

    /// Classify a thread as it stands now. Safe to call repeatedly: a thread
    /// already classified at its latest message is left alone.
    #[tracing::instrument(skip(self), err)]
    pub async fn classify_thread(&self, thread_id: Uuid) -> Result<ClassifyOutcome, Report> {
        let Some(inbox) = self.store.thread_inbox(thread_id).await? else {
            return Ok(ClassifyOutcome::Missing);
        };
        if !self.is_enabled(&inbox.owner_email) {
            return Ok(ClassifyOutcome::NotEnabled);
        }
        if !inbox.is_signal || !inbox.inbox_visible {
            return Ok(ClassifyOutcome::NotSignal);
        }
        let mail = self.store.thread_mail(&inbox).await?;
        let thread = FocusThread::new(inbox, mail);
        let Some(latest) = thread.messages.last() else {
            return Ok(ClassifyOutcome::Missing);
        };
        if thread.messages.iter().all(|message| message.is_sent) {
            return Ok(ClassifyOutcome::Missing);
        }
        if thread.classified_message_id == Some(latest.id) {
            return Ok(ClassifyOutcome::UpToDate);
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
        let verdict = decide(&answers, &signals(&thread));
        let stored = self
            .store
            .save(&FocusRecord {
                thread_id: thread.thread_id,
                link_id: thread.link_id,
                classified_message_id: latest.id,
                classified_message_ts: latest.at,
                verdict,
                answers,
                model: self.classifier.model().to_owned(),
                classified_at: Utc::now(),
            })
            .await?;
        if !stored {
            // A concurrent classification of a later message won.
            return Ok(ClassifyOutcome::UpToDate);
        }
        Ok(ClassifyOutcome::Classified(verdict))
    }

    /// Classify up to `limit` stale signal threads from the last `window`,
    /// newest first. Stops at the first sign the classifier is unavailable,
    /// or after a run of rejections.
    #[tracing::instrument(skip(self), err)]
    pub async fn sweep(&self, window: Duration, limit: i64) -> Result<SweepReport, Report> {
        let mut report = SweepReport::default();
        if self.enabled_domains.is_empty() {
            return Ok(report);
        }
        let candidates = self
            .store
            .stale_threads(Utc::now() - window, &self.enabled_domains, limit)
            .await?;
        report.candidates = candidates.len();
        // Only this sweep's candidates can be skipped, so the map stays as
        // small as one sweep.
        let stale = candidates
            .iter()
            .map(|candidate| candidate.thread_id)
            .collect::<HashSet<_>>();
        self.settled()
            .retain(|thread_id, _| stale.contains(thread_id));

        let mut rejections_in_a_row = 0;
        for StaleThread {
            thread_id,
            latest_at,
        } in candidates
        {
            if self.settled().get(&thread_id) == Some(&latest_at) {
                report.skipped += 1;
                continue;
            }
            let outcome = self.classify_thread(thread_id).await;
            if !matches!(outcome, Ok(ClassifyOutcome::Rejected)) {
                rejections_in_a_row = 0;
            }
            match outcome {
                Ok(ClassifyOutcome::Classified(_)) => {
                    report.classified += 1;
                    self.settled().remove(&thread_id);
                }
                Ok(ClassifyOutcome::Unavailable) => {
                    report.failed += 1;
                    report.stopped_early = true;
                    break;
                }
                Ok(ClassifyOutcome::Rejected) => {
                    report.failed += 1;
                    self.settled().insert(thread_id, latest_at);
                    rejections_in_a_row += 1;
                    if rejections_in_a_row >= MAX_REJECTIONS_IN_A_ROW {
                        tracing::warn!(
                            rejections_in_a_row,
                            "focus sweep stopped: the classifier rejects every thread"
                        );
                        report.stopped_early = true;
                        break;
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
        Ok(report)
    }
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
    /// `window_days` (at most 90), most important first.
    pub async fn focus_thread_ids(
        &self,
        owner: &MacroUserIdStr<'static>,
        window_days: u16,
    ) -> Result<Vec<Uuid>, Report> {
        let days = window_days.clamp(1, MAX_WINDOW_DAYS);
        self.store
            .focus_thread_ids(
                owner,
                Utc::now() - Duration::days(i64::from(days)),
                MAX_FOCUS_THREADS,
            )
            .await
    }

    /// Stored classifications for the owner's threads among `thread_ids`.
    pub async fn focus_for_threads(
        &self,
        owner: &MacroUserIdStr<'static>,
        thread_ids: &[Uuid],
    ) -> Result<HashMap<Uuid, ThreadFocus>, Report> {
        if thread_ids.is_empty() {
            return Ok(HashMap::new());
        }
        self.store.focus_for_threads(owner, thread_ids).await
    }
}

#[cfg(test)]
mod test;
