//! Background runs of prompt suggestions: starting one, and moving it along
//! its state machine ([`crate::domain::run`]) as its session goes, from the
//! session's lifecycle events and the reconcile sweep.
//!
//! Whoever acts on a run first holds it (`claim_run`), so the event consumer
//! and the sweep, on any replica, never both stop, delete or settle it. Every
//! write is checked against the state it was decided on, so a cancel or a
//! start landing meanwhile is never overwritten: the step is decided again
//! from where the run is now.

use chrono::{TimeDelta, Utc};
use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use model_entity::EntityType;

use super::{Runs, SuggestionService};
use crate::domain::model::{RunStartError, StoredRun, Suggestion, SuggestionError, Target};
use crate::domain::ports::{
    RunEventOutcome, RunsReconciled, SuggestionAccess, SuggestionDrafts, SuggestionRepo,
    SuggestionRuns,
};
use crate::domain::run::{Advanced, Observation, RunEffect, RunEvent, RunState, SessionEvent};

/// How long whoever acts on a run holds it: enough to read its session and
/// stop, delete or settle it. A holder that dies lets go when it runs out.
const HOLD_FOR: TimeDelta = TimeDelta::minutes(2);

/// Runs one reconcile pass checks at most; the least recently checked go
/// first, so a long backlog takes turns.
const RECONCILE_BATCH: u16 = 200;

/// How many times a step is decided again when the run moved meanwhile.
const MOVE_ATTEMPTS: u8 = 3;

/// Most items a finished run adds to its suggestion's `produced`, its session
/// included.
const MAX_PRODUCED: usize = 200;

/// What a run's step is decided on.
#[derive(Debug, Clone, Copy)]
enum Evidence {
    /// Something that says what happened.
    Event(RunEvent),
    /// A fresh read of its session.
    ReadSession,
}

impl<Repo, Access, Drafts, Flags> SuggestionService<Repo, Access, Drafts, Flags>
where
    Repo: SuggestionRepo,
    Access: SuggestionAccess,
    Drafts: SuggestionDrafts,
    Flags: FeatureFlags + 'static,
{
    /// Start a run of background prompt suggestion `suggestion`, telling it
    /// `prompt`, allowed to send what `sends` says.
    #[tracing::instrument(name = "suggestions.run.start", skip_all, fields(
        suggestion.id = %suggestion.id,
        agent.session.id = tracing::field::Empty,
        suggestion.run.outcome = tracing::field::Empty,
    ), err)]
    pub(super) async fn start_run(
        &self,
        user: &MacroUserIdStr<'static>,
        suggestion: &Suggestion,
        prompt: &str,
        sends: Option<&str>,
        shown_updated_at: chrono::DateTime<Utc>,
    ) -> Result<(), SuggestionError> {
        let span = tracing::Span::current();
        let Some(runs) = &self.runs else {
            return Err(SuggestionError::Internal(rootcause::report!(
                "background runs are not configured"
            )));
        };
        let started_at = Utc::now();
        let run = StoredRun {
            session: Uuid::now_v7(),
            suggestion: suggestion.id,
            user: user.clone(),
            agent: runs.agent,
            action: Uuid::now_v7(),
            started_at,
            state: RunState::Starting,
            state_changed_at: started_at,
            sends: sends.map(str::to_owned),
        };
        span.record("agent.session.id", run.session.to_string());
        // What runs is what the person saw: a card read before the suggestion
        // was rewritten is read again first.
        if suggestion.updated_at != shown_updated_at {
            span.record("suggestion.run.outcome", "changed");
            return Err(SuggestionError::Changed(Box::new(suggestion.clone())));
        }
        // The row first, so two accepts at once start one session. It is
        // held while its session starts: a dismiss meanwhile cancels it, and
        // the start then stops what it opened rather than anyone else
        // settling it before its session exists.
        let hold_until = started_at + HOLD_FOR;
        if !self
            .repo
            .start_run(&run, shown_updated_at, hold_until)
            .await
            .map_err(SuggestionError::internal)?
        {
            span.record("suggestion.run.outcome", "not_runnable");
            let now = self
                .repo
                .suggestion(user, suggestion.id)
                .await
                .map_err(SuggestionError::internal)?;
            return Err(match now {
                // Changed since the card, or open but still settling an
                // earlier run (restored while it is cancelled): the caller
                // sees it as it is now. A closed one isn't there to accept.
                Some(now)
                    if now.updated_at != shown_updated_at
                        || (now.state.is_open()
                            && now.run.as_ref().is_some_and(|run| !run.state.is_settled())) =>
                {
                    SuggestionError::Changed(Box::new(now))
                }
                _ => SuggestionError::NotFound,
            });
        }
        let (event, outcome, result) = match runs.sessions.start(&run, prompt).await {
            Ok(()) => (RunEvent::Started, "started", Ok(())),
            // Nothing runs: the run fails, and running the suggestion again retries.
            Err(RunStartError::NotStarted(error)) => (
                RunEvent::StartRefused,
                "failed_to_start",
                Err(SuggestionError::Internal(error)),
            ),
            // The prompt may be running: the run stays starting, so no second
            // session starts, and its session settles it.
            Err(RunStartError::Uncertain(error)) => {
                tracing::warn!(?error, "a run's prompt may not have arrived");
                (RunEvent::StartUncertain, "uncertain", Ok(()))
            }
        };
        span.record("suggestion.run.outcome", outcome);
        // A failed write leaves the run starting; the sweep reads its session.
        let advanced = match self
            .advance(runs, run.clone(), Evidence::Event(event))
            .await
        {
            // An uncertain start writes nothing, so it never sees the run as
            // stored: a cancel that landed while it held the run is acted on
            // here, before it lets go.
            Ok(Advanced::Stayed) if event == RunEvent::StartUncertain => {
                self.after_uncertain_start(runs, &run).await
            }
            advanced => advanced,
        }
        .inspect_err(|error| tracing::warn!(?error, "could not record a run's start"));
        // A move lets go of the run; anything else lets go here.
        if !matches!(advanced, Ok(Advanced::Moved(_))) {
            let _ = self
                .repo
                .release_run(run.session, hold_until)
                .await
                .inspect_err(|error| tracing::warn!(?error, "could not let go of a run"));
        }
        if event == RunEvent::Started && matches!(advanced, Ok(Advanced::Refused)) {
            self.stop_orphaned_session(runs, &run).await;
        }
        if result.is_ok() {
            tracing::info!(event = "suggestions.run_started");
        }
        result
    }

    /// After a start whose answer was lost, act on run `started` as it is
    /// stored: still starting, it stays for its session to settle; cancelled
    /// meanwhile, its session is read and stopped now; settled or gone, its
    /// session, which may have taken the prompt, is deleted.
    async fn after_uncertain_start(
        &self,
        runs: &Runs,
        started: &StoredRun,
    ) -> Result<Advanced, SuggestionError> {
        match self
            .repo
            .run(started.session)
            .await
            .map_err(SuggestionError::internal)?
        {
            Some(now) if now.state == RunState::Starting => Ok(Advanced::Stayed),
            Some(now) if !now.state.is_settled() => {
                self.advance(runs, now, Evidence::ReadSession).await
            }
            _ => {
                self.stop_orphaned_session(runs, started).await;
                Ok(Advanced::Refused)
            }
        }
    }

    /// Delete `started`'s session when it took (or may have taken) its
    /// prompt after its run had settled without finishing (its hold ran out
    /// while it started), or after the run's row went with its suggestion,
    /// so nothing runs that no one watches. Best effort.
    async fn stop_orphaned_session(&self, runs: &Runs, started: &StoredRun) {
        let state = match self.repo.run(started.session).await {
            Ok(Some(now)) => Some(now.state),
            Ok(None) => None,
            Err(error) => {
                tracing::warn!(?error, "could not read a run that settled while starting");
                return;
            }
        };
        if state.is_some_and(|state| !state.is_settled() || state == RunState::Finished) {
            return;
        }
        let name = state.map(RunState::name);
        tracing::warn!(
            state = name.as_ref().map_or("deleted", AsRef::as_ref),
            "a run's session started after it settled"
        );
        let _ = runs.sessions.delete(started).await.inspect_err(|error| {
            tracing::warn!(?error, "could not delete an orphaned run session")
        });
    }

    /// Stop the run that closing `suggestion` just cancelled, now rather than
    /// at the next check. Best effort: the sweep stops it otherwise.
    pub(super) async fn stop_cancelled_run(&self, suggestion: &Suggestion) {
        let (Some(runs), Some(run)) = (&self.runs, &suggestion.run) else {
            return;
        };
        if run.state.is_settled() {
            return;
        }
        let _ = self
            .advance_held(runs, run.session_id, Evidence::ReadSession)
            .await
            .inspect_err(|error| tracing::warn!(?error, "could not stop a cancelled run"));
    }

    /// Hold run `session` and decide its step on `evidence`; `None` when
    /// someone else holds it.
    async fn advance_held(
        &self,
        runs: &Runs,
        session: Uuid,
        evidence: Evidence,
    ) -> Result<Option<Advanced>, SuggestionError> {
        let now = Utc::now();
        let until = now + HOLD_FOR;
        let Some(run) = self
            .repo
            .claim_run(session, now, until)
            .await
            .map_err(SuggestionError::internal)?
        else {
            return Ok(None);
        };
        let advanced = self.advance(runs, run, evidence).await;
        // A move lets go of the run; anything else lets go here, or when the
        // hold runs out.
        if !matches!(advanced, Ok(Advanced::Moved(_))) {
            let _ = self
                .repo
                .release_run(session, until)
                .await
                .inspect_err(|error| tracing::warn!(?error, "could not let go of a run"));
        }
        advanced.map(Some)
    }

    /// Decide `run`'s step on `evidence`, run what it needs first, and write
    /// where it goes if the run is still as read; when it moved meanwhile,
    /// decide again from where it is now.
    #[tracing::instrument(name = "suggestions.run.advance", skip_all, fields(
        agent.session.id = %run.session,
        suggestion.id = %run.suggestion,
        suggestion.run.from = run.state.name().as_ref(),
        suggestion.run.evidence = ?evidence,
        suggestion.run.outcome = tracing::field::Empty,
        suggestion.run.to = tracing::field::Empty,
    ), err)]
    async fn advance(
        &self,
        runs: &Runs,
        mut run: StoredRun,
        evidence: Evidence,
    ) -> Result<Advanced, SuggestionError> {
        let span = tracing::Span::current();
        let mut advanced = Advanced::Contended;
        for _ in 0..MOVE_ATTEMPTS {
            let now = Utc::now();
            let event = match evidence {
                Evidence::Event(event) => event,
                Evidence::ReadSession => {
                    let read = runs.sessions.state(&run).await;
                    if let Err(crate::domain::model::SessionReadError::Unreadable(error)) = &read {
                        tracing::warn!(?error, "could not read a run's session");
                    }
                    RunEvent::Observed(Observation::of_read(&read))
                }
            };
            let Ok(step) = run.state.on(event, run.started_at, now) else {
                advanced = Advanced::Refused;
                break;
            };
            let produced = match step.effect {
                None => Vec::new(),
                Some(effect) => match self.effect(runs, &run, effect).await {
                    Ok(produced) => produced,
                    Err(error) => {
                        tracing::warn!(?error, effect = effect.as_ref(), "a run's step failed");
                        advanced = Advanced::EffectFailed;
                        break;
                    }
                },
            };
            if !step.moves_from(run.state) {
                advanced = Advanced::Stayed;
                break;
            }
            if self
                .repo
                .move_run(&run, step.to, step.to.since_or(now), &produced, now)
                .await
                .map_err(SuggestionError::internal)?
            {
                let to = step.to.name();
                span.record("suggestion.run.to", to.as_ref());
                if to.is_settled() {
                    tracing::info!(
                        event = "suggestions.run_settled",
                        state = to.as_ref(),
                        produced = produced.len(),
                    );
                }
                advanced = Advanced::Moved(to);
                break;
            }
            // It moved meanwhile: decide again from where it is now.
            match self
                .repo
                .run(run.session)
                .await
                .map_err(SuggestionError::internal)?
            {
                Some(now) => run = now,
                None => {
                    advanced = Advanced::Refused;
                    break;
                }
            }
        }
        span.record("suggestion.run.outcome", advanced.as_str());
        Ok(advanced)
    }

    /// Run `effect` on `run`'s session; what it made, for
    /// [`RunEffect::ReadProduced`].
    async fn effect(
        &self,
        runs: &Runs,
        run: &StoredRun,
        effect: RunEffect,
    ) -> Result<Vec<Target>, rootcause::Report> {
        match effect {
            RunEffect::Stop => runs.sessions.stop(run).await.map(|()| Vec::new()),
            RunEffect::Delete => runs.sessions.delete(run).await.map(|()| Vec::new()),
            RunEffect::ReadProduced => {
                // The session is the result; the items it made come with it.
                let mut produced = vec![Target {
                    entity_type: EntityType::AgentSession,
                    entity_id: run.session.to_string(),
                    part_id: None,
                }];
                for item in runs.sessions.produced(run).await? {
                    if !produced.contains(&item) {
                        produced.push(item);
                    }
                }
                if produced.len() > MAX_PRODUCED {
                    tracing::warn!(made = produced.len(), "a run made more items than are kept");
                    produced.truncate(MAX_PRODUCED);
                }
                Ok(produced)
            }
        }
    }
}

impl<Repo, Access, Drafts, Flags> SuggestionRuns for SuggestionService<Repo, Access, Drafts, Flags>
where
    Repo: SuggestionRepo,
    Access: SuggestionAccess,
    Drafts: SuggestionDrafts,
    Flags: FeatureFlags + 'static,
{
    #[tracing::instrument(name = "suggestions.run.session_event", skip_all, fields(
        agent.session.id = %event.session,
        agent.session.news = event.news.as_ref(),
        suggestion.run.outcome = tracing::field::Empty,
    ), err)]
    async fn on_session_event(
        &self,
        event: SessionEvent,
    ) -> Result<RunEventOutcome, SuggestionError> {
        let span = tracing::Span::current();
        let Some(runs) = &self.runs else {
            return Ok(RunEventOutcome::Ignored);
        };
        // Most sessions run no suggestion: one lookup by key says so.
        let run = self
            .repo
            .run(event.session)
            .await
            .map_err(SuggestionError::internal)?
            .filter(|run| !run.state.is_settled());
        let Some(run) = run else {
            span.record("suggestion.run.outcome", "ignored");
            return Ok(RunEventOutcome::Ignored);
        };
        let evidence = match event.news.about_run(run.action) {
            Some(observation) => Evidence::Event(RunEvent::Observed(observation)),
            None => Evidence::ReadSession,
        };
        let outcome = match self.advance_held(runs, run.session, evidence).await? {
            Some(advanced) => RunEventOutcome::Applied(advanced),
            None => RunEventOutcome::Busy,
        };
        span.record(
            "suggestion.run.outcome",
            match outcome {
                RunEventOutcome::Ignored => "ignored",
                RunEventOutcome::Busy => "busy",
                RunEventOutcome::Applied(advanced) => advanced.as_str(),
            },
        );
        Ok(outcome)
    }

    #[tracing::instrument(name = "suggestions.runs.reconcile", skip_all, fields(
        suggestions.runs.checked = tracing::field::Empty,
        suggestions.runs.moved = tracing::field::Empty,
        suggestions.runs.settled = tracing::field::Empty,
        suggestions.runs.failed = tracing::field::Empty,
    ), err)]
    async fn reconcile_runs(&self) -> Result<RunsReconciled, SuggestionError> {
        let Some(runs) = &self.runs else {
            return Ok(RunsReconciled::default());
        };
        let candidates = self
            .repo
            .runs_to_check(Utc::now(), RECONCILE_BATCH)
            .await
            .map_err(SuggestionError::internal)?;
        let mut reconciled = RunsReconciled::default();
        for run in candidates {
            match self
                .advance_held(runs, run.session, Evidence::ReadSession)
                .await
            {
                // Someone else holds it, and acts on it.
                Ok(None) => {}
                Ok(Some(advanced)) => {
                    reconciled.checked += 1;
                    if let Advanced::Moved(to) = advanced {
                        reconciled.moved += 1;
                        reconciled.settled += usize::from(to.is_settled());
                    }
                }
                // One run's failure never stops the others.
                Err(error) => {
                    reconciled.failed += 1;
                    tracing::warn!(?error, agent.session.id = %run.session, "could not check a run");
                }
            }
        }
        let span = tracing::Span::current();
        span.record("suggestions.runs.checked", reconciled.checked);
        span.record("suggestions.runs.moved", reconciled.moved);
        span.record("suggestions.runs.settled", reconciled.settled);
        span.record("suggestions.runs.failed", reconciled.failed);
        Ok(reconciled)
    }
}
