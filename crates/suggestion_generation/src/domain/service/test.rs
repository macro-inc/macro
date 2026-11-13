use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicUsize};

use agent_session::domain::routines::{
    PreparedRoutineSession, RoutineActionStatus, RoutineActivity, RoutineFailureReason,
    RoutinePendingReason, RoutinePromptAccepted, ValidatedRoutineSession,
};
use bot_id::BotId;
use feature_flags::outbound::fake::FakeFeatureFlags;
use feature_flags::{FlagSnapshot, FlagValue};
use model_owner::CreationPrincipal;
use scheduled_action::domain::suggestions::model::{
    RetireSuggestion, RoutineSuggestions, SuggestOutcome, SuggestRequest, SuggestionReview,
};
use suggestions::domain::model::{
    AttachDraft, NewSuggestion, RetireSuggestionRequest, RewriteSuggestion, SuggestionCaller,
    SuggestionError, SuggestionFeed, SuggestionWriteOutcome, SuggestionsReview,
};

use super::*;
use crate::domain::cadence::ROUTINES_EVERY;
use crate::domain::generation::{
    GenerationState, GenerationStatus, MAX_ATTEMPTS, OverviewFacts, PastRun, REGENERATE_EVERY,
};
use crate::domain::model::{
    ALL_SURFACES, AdmissionFacts, AudienceMember, LostGeneration, MAX_ROUTINE_SESSIONS,
};
use crate::domain::nightly::{ACTIVE_WITHIN, NIGHTLY_RETRY};
use crate::domain::session::MAX_CLEANUP_ATTEMPTS;

/// The people the tests' flags are set for.
const PEOPLE: usize = 32;

fn person(n: usize) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(format!("macro|generation-{n}@macro.com")).unwrap()
}

fn user() -> MacroUserIdStr<'static> {
    person(0)
}

/// What each session changed, as its tools counted it, by session; and
/// whether anything was counted while the session's tools still worked.
#[derive(Default)]
struct Counts {
    of: Mutex<HashMap<Uuid, u32>>,
    counted_open: AtomicBool,
}

impl Counts {
    fn count(&self, repo: &FakeRepo, session: Uuid) -> u32 {
        if repo.cleanup_of(session) == Some(Cleanup::Open) {
            self.counted_open.store(true, Ordering::SeqCst);
        }
        self.of.lock().unwrap().get(&session).copied().unwrap_or(0)
    }
}

/// How a fake session's turn goes.
#[derive(Debug, Clone, Copy)]
enum Turn {
    /// It reads as running `waits` times, then as `status`, having changed
    /// `changes` things through its tools.
    Ends {
        status: RoutineActionStatus,
        waits: u32,
        changes: u32,
    },
    /// Its prompt may not have arrived.
    Undelivered,
    /// It never ends.
    Hangs,
}

fn ends(status: RoutineActionStatus, changes: u32) -> Turn {
    Turn::Ends {
        status,
        waits: 0,
        changes,
    }
}

/// How each session's turn goes, from its brief and which try of that brief
/// it is.
type Script = fn(&str, usize) -> Turn;

fn finishes(_: &str, _: usize) -> Turn {
    ends(RoutineActionStatus::Succeeded, 1)
}

fn hangs(_: &str, _: usize) -> Turn {
    Turn::Hangs
}

/// Sessions whose turns go as the script says.
struct FakeSessions {
    repo: Arc<FakeRepo>,
    counts: Arc<Counts>,
    script: Script,
    prepared: Mutex<Vec<PrepareRoutineSession>>,
    prompts: Mutex<Vec<String>>,
    turns: Mutex<HashMap<Uuid, (Turn, u32)>>,
    cancelled: Mutex<Vec<Uuid>>,
    /// Each delete, with its generation's status when it ran.
    deleted: Mutex<Vec<(Uuid, Option<GenerationStatus>)>>,
    delete_fails: AtomicBool,
}

impl FakeSessions {
    fn deleted(&self) -> Vec<Uuid> {
        self.deleted
            .lock()
            .unwrap()
            .iter()
            .map(|(session, _)| *session)
            .collect()
    }
}

impl RoutineSessions for FakeSessions {
    async fn validate(
        &self,
        _: ValidateRoutineSession,
    ) -> Result<ValidatedRoutineSession, RoutineSessionError> {
        Err(RoutineSessionError::OperationFailed)
    }

    async fn prepare(
        &self,
        command: PrepareRoutineSession,
    ) -> Result<PreparedRoutineSession, RoutineSessionError> {
        let session_id = command.session_id;
        self.prepared.lock().unwrap().push(command);
        Ok(PreparedRoutineSession { session_id })
    }

    async fn prompt(
        &self,
        command: PromptRoutineSession,
    ) -> Result<RoutinePromptAccepted, RoutineSessionError> {
        let attempt = {
            let mut prompts = self.prompts.lock().unwrap();
            prompts.push(command.prompt.clone());
            prompts
                .iter()
                .filter(|prompt| **prompt == command.prompt)
                .count()
        };
        let turn = (self.script)(&command.prompt, attempt);
        let session = command.action.session_id.as_uuid();
        if let Turn::Ends { changes, .. } = turn {
            self.counts.of.lock().unwrap().insert(session, changes);
        }
        self.turns.lock().unwrap().insert(session, (turn, 0));
        if let Turn::Undelivered = turn {
            return Err(RoutineSessionError::PromptDeliveryUnknown);
        }
        Ok(RoutinePromptAccepted {
            action_id: command.action.action_id,
            queued: false,
        })
    }

    async fn status(
        &self,
        command: RoutineSessionAction,
    ) -> Result<RoutineActionStatus, RoutineSessionError> {
        let mut turns = self.turns.lock().unwrap();
        let Some((turn, reads)) = turns.get_mut(&command.session_id.as_uuid()) else {
            return Err(RoutineSessionError::OperationFailed);
        };
        let running = RoutineActionStatus::Pending(RoutinePendingReason::Running);
        Ok(match *turn {
            Turn::Ends { status, waits, .. } if *reads >= waits => status,
            Turn::Ends { .. } => {
                *reads += 1;
                running
            }
            Turn::Undelivered | Turn::Hangs => running,
        })
    }

    async fn cancel(&self, command: RoutineSessionAction) -> Result<(), RoutineSessionError> {
        self.cancelled
            .lock()
            .unwrap()
            .push(command.session_id.as_uuid());
        Ok(())
    }

    async fn activity(
        &self,
        _: RoutineSessionAction,
    ) -> Result<RoutineActivity, RoutineSessionError> {
        Ok(RoutineActivity {
            tool_calls: 3,
            turns: 1,
        })
    }

    async fn delete(&self, command: RoutineSessionAction) -> Result<(), RoutineSessionError> {
        if self.delete_fails.load(Ordering::SeqCst) {
            return Err(RoutineSessionError::OperationFailed);
        }
        let session = command.session_id.as_uuid();
        let status = self.repo.generation_status_of(session);
        self.deleted.lock().unwrap().push((session, status));
        Ok(())
    }
}

/// Routine suggestions: a brief naming its trigger and surfaces, and what
/// each session suggested.
struct FakeRoutines {
    repo: Arc<FakeRepo>,
    counts: Arc<Counts>,
    reports: Arc<Mutex<Vec<RoutineGenerationReport>>>,
}

impl RoutineSuggestionApi for FakeRoutines {
    async fn suggestions(
        &self,
        _: &MacroUserIdStr<'static>,
        _: Option<Surface>,
    ) -> anyhow::Result<RoutineSuggestions> {
        anyhow::bail!("generations never read suggestions")
    }

    async fn brief(
        &self,
        _: &MacroUserIdStr<'static>,
        surfaces: &[Surface],
        trigger: GenerationTrigger,
        _: Tz,
    ) -> anyhow::Result<String> {
        Ok(format!("routines {} {surfaces:?}", trigger.as_ref()))
    }

    async fn texts(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &[Uuid],
        _: chrono_tz::Tz,
    ) -> anyhow::Result<Vec<(Uuid, suggestions::domain::model::RoutineText)>> {
        Ok(Vec::new())
    }

    async fn suggested(&self, _: &MacroUserIdStr<'static>, session: Uuid) -> anyhow::Result<u32> {
        Ok(self.counts.count(&self.repo, session))
    }

    async fn record(&self, _: &MacroUserIdStr<'static>, report: RoutineGenerationReport) {
        self.reports.lock().unwrap().push(report);
    }

    async fn review(
        &self,
        _: &CreationPrincipal,
        _: Option<Uuid>,
    ) -> anyhow::Result<SuggestionReview> {
        anyhow::bail!("generations never review")
    }

    async fn retire(
        &self,
        _: &CreationPrincipal,
        _: Option<Uuid>,
        _: Uuid,
        _: RetireSuggestion,
    ) -> anyhow::Result<SuggestOutcome> {
        anyhow::bail!("generations never retire")
    }

    async fn dismiss(&self, _: &MacroUserIdStr<'static>, _: Uuid) -> anyhow::Result<()> {
        anyhow::bail!("generations never dismiss")
    }

    async fn suggest(
        &self,
        _: &CreationPrincipal,
        _: Option<Uuid>,
        _: SuggestRequest,
    ) -> anyhow::Result<SuggestOutcome> {
        anyhow::bail!("generations never suggest")
    }
}

/// Suggestions: a brief naming its trigger, and what each session changed.
struct FakeSuggestions {
    repo: Arc<FakeRepo>,
    counts: Arc<Counts>,
}

fn unused<T>() -> Result<T, SuggestionError> {
    Err(SuggestionError::NotFound)
}

impl SuggestionApi for FakeSuggestions {
    async fn feed(
        &self,
        _: &MacroUserIdStr<'static>,
        _: SuggestionCaller,
        _: Option<Tz>,
        _: Option<usize>,
    ) -> Result<SuggestionFeed, SuggestionError> {
        unused()
    }

    async fn viewed(
        &self,
        _: &MacroUserIdStr<'static>,
        _: SuggestionCaller,
    ) -> Result<(), SuggestionError> {
        unused()
    }

    async fn accept(
        &self,
        _: &MacroUserIdStr<'static>,
        _: SuggestionCaller,
        _: Uuid,
        _: suggestions::domain::model::Accept,
    ) -> Result<(), SuggestionError> {
        unused()
    }

    async fn dismiss(
        &self,
        _: &MacroUserIdStr<'static>,
        _: SuggestionCaller,
        _: Uuid,
    ) -> Result<(), SuggestionError> {
        unused()
    }

    async fn restore(
        &self,
        _: &MacroUserIdStr<'static>,
        _: SuggestionCaller,
        _: Uuid,
    ) -> Result<(), SuggestionError> {
        unused()
    }

    fn brief(&self, trigger: GenerationTrigger, _: Tz) -> String {
        format!("suggestions {}", trigger.as_ref())
    }

    async fn feed_changes(&self, _: Uuid, session: Uuid) -> Result<u32, SuggestionError> {
        Ok(self.counts.count(&self.repo, session))
    }

    async fn review(
        &self,
        _: &CreationPrincipal,
        _: Option<Uuid>,
    ) -> Result<SuggestionsReview, SuggestionError> {
        unused()
    }

    async fn suggest(
        &self,
        _: &CreationPrincipal,
        _: Option<Uuid>,
        _: NewSuggestion,
    ) -> Result<SuggestionWriteOutcome, SuggestionError> {
        unused()
    }

    async fn rewrite(
        &self,
        _: &CreationPrincipal,
        _: Option<Uuid>,
        _: Uuid,
        _: RewriteSuggestion,
    ) -> Result<SuggestionWriteOutcome, SuggestionError> {
        unused()
    }

    async fn retire(
        &self,
        _: &CreationPrincipal,
        _: Option<Uuid>,
        _: Uuid,
        _: RetireSuggestionRequest,
    ) -> Result<SuggestionWriteOutcome, SuggestionError> {
        unused()
    }

    async fn attach_draft(
        &self,
        _: &CreationPrincipal,
        _: Option<Uuid>,
        _: Uuid,
        _: AttachDraft,
    ) -> Result<SuggestionWriteOutcome, SuggestionError> {
        unused()
    }
}

#[derive(Debug, Clone)]
struct Generation {
    id: Uuid,
    user: MacroUserIdStr<'static>,
    trigger: GenerationTrigger,
    status: GenerationStatus,
    attempt: u8,
    started_at: DateTime<Utc>,
    finished_at: Option<DateTime<Utc>>,
    heartbeat_at: DateTime<Utc>,
}

impl Generation {
    fn past(&self) -> PastRun {
        PastRun {
            status: self.status,
            attempt: self.attempt,
            started_at: self.started_at,
        }
    }
}

#[derive(Debug, Clone)]
struct Session {
    id: Uuid,
    generation: Uuid,
    user: MacroUserIdStr<'static>,
    agent: BotId,
    kind: SessionKind,
    surfaces: Vec<String>,
    opened_at: DateTime<Utc>,
    cleanup: Cleanup,
    ending: Option<SessionEnding>,
    cleanup_at: Option<DateTime<Utc>>,
    attempts: u8,
}

/// A nightly outcome as recorded: whose, what, and their next run.
type Recorded = (
    MacroUserIdStr<'static>,
    NightlyOutcome,
    Option<DateTime<Utc>>,
);

#[derive(Debug, thiserror::Error)]
#[error("fake storage refused")]
struct Refused;

/// Generations and sessions in memory, written as the tables say, like the
/// real store's guards.
#[derive(Default)]
struct FakeRepo {
    generations: Mutex<Vec<Generation>>,
    sessions: Mutex<Vec<Session>>,
    /// Who the nightly tick reads as due.
    due: Mutex<Vec<AudienceMember>>,
    nightly: Mutex<Vec<Recorded>>,
    seen: Mutex<Vec<String>>,
    last_routines_ok: Mutex<Option<DateTime<Utc>>>,
    routines_ok: AtomicUsize,
    beats: AtomicUsize,
    /// The next beat finds its generation marked interrupted, as the sweep
    /// would after its heartbeat couldn't be written.
    lose_heartbeat: AtomicBool,
    /// Sessions can't be stored.
    refuse_sessions: AtomicBool,
}

impl FakeRepo {
    fn seed(
        &self,
        user: &MacroUserIdStr<'static>,
        trigger: GenerationTrigger,
        status: GenerationStatus,
        attempt: u8,
        started_at: DateTime<Utc>,
        heartbeat_at: DateTime<Utc>,
    ) -> Uuid {
        let id = Uuid::now_v7();
        self.generations.lock().unwrap().push(Generation {
            id,
            user: user.clone(),
            trigger,
            status,
            attempt,
            started_at,
            finished_at: (!status.is_running()).then_some(heartbeat_at),
            heartbeat_at,
        });
        id
    }

    fn seed_session(&self, generation: Uuid, user: &MacroUserIdStr<'static>) -> Uuid {
        let id = Uuid::now_v7();
        self.sessions.lock().unwrap().push(Session {
            id,
            generation,
            user: user.clone(),
            agent: bot_id::MACRO_NEW_BOT_ID,
            kind: SessionKind::Suggestions,
            surfaces: Vec::new(),
            opened_at: Utc::now(),
            cleanup: Cleanup::Open,
            ending: None,
            cleanup_at: None,
            attempts: 0,
        });
        id
    }

    fn generations(&self) -> Vec<Generation> {
        self.generations.lock().unwrap().clone()
    }

    fn generation(&self, id: Uuid) -> Generation {
        self.generations()
            .into_iter()
            .find(|generation| generation.id == id)
            .unwrap()
    }

    /// The only generation.
    fn only(&self) -> Generation {
        let generations = self.generations();
        assert_eq!(generations.len(), 1, "{generations:?}");
        generations[0].clone()
    }

    fn sessions(&self) -> Vec<Session> {
        self.sessions.lock().unwrap().clone()
    }

    fn session(&self, id: Uuid) -> Session {
        self.sessions()
            .into_iter()
            .find(|session| session.id == id)
            .unwrap()
    }

    fn cleanup_of(&self, session: Uuid) -> Option<Cleanup> {
        self.sessions
            .lock()
            .unwrap()
            .iter()
            .find(|row| row.id == session)
            .map(|row| row.cleanup)
    }

    fn generation_status_of(&self, session: Uuid) -> Option<GenerationStatus> {
        let generation = self
            .sessions
            .lock()
            .unwrap()
            .iter()
            .find(|row| row.id == session)?
            .generation;
        self.generations
            .lock()
            .unwrap()
            .iter()
            .find(|row| row.id == generation)
            .map(|row| row.status)
    }

    fn nightly(&self) -> Vec<Recorded> {
        self.nightly.lock().unwrap().clone()
    }

    fn set_last_routines_ok(&self, at: Option<DateTime<Utc>>) {
        *self.last_routines_ok.lock().unwrap() = at;
    }

    fn backdate_cleanup(&self, session: Uuid, by: TimeDelta) {
        for row in self.sessions.lock().unwrap().iter_mut() {
            if row.id == session {
                row.cleanup_at = row.cleanup_at.map(|at| at - by);
            }
        }
    }
}

fn stale(session: &Session) -> StaleSession {
    StaleSession {
        session: session.id,
        user: session.user.clone(),
        agent: session.agent,
        ending: session.ending.unwrap_or(SessionEnding::Interrupted),
        attempts: session.attempts,
    }
}

impl GenerationRepo for FakeRepo {
    type Err = Refused;

    async fn admission(
        &self,
        user: &MacroUserIdStr<'_>,
        trigger: GenerationTrigger,
    ) -> Result<AdmissionFacts, Self::Err> {
        let generations = self.generations.lock().unwrap();
        let running = generations
            .iter()
            .any(|row| row.user == *user && row.status.is_running());
        let latest = generations
            .iter()
            .filter(|row| row.user == *user && row.trigger == trigger)
            .max_by_key(|row| row.started_at)
            .map(Generation::past);
        Ok(AdmissionFacts { running, latest })
    }

    async fn insert(&self, new: &NewGeneration) -> Result<bool, Self::Err> {
        let mut generations = self.generations.lock().unwrap();
        let refused = generations.iter().any(|row| {
            row.user == new.user
                && (row.status.is_running()
                    || (row.trigger == new.trigger
                        && new.after.is_none_or(|after| row.started_at > after))
                    || (row.trigger == GenerationTrigger::Onboarding
                        && new.trigger == GenerationTrigger::Onboarding
                        && row.attempt == new.attempt))
        });
        if refused {
            return Ok(false);
        }
        generations.push(Generation {
            id: new.id,
            user: new.user.clone(),
            trigger: new.trigger,
            status: GenerationStatus::Generating,
            attempt: new.attempt,
            started_at: new.started_at,
            finished_at: None,
            heartbeat_at: new.started_at,
        });
        Ok(true)
    }

    async fn end(
        &self,
        generation: Uuid,
        event: GenerationEvent,
        now: DateTime<Utc>,
    ) -> Result<bool, Self::Err> {
        let mut generations = self.generations.lock().unwrap();
        let Some(row) = generations.iter_mut().find(|row| row.id == generation) else {
            return Ok(false);
        };
        let Ok(next) = row.status.on(event) else {
            return Ok(false);
        };
        row.status = next;
        row.finished_at = Some(now);
        Ok(true)
    }

    async fn beat(&self, generation: Uuid, now: DateTime<Utc>) -> Result<bool, Self::Err> {
        let mut generations = self.generations.lock().unwrap();
        let Some(row) = generations.iter_mut().find(|row| row.id == generation) else {
            return Ok(false);
        };
        if self.lose_heartbeat.load(Ordering::SeqCst)
            && let Ok(next) = row.status.on(GenerationEvent::HeartbeatLost)
        {
            row.status = next;
            row.finished_at = Some(now);
        }
        if !row.status.is_running() {
            return Ok(false);
        }
        self.beats.fetch_add(1, Ordering::SeqCst);
        row.heartbeat_at = now;
        Ok(true)
    }

    async fn interrupt_lost(
        &self,
        before: DateTime<Utc>,
        now: DateTime<Utc>,
        limit: u16,
    ) -> Result<Vec<LostGeneration>, Self::Err> {
        let mut generations = self.generations.lock().unwrap();
        generations.sort_by_key(|row| row.heartbeat_at);
        let mut lost = Vec::new();
        for row in generations.iter_mut() {
            if lost.len() == usize::from(limit) || row.heartbeat_at >= before {
                continue;
            }
            if let Ok(next) = row.status.on(GenerationEvent::HeartbeatLost) {
                row.status = next;
                row.finished_at = Some(now);
                lost.push(LostGeneration {
                    generation: row.id,
                    user: row.user.clone(),
                    trigger: row.trigger,
                });
            }
        }
        Ok(lost)
    }

    async fn open_session(
        &self,
        session: Uuid,
        generation: Uuid,
        user: &MacroUserIdStr<'_>,
        agent: BotId,
        kind: SessionKind,
        surfaces: &[String],
        now: DateTime<Utc>,
    ) -> Result<(), Self::Err> {
        if self.refuse_sessions.load(Ordering::SeqCst) {
            return Err(Refused);
        }
        self.sessions.lock().unwrap().push(Session {
            id: session,
            generation,
            user: MacroUserIdStr::try_from(user.as_ref().to_owned()).unwrap(),
            agent,
            kind,
            surfaces: surfaces.to_vec(),
            opened_at: now,
            cleanup: Cleanup::Open,
            ending: None,
            cleanup_at: None,
            attempts: 0,
        });
        Ok(())
    }

    async fn end_session(
        &self,
        session: Uuid,
        ending: SessionEnding,
        now: DateTime<Utc>,
    ) -> Result<bool, Self::Err> {
        let mut sessions = self.sessions.lock().unwrap();
        let Some(row) = sessions.iter_mut().find(|row| row.id == session) else {
            return Ok(false);
        };
        let Ok(next) = row.cleanup.on(CleanupEvent::Ended) else {
            return Ok(false);
        };
        row.cleanup = next;
        row.ending = Some(ending);
        row.cleanup_at = Some(now);
        Ok(true)
    }

    async fn advance_cleanup(
        &self,
        session: Uuid,
        event: CleanupEvent,
        now: DateTime<Utc>,
    ) -> Result<bool, Self::Err> {
        if event == CleanupEvent::Ended {
            return Ok(false);
        }
        let mut sessions = self.sessions.lock().unwrap();
        let Some(row) = sessions.iter_mut().find(|row| row.id == session) else {
            return Ok(false);
        };
        let Ok(next) = row.cleanup.on(event) else {
            return Ok(false);
        };
        row.cleanup = next;
        row.cleanup_at = Some(now);
        row.attempts += u8::from(event.counts_attempt());
        Ok(true)
    }

    async fn end_orphaned_sessions(
        &self,
        stale_before: DateTime<Utc>,
        now: DateTime<Utc>,
        limit: u16,
    ) -> Result<Vec<StaleSession>, Self::Err> {
        let generations = self.generations.lock().unwrap();
        let mut sessions = self.sessions.lock().unwrap();
        let mut ended = Vec::new();
        for row in sessions.iter_mut() {
            let running = generations.iter().any(|generation| {
                generation.id == row.generation && generation.status.is_running()
            });
            let orphaned = !running || row.opened_at < stale_before;
            if ended.len() == usize::from(limit) || !orphaned {
                continue;
            }
            if let Ok(next) = row.cleanup.on(CleanupEvent::Ended) {
                row.cleanup = next;
                row.ending = Some(SessionEnding::Interrupted);
                row.cleanup_at = Some(now);
                ended.push(stale(row));
            }
        }
        Ok(ended)
    }

    async fn claim_stuck_sessions(
        &self,
        before: DateTime<Utc>,
        now: DateTime<Utc>,
        limit: u16,
    ) -> Result<Vec<StaleSession>, Self::Err> {
        let mut sessions = self.sessions.lock().unwrap();
        let mut claimed = Vec::new();
        for row in sessions.iter_mut() {
            let waited = row.cleanup_at.is_some_and(|at| at < before);
            if claimed.len() == usize::from(limit) || row.cleanup != Cleanup::Stopping || !waited {
                continue;
            }
            row.cleanup_at = Some(now);
            claimed.push(stale(row));
        }
        Ok(claimed)
    }

    async fn last_routines_ok(
        &self,
        _: &MacroUserIdStr<'_>,
    ) -> Result<Option<DateTime<Utc>>, Self::Err> {
        Ok(*self.last_routines_ok.lock().unwrap())
    }

    async fn routines_ok(
        &self,
        _: &MacroUserIdStr<'_>,
        _: &str,
        now: DateTime<Utc>,
    ) -> Result<(), Self::Err> {
        self.routines_ok.fetch_add(1, Ordering::SeqCst);
        *self.last_routines_ok.lock().unwrap() = Some(now);
        Ok(())
    }

    async fn record_nightly(
        &self,
        user: &MacroUserIdStr<'_>,
        outcome: NightlyOutcome,
        next_run: Option<DateTime<Utc>>,
        _: DateTime<Utc>,
    ) -> Result<(), Self::Err> {
        let user = MacroUserIdStr::try_from(user.as_ref().to_owned()).unwrap();
        // Recorded, they leave the due set until their next run: the first
        // of theirs, as tests may list one person more than once.
        let mut due = self.due.lock().unwrap();
        if let Some(index) = due.iter().position(|member| member.user == user) {
            due.remove(index);
        }
        self.nightly.lock().unwrap().push((user, outcome, next_run));
        Ok(())
    }

    async fn see(
        &self,
        _: &MacroUserIdStr<'_>,
        timezone: &str,
        _: DateTime<Utc>,
        _: DateTime<Utc>,
    ) -> Result<(), Self::Err> {
        self.seen.lock().unwrap().push(timezone.to_owned());
        Ok(())
    }

    async fn account(&self, _: &MacroUserIdStr<'_>) -> Result<Option<Uuid>, Self::Err> {
        Ok(None)
    }

    async fn prune_changes(&self, _: DateTime<Utc>, _: u16) -> Result<u64, Self::Err> {
        Ok(0)
    }

    async fn traced(&self, _: Uuid, _: &str) -> Result<(), Self::Err> {
        Ok(())
    }

    async fn due(&self, _: DateTime<Utc>, limit: u16) -> Result<Vec<AudienceMember>, Self::Err> {
        let due = self.due.lock().unwrap();
        Ok(due.iter().take(usize::from(limit)).cloned().collect())
    }

    async fn overview(&self, user: &MacroUserIdStr<'_>) -> Result<OverviewFacts, Self::Err> {
        let generations = self.generations.lock().unwrap();
        let mine: Vec<&Generation> = generations.iter().filter(|row| row.user == *user).collect();
        Ok(OverviewFacts {
            running: mine
                .iter()
                .find(|row| row.status.is_running())
                .map(|row| (row.trigger, row.started_at)),
            last_ended: mine
                .iter()
                .filter(|row| !row.status.is_running())
                .max_by_key(|row| row.started_at)
                .and_then(|row| row.finished_at.map(|at| (row.status, at))),
            latest_manual: mine
                .iter()
                .filter(|row| row.trigger == GenerationTrigger::Manual)
                .max_by_key(|row| row.started_at)
                .map(|row| row.past()),
        })
    }
}

/// How a plan reads.
#[derive(Clone, Copy)]
enum Answer {
    Paid,
    Unpaid,
    Fails,
}

/// Plans the test sets per person; paid unless set.
#[derive(Default)]
struct FakePlans(Mutex<HashMap<String, Answer>>);

impl FakePlans {
    fn set(&self, user: &MacroUserIdStr<'_>, answer: Answer) {
        self.0
            .lock()
            .unwrap()
            .insert(user.as_ref().to_owned(), answer);
    }
}

#[async_trait::async_trait]
impl Plans for FakePlans {
    async fn paid(&self, user: &MacroUserIdStr<'static>) -> Result<bool, rootcause::Report> {
        let answer = self
            .0
            .lock()
            .unwrap()
            .get(user.as_ref())
            .copied()
            .unwrap_or(Answer::Paid);
        match answer {
            Answer::Paid => Ok(true),
            Answer::Unpaid => Ok(false),
            Answer::Fails => Err(rootcause::report!("plans unavailable")),
        }
    }
}

/// Whether every session is stored.
struct FakeStored(bool);

#[async_trait::async_trait]
impl StoredSessions for FakeStored {
    async fn exists(&self, _: AgentSessionId) -> Result<bool, rootcause::Report> {
        Ok(self.0)
    }
}

type Service =
    GenerationService<FakeRepo, FakeSessions, FakeRoutines, FakeSuggestions, FakeFeatureFlags>;

struct Harness {
    service: Service,
    repo: Arc<FakeRepo>,
    sessions: Arc<FakeSessions>,
    plans: Arc<FakePlans>,
    counts: Arc<Counts>,
    reports: Arc<Mutex<Vec<RoutineGenerationReport>>>,
    shutdown: CancellationToken,
}

/// The service, with suggestions and routine suggestions on or off for
/// everyone, sessions going as `script` says, and `stored` answering
/// whether a session is stored, when given.
fn build(suggestions: bool, routines: bool, script: Script, stored: Option<bool>) -> Harness {
    let mut flags = FakeFeatureFlags::default();
    for n in 0..PEOPLE {
        flags.set(
            person(n),
            Ok(FlagSnapshot::new([
                (SUGGESTIONS_FLAG.to_owned(), FlagValue::Boolean(suggestions)),
                (
                    ROUTINE_SUGGESTIONS_FLAG.to_owned(),
                    FlagValue::Boolean(routines),
                ),
            ])),
        );
    }
    let counts = Arc::new(Counts::default());
    let reports = Arc::new(Mutex::new(Vec::new()));
    let repo = Arc::new(FakeRepo::default());
    let sessions = Arc::new(FakeSessions {
        repo: Arc::clone(&repo),
        counts: Arc::clone(&counts),
        script,
        prepared: Mutex::new(Vec::new()),
        prompts: Mutex::new(Vec::new()),
        turns: Mutex::new(HashMap::new()),
        cancelled: Mutex::new(Vec::new()),
        deleted: Mutex::new(Vec::new()),
        delete_fails: AtomicBool::new(false),
    });
    let shutdown = CancellationToken::new();
    let plans = Arc::new(FakePlans::default());
    let service = GenerationService::new(
        Arc::clone(&repo),
        Arc::clone(&sessions),
        Arc::new(FakeRoutines {
            repo: Arc::clone(&repo),
            counts: Arc::clone(&counts),
            reports: Arc::clone(&reports),
        }),
        Arc::new(FakeSuggestions {
            repo: Arc::clone(&repo),
            counts: Arc::clone(&counts),
        }),
        Some(flags),
        GenerationAgent {
            bot: bot_id::MACRO_NEW_BOT_ID,
            model: "test-model".to_owned(),
        },
        TaskTracker::new(),
        shutdown.clone(),
    )
    .with_plans(Arc::clone(&plans) as Arc<dyn Plans>);
    let service = match stored {
        Some(stored) => service.with_stored_sessions(Arc::new(FakeStored(stored))),
        None => service,
    };
    Harness {
        service,
        repo,
        sessions,
        plans,
        counts,
        reports,
        shutdown,
    }
}

fn harness(suggestions: bool, routines: bool, script: Script) -> Harness {
    build(suggestions, routines, script, Some(true))
}

impl Harness {
    async fn onboard(&self) -> Result<StartOutcome, GenerationError> {
        let started = self
            .service
            .start(
                &user(),
                GenerationTrigger::Onboarding,
                chrono_tz::Europe::Paris,
            )
            .await;
        self.service.wait().await;
        started
    }

    async fn run(&self, trigger: GenerationTrigger) -> StartOutcome {
        let started = self
            .service
            .start(&user(), trigger, chrono_tz::UTC)
            .await
            .unwrap();
        self.service.wait().await;
        started
    }

    fn kinds(&self) -> Vec<SessionKind> {
        let mut kinds: Vec<SessionKind> = self
            .repo
            .sessions()
            .iter()
            .map(|session| session.kind)
            .collect();
        kinds.sort_by_key(|kind| kind.as_ref().to_owned());
        kinds
    }

    fn prompts(&self) -> Vec<String> {
        self.sessions.prompts.lock().unwrap().clone()
    }

    fn prepared(&self) -> usize {
        self.sessions.prepared.lock().unwrap().len()
    }

    fn cancelled(&self) -> Vec<Uuid> {
        self.sessions.cancelled.lock().unwrap().clone()
    }

    fn reports(&self) -> Vec<RoutineGenerationReport> {
        self.reports.lock().unwrap().clone()
    }

    /// What every session did was counted only once its tools refused it.
    fn counted_after_ending(&self) {
        assert!(!self.counts.counted_open.load(Ordering::SeqCst));
    }
}

/// A zone that is in its night now, so a nightly tick starts its people.
fn zone_in_its_night() -> Tz {
    *chrono_tz::TZ_VARIANTS
        .iter()
        .find(|zone| night::in_night(**zone, Utc::now()))
        .unwrap()
}

/// A zone that isn't.
fn zone_out_of_its_night() -> Tz {
    *chrono_tz::TZ_VARIANTS
        .iter()
        .find(|zone| !night::in_night(**zone, Utc::now()))
        .unwrap()
}

fn member(user: MacroUserIdStr<'static>, timezone: Tz) -> AudienceMember {
    AudienceMember {
        user,
        timezone,
        seen_at: Utc::now(),
    }
}

#[tokio::test(start_paused = true)]
async fn onboarding_runs_one_suggestions_session_and_a_routines_session_per_group_once() {
    let h = harness(true, true, finishes);
    assert_eq!(h.onboard().await.unwrap(), StartOutcome::Started);
    let groups = SessionLayout::default().sessions().len();
    let mut expected: Vec<_> = std::iter::repeat_n(SessionKind::Routines, groups).collect();
    expected.push(SessionKind::Suggestions);
    assert_eq!(h.kinds(), expected);
    // Hidden background sessions of the person's, never billed.
    let prepared = h.sessions.prepared.lock().unwrap().clone();
    assert_eq!(prepared.len(), groups + 1);
    for session in &prepared {
        assert_eq!(session.visibility, SessionVisibility::Hidden);
        assert_eq!(session.source, SessionSource::User);
        assert_eq!(session.billing, SessionBilling::NonBillable);
        assert_eq!(session.selection.owner, user());
        assert_eq!(session.selection.model.as_deref(), Some("test-model"));
    }
    // Every session finished, was deleted without a stop, and its row
    // records both.
    assert_eq!(h.sessions.deleted().len(), groups + 1);
    assert!(h.cancelled().is_empty());
    for session in h.repo.sessions() {
        assert_eq!(session.ending, Some(SessionEnding::Finished));
        assert_eq!(session.cleanup, Cleanup::Deleted);
    }
    h.counted_after_ending();
    // Each routines session was told its surfaces, by wire name.
    let prompts = h.prompts();
    assert!(prompts.contains(&"suggestions onboarding".to_owned()));
    assert!(
        prompts
            .iter()
            .any(|prompt| prompt.starts_with("routines onboarding [Email"))
    );
    assert!(
        h.repo
            .sessions()
            .iter()
            .any(|session| session.surfaces == ["email", "calendar", "tasks"])
    );
    assert_eq!(*h.repo.seen.lock().unwrap(), ["Europe/Paris"]);
    // Routine suggestions logged the run for their dashboard.
    let reports = h.reports();
    assert_eq!(reports.len(), 1);
    assert_eq!(
        (
            reports[0].trigger,
            reports[0].outcome,
            reports[0].sessions,
            reports[0].kept
        ),
        (
            "onboarding",
            "ready",
            groups,
            u32::try_from(groups).unwrap()
        )
    );
    let generation = h.repo.only();
    assert_eq!(generation.status, GenerationStatus::Ready);
    assert_eq!(generation.attempt, 1);
    // Its routines sessions finished and suggested: the week's are done.
    assert!(h.repo.last_routines_ok.lock().unwrap().is_some());
    // Onboarding runs once.
    assert_eq!(
        h.onboard().await.unwrap(),
        StartOutcome::Refused(Admission::Done)
    );
    assert_eq!(h.prepared(), groups + 1);
}

/// Onboarding cut short (its process stopped, or its heartbeat did) starts
/// again as the next attempt, with a new id, up to the last attempt.
#[tokio::test(start_paused = true)]
async fn an_onboarding_cut_short_starts_again_as_its_next_attempt() {
    let h = harness(true, false, finishes);
    let earlier = Utc::now() - TimeDelta::minutes(1);
    let first = h.repo.seed(
        &user(),
        GenerationTrigger::Onboarding,
        GenerationStatus::Cancelled,
        1,
        earlier,
        earlier,
    );
    assert_eq!(h.onboard().await.unwrap(), StartOutcome::Started);
    let next = h
        .repo
        .generations()
        .into_iter()
        .find(|generation| generation.id != first)
        .unwrap();
    assert_eq!(next.attempt, 2);
    assert_eq!(next.status, GenerationStatus::Ready);

    let h = harness(true, false, finishes);
    h.repo.seed(
        &user(),
        GenerationTrigger::Onboarding,
        GenerationStatus::Interrupted,
        MAX_ATTEMPTS,
        earlier,
        earlier,
    );
    assert_eq!(
        h.onboard().await.unwrap(),
        StartOutcome::Refused(Admission::Done)
    );
}

#[tokio::test(start_paused = true)]
async fn only_the_kinds_on_for_the_person_run() {
    let h = harness(true, false, finishes);
    assert_eq!(h.onboard().await.unwrap(), StartOutcome::Started);
    assert_eq!(h.kinds(), [SessionKind::Suggestions]);

    let h = harness(false, false, finishes);
    assert!(matches!(h.onboard().await, Err(GenerationError::NotFound)));
    assert!(h.repo.generations().is_empty());
}

/// Onboarding runs for every plan, but only a paid one counts the person in
/// for nightly runs.
#[tokio::test(start_paused = true)]
async fn onboarding_runs_for_every_plan_and_counts_in_only_paid_ones() {
    let h = harness(true, false, finishes);
    h.plans.set(&user(), Answer::Unpaid);
    assert_eq!(h.onboard().await.unwrap(), StartOutcome::Started);
    assert!(h.repo.seen.lock().unwrap().is_empty());
}

#[tokio::test(start_paused = true)]
async fn an_onboarding_routines_session_that_suggested_nothing_is_retried_once_a_nightly_one_never()
{
    // Routines sessions suggest something only on their second try; the
    // suggestions session changes nothing and is never retried.
    let second_try: Script = |brief, attempt| {
        let changes = u32::from(brief.starts_with("routines") && attempt == 2);
        ends(RoutineActionStatus::Succeeded, changes)
    };
    let h = harness(true, true, second_try);
    h.onboard().await.unwrap();
    let groups = SessionLayout::default().sessions().len();
    assert_eq!(h.prepared(), 1 + groups * 2);
    assert_eq!(h.reports()[0].retries, groups);

    let h = harness(true, true, second_try);
    h.repo
        .due
        .lock()
        .unwrap()
        .push(member(user(), zone_in_its_night()));
    assert_eq!(h.service.nightly().await.unwrap(), 1);
    h.service.wait().await;
    // At night one routines session covers every surface.
    assert_eq!(h.prepared(), 2);
    assert!(h.repo.sessions().iter().any(|session| {
        session.kind == SessionKind::Routines && session.surfaces.len() == ALL_SURFACES.len()
    }));
    assert!(h.prompts().contains(&"suggestions nightly".to_owned()));
    // A nightly run never counts the person in; reading their feed does.
    assert!(h.repo.seen.lock().unwrap().is_empty());
}

/// A turn that ended in failure counts as failed, never finished, whatever
/// its session changed first.
#[tokio::test(start_paused = true)]
async fn a_failed_turn_counts_as_failed() {
    let h = harness(true, false, |_, _| {
        ends(
            RoutineActionStatus::Failed(RoutineFailureReason::MaxTokens),
            0,
        )
    });
    h.onboard().await.unwrap();
    assert_eq!(h.repo.sessions()[0].ending, Some(SessionEnding::Failed));
    assert_eq!(h.repo.only().status, GenerationStatus::Failed);
    // Its turn may have stopped short of ending: it is stopped, then deleted.
    assert_eq!(h.cancelled().len(), 1);
    assert_eq!(h.sessions.deleted().len(), 1);

    // It changed the feed before failing: the generation ended part way.
    let h = harness(true, false, |_, _| {
        ends(
            RoutineActionStatus::Failed(RoutineFailureReason::RuntimeError),
            2,
        )
    });
    h.onboard().await.unwrap();
    assert_eq!(h.repo.sessions()[0].ending, Some(SessionEnding::Failed));
    assert_eq!(h.repo.only().status, GenerationStatus::Partial);
}

/// A hidden session that waits for a person's approval or answer will never
/// get it: it ends at once as failed, without waiting for its timeout.
#[tokio::test(start_paused = true)]
async fn a_session_waiting_for_a_person_ends_at_once_as_failed() {
    let scripts: [Script; 2] = [
        |_, _| {
            ends(
                RoutineActionStatus::Pending(RoutinePendingReason::Permission),
                0,
            )
        },
        |_, _| {
            ends(
                RoutineActionStatus::Pending(RoutinePendingReason::Elicitation),
                0,
            )
        },
    ];
    for script in scripts {
        let h = harness(true, false, script);
        let began = tokio::time::Instant::now();
        h.onboard().await.unwrap();
        assert!(began.elapsed() < Duration::from_secs(5));
        assert_eq!(h.repo.sessions()[0].ending, Some(SessionEnding::Failed));
        assert_eq!(h.cancelled().len(), 1);
        assert_eq!(h.repo.sessions()[0].cleanup, Cleanup::Deleted);
        assert_eq!(h.repo.only().status, GenerationStatus::Failed);
    }
}

#[tokio::test(start_paused = true)]
async fn a_generation_whose_prompts_may_not_have_arrived_is_recorded_failed() {
    let h = harness(true, false, |_, _| Turn::Undelivered);
    h.onboard().await.unwrap();
    assert_eq!(
        h.repo.sessions()[0].ending,
        Some(SessionEnding::DeliveryUnknown)
    );
    // The session was stopped and deleted, and the run counted as failed.
    assert_eq!(h.cancelled().len(), 1);
    assert_eq!(h.sessions.deleted().len(), 1);
    assert_eq!(h.repo.only().status, GenerationStatus::Failed);
}

/// A turn that runs past its kind's timeout is stopped and deleted; the
/// generation's heartbeat kept it running meanwhile.
#[tokio::test(start_paused = true)]
async fn a_session_past_its_timeout_is_stopped() {
    let h = harness(true, false, hangs);
    let began = tokio::time::Instant::now();
    h.onboard().await.unwrap();
    assert!(began.elapsed() >= ONBOARDING_SUGGESTIONS_TIMEOUT);
    assert!(began.elapsed() < ONBOARDING_SUGGESTIONS_TIMEOUT + HEARTBEAT);
    assert_eq!(h.repo.sessions()[0].ending, Some(SessionEnding::TimedOut));
    assert_eq!(h.cancelled().len(), 1);
    assert_eq!(h.repo.sessions()[0].cleanup, Cleanup::Deleted);
    assert_eq!(h.repo.only().status, GenerationStatus::Failed);
    // A beat every HEARTBEAT, the last racing the timeout.
    let beats = u64::try_from(h.repo.beats.load(Ordering::SeqCst)).unwrap();
    let expected = ONBOARDING_SUGGESTIONS_TIMEOUT.as_secs() / HEARTBEAT.as_secs();
    assert!((expected - 1..=expected).contains(&beats), "{beats}");
}

/// A session whose row can't be stored never runs: its tools would refuse
/// it.
#[tokio::test(start_paused = true)]
async fn a_session_that_cant_be_stored_never_runs() {
    let h = harness(true, false, finishes);
    h.repo.refuse_sessions.store(true, Ordering::SeqCst);
    assert_eq!(h.onboard().await.unwrap(), StartOutcome::Started);
    assert_eq!(h.prepared(), 0);
    assert_eq!(h.repo.only().status, GenerationStatus::Failed);
}

/// Some sessions finished: the generation ended part way.
#[tokio::test(start_paused = true)]
async fn a_generation_with_some_sessions_finished_ends_partial() {
    let h = harness(true, true, |brief, _| {
        if brief.starts_with("routines") {
            ends(RoutineActionStatus::Succeeded, 1)
        } else {
            Turn::Undelivered
        }
    });
    h.run(GenerationTrigger::Nightly).await;
    assert_eq!(h.repo.only().status, GenerationStatus::Partial);
    assert_eq!(h.reports()[0].outcome, "ready");
}

/// A stopping process stores its generation as cancelled before it cleans
/// up, so a deploy never leaves one running; a nightly run cut short is due
/// again at once.
#[tokio::test(start_paused = true)]
async fn a_stopping_process_records_the_generation_cancelled_before_cleaning_up() {
    let h = harness(true, true, hangs);
    assert_eq!(
        h.service
            .start(&user(), GenerationTrigger::Nightly, chrono_tz::UTC)
            .await
            .unwrap(),
        StartOutcome::Started
    );
    tokio::time::sleep(Duration::from_secs(5)).await;
    assert_eq!(h.prepared(), 2);
    h.shutdown.cancel();
    h.service.wait().await;
    assert_eq!(h.repo.only().status, GenerationStatus::Cancelled);
    for session in h.repo.sessions() {
        assert_eq!(session.ending, Some(SessionEnding::Cancelled));
        assert_eq!(session.cleanup, Cleanup::Deleted);
    }
    assert_eq!(h.cancelled().len(), 2);
    let deletes = h.sessions.deleted.lock().unwrap().clone();
    assert_eq!(deletes.len(), 2);
    assert!(
        deletes
            .iter()
            .all(|(_, status)| *status == Some(GenerationStatus::Cancelled)),
        "{deletes:?}"
    );
    let recorded = h.repo.nightly();
    assert_eq!(recorded.len(), 1);
    assert_eq!(recorded[0].0, user());
    assert_eq!(recorded[0].1, NightlyOutcome::CutShort);
    assert!(recorded[0].2.is_some_and(|at| at <= Utc::now()));
    assert_eq!(h.reports()[0].outcome, "cancelled");
    assert_eq!(h.repo.routines_ok.load(Ordering::SeqCst), 0);
    h.counted_after_ending();
}

/// When storage no longer counts a generation running (the sweep marked it
/// interrupted while its heartbeat couldn't be written), its sessions stop
/// at the next beat and are cleaned up; its status stays interrupted.
#[tokio::test(start_paused = true)]
async fn a_generation_storage_no_longer_counts_running_stops_its_sessions() {
    let h = harness(true, false, hangs);
    h.repo.lose_heartbeat.store(true, Ordering::SeqCst);
    let began = tokio::time::Instant::now();
    h.run(GenerationTrigger::Manual).await;
    assert!(began.elapsed() < HEARTBEAT * 2);
    assert_eq!(h.repo.only().status, GenerationStatus::Interrupted);
    let session = &h.repo.sessions()[0];
    assert_eq!(session.ending, Some(SessionEnding::Interrupted));
    assert_eq!(session.cleanup, Cleanup::Deleted);
    assert_eq!(h.cancelled().len(), 1);
}

/// What became of each person due a nightly run is recorded with their next
/// run: started, inactive or unpaid dropped from the rotation, past their
/// night missed, a plan that can't be read retried soon, and one whose run
/// came within the window skipped.
#[tokio::test(start_paused = true)]
async fn a_nightly_tick_records_what_became_of_each_person_due() {
    let h = harness(true, false, finishes);
    let night = zone_in_its_night();
    let day = zone_out_of_its_night();
    let now = Utc::now();
    h.plans.set(&person(4), Answer::Unpaid);
    h.plans.set(&person(5), Answer::Fails);
    let hour_ago = now - TimeDelta::hours(1);
    h.repo.seed(
        &person(6),
        GenerationTrigger::Nightly,
        GenerationStatus::Ready,
        1,
        hour_ago,
        hour_ago,
    );
    let inactive = AudienceMember {
        seen_at: now - ACTIVE_WITHIN - TimeDelta::hours(1),
        ..member(person(2), night)
    };
    *h.repo.due.lock().unwrap() = vec![
        member(person(1), night),
        inactive,
        member(person(3), day),
        member(person(4), night),
        member(person(5), night),
        member(person(6), night),
    ];
    assert_eq!(h.service.nightly().await.unwrap(), 1);
    h.service.wait().await;
    let recorded = h.repo.nightly();
    let outcomes: Vec<(MacroUserIdStr<'static>, NightlyOutcome)> = recorded
        .iter()
        .map(|(user, outcome, _)| (user.clone(), *outcome))
        .collect();
    assert_eq!(
        outcomes,
        [
            (person(1), NightlyOutcome::Started),
            (person(2), NightlyOutcome::Dropped),
            (person(3), NightlyOutcome::Missed),
            (person(4), NightlyOutcome::Dropped),
            (person(5), NightlyOutcome::Retrying),
            (person(6), NightlyOutcome::Skipped),
        ]
    );
    for (user, outcome, next_run) in recorded {
        let zone = if user == person(3) { day } else { night };
        match outcome {
            NightlyOutcome::Started | NightlyOutcome::Skipped | NightlyOutcome::Missed => {
                let next = next_run.unwrap();
                assert!(next > now, "{outcome:?}");
                assert!(night::in_night(zone, next), "{outcome:?} {next}");
            }
            NightlyOutcome::Retrying => {
                let wait = next_run.unwrap() - now;
                assert!(wait >= NIGHTLY_RETRY && wait < NIGHTLY_RETRY + TimeDelta::minutes(1));
            }
            NightlyOutcome::Dropped => assert_eq!(next_run, None),
            NightlyOutcome::CutShort => panic!("a tick cut a run short"),
        }
    }
    assert!(h.repo.due.lock().unwrap().is_empty());
}

#[tokio::test(start_paused = true)]
async fn nightly_starts_at_most_as_many_runs_as_the_process_has_room_for() {
    let h = harness(true, false, finishes);
    let night = zone_in_its_night();
    for n in 1..=MAX_NIGHTLY_RUNS + 2 {
        h.repo.due.lock().unwrap().push(member(person(n), night));
    }
    assert_eq!(h.service.nightly().await.unwrap(), MAX_NIGHTLY_RUNS);
    assert_eq!(h.repo.nightly().len(), MAX_NIGHTLY_RUNS);
    // The rest wait, still due, for room.
    assert_eq!(h.repo.due.lock().unwrap().len(), 2);
    h.service.wait().await;
    assert_eq!(h.service.nightly().await.unwrap(), 2);
    h.service.wait().await;
}

/// People dropped (inactive or unpaid) don't use up a tick: it keeps reading
/// who is due and starts those in their night.
#[tokio::test(start_paused = true)]
async fn dropped_people_dont_hold_up_a_nightly_tick() {
    let h = harness(true, false, finishes);
    let night = zone_in_its_night();
    let inactive = AudienceMember {
        seen_at: Utc::now() - ACTIVE_WITHIN - TimeDelta::hours(1),
        ..member(person(1), night)
    };
    let dropped = MAX_NIGHTLY_RUNS * 2 + 3;
    for _ in 0..dropped {
        h.repo.due.lock().unwrap().push(inactive.clone());
    }
    h.repo.due.lock().unwrap().push(member(person(2), night));
    assert_eq!(h.service.nightly().await.unwrap(), 1);
    h.service.wait().await;
    let recorded = h.repo.nightly();
    let count = |outcome| recorded.iter().filter(|(_, o, _)| *o == outcome).count();
    assert_eq!(count(NightlyOutcome::Dropped), dropped);
    assert_eq!(count(NightlyOutcome::Started), 1);
}

impl Harness {
    /// The kinds of session a fresh run of `trigger` runs.
    async fn kinds_of_run(&self, trigger: GenerationTrigger) -> Vec<SessionKind> {
        self.repo.sessions.lock().unwrap().clear();
        self.repo.generations.lock().unwrap().clear();
        self.run(trigger).await;
        let mut kinds = self.kinds();
        kinds.dedup();
        kinds
    }
}

/// A nightly run suggests routines once a week, counted from the last
/// routines session that finished and suggested something; other nights
/// only the suggestions session runs.
#[tokio::test(start_paused = true)]
async fn a_nightly_run_suggests_routines_once_a_week() {
    let h = harness(true, true, finishes);
    assert_eq!(
        h.kinds_of_run(GenerationTrigger::Nightly).await,
        [SessionKind::Routines, SessionKind::Suggestions]
    );
    assert_eq!(
        h.kinds_of_run(GenerationTrigger::Nightly).await,
        [SessionKind::Suggestions]
    );
    h.repo
        .set_last_routines_ok(Some(Utc::now() - ROUTINES_EVERY - TimeDelta::minutes(1)));
    assert_eq!(
        h.kinds_of_run(GenerationTrigger::Nightly).await,
        [SessionKind::Routines, SessionKind::Suggestions]
    );
    // With suggestions off, a night without routines runs nothing.
    let h = harness(false, true, finishes);
    h.repo
        .set_last_routines_ok(Some(Utc::now() - TimeDelta::days(1)));
    assert_eq!(
        h.run(GenerationTrigger::Nightly).await,
        StartOutcome::Nothing
    );
    assert!(h.repo.generations().is_empty());
}

/// Only a routines session that finished and suggested something counts as
/// the week's: one that suggested nothing or failed leaves the next run to
/// try again.
#[tokio::test(start_paused = true)]
async fn only_a_routines_session_that_finished_and_suggested_counts_as_the_weeks() {
    let scripts: [(Script, usize); 3] = [
        (|_, _| ends(RoutineActionStatus::Succeeded, 0), 0),
        (
            |_, _| {
                ends(
                    RoutineActionStatus::Failed(RoutineFailureReason::RuntimeError),
                    1,
                )
            },
            0,
        ),
        (finishes, 1),
    ];
    for (script, counted) in scripts {
        let h = harness(false, true, script);
        assert_eq!(
            h.run(GenerationTrigger::Nightly).await,
            StartOutcome::Started
        );
        assert_eq!(h.repo.routines_ok.load(Ordering::SeqCst), counted);
    }
}

/// Fresh suggestions on request run nightly-style, for any plan: the whole
/// workspace researched, one routines session for every surface.
#[tokio::test(start_paused = true)]
async fn regenerating_runs_a_nightly_style_generation_on_any_plan() {
    let h = harness(true, true, finishes);
    h.plans.set(&user(), Answer::Unpaid);
    h.service
        .regenerate(&user(), chrono_tz::Asia::Tokyo)
        .await
        .unwrap();
    h.service.wait().await;
    let generation = h.repo.only();
    assert_eq!(generation.trigger, GenerationTrigger::Manual);
    assert_eq!(generation.status, GenerationStatus::Ready);
    assert!(h.prompts().contains(&"suggestions manual".to_owned()));
    assert!(h.repo.sessions().iter().any(|session| {
        session.kind == SessionKind::Routines && session.surfaces.len() == ALL_SURFACES.len()
    }));
    assert_eq!(h.reports()[0].trigger, "manual");
    assert!(h.repo.seen.lock().unwrap().is_empty());
    assert!(h.repo.nightly().is_empty());
}

/// Fresh suggestions are refused while any of the person's generations runs
/// and within the hour of the last they asked for; one cut short may start
/// again at once.
#[tokio::test(start_paused = true)]
async fn regenerating_is_refused_while_one_runs_and_within_the_hour() {
    let h = harness(true, false, finishes);
    let now = Utc::now();
    h.repo.seed(
        &user(),
        GenerationTrigger::Nightly,
        GenerationStatus::Generating,
        1,
        now,
        now,
    );
    assert!(matches!(
        h.service.regenerate(&user(), chrono_tz::UTC).await,
        Err(GenerationError::Running)
    ));
    let overview = h.service.overview(&user()).await.unwrap();
    assert_eq!(overview.state, GenerationState::Running);
    assert_eq!(overview.trigger, Some(GenerationTrigger::Nightly));
    h.repo.generations.lock().unwrap().clear();

    let asked = now - TimeDelta::minutes(10);
    h.repo.seed(
        &user(),
        GenerationTrigger::Manual,
        GenerationStatus::Ready,
        1,
        asked,
        asked,
    );
    match h.service.regenerate(&user(), chrono_tz::UTC).await {
        Err(GenerationError::Cooldown { available_at }) => {
            assert_eq!(available_at, asked + REGENERATE_EVERY);
        }
        other => panic!("{other:?}"),
    }
    let overview = h.service.overview(&user()).await.unwrap();
    assert_eq!(overview.state, GenerationState::Idle);
    assert_eq!(overview.last_outcome, Some(GenerationStatus::Ready));
    assert_eq!(
        overview.regenerate_available_at,
        Some(asked + REGENERATE_EVERY)
    );

    // Cut short: the next attempt starts at once.
    let h = harness(true, false, finishes);
    h.repo.seed(
        &user(),
        GenerationTrigger::Manual,
        GenerationStatus::Interrupted,
        1,
        asked,
        asked,
    );
    h.service.regenerate(&user(), chrono_tz::UTC).await.unwrap();
    h.service.wait().await;
    let attempts: Vec<u8> = h
        .repo
        .generations()
        .iter()
        .map(|generation| generation.attempt)
        .collect();
    assert_eq!(attempts, [1, 2]);

    // An hour on, the person may ask again.
    let h = harness(true, false, finishes);
    let long_ago = now - REGENERATE_EVERY - TimeDelta::minutes(1);
    h.repo.seed(
        &user(),
        GenerationTrigger::Manual,
        GenerationStatus::Ready,
        1,
        long_ago,
        long_ago,
    );
    assert_eq!(
        h.service
            .overview(&user())
            .await
            .unwrap()
            .regenerate_available_at,
        None
    );
    h.service.regenerate(&user(), chrono_tz::UTC).await.unwrap();
    h.service.wait().await;
}

/// Fresh suggestions and their overview need suggestions on; routine
/// suggestions come along only when the week's are due.
#[tokio::test(start_paused = true)]
async fn regenerating_needs_suggestions_and_brings_routines_only_when_due() {
    let h = harness(false, true, finishes);
    assert!(matches!(
        h.service.regenerate(&user(), chrono_tz::UTC).await,
        Err(GenerationError::NotFound)
    ));
    assert!(matches!(
        h.service.overview(&user()).await,
        Err(GenerationError::NotFound)
    ));
    assert!(h.repo.generations().is_empty());

    let h = harness(true, true, finishes);
    h.repo
        .set_last_routines_ok(Some(Utc::now() - TimeDelta::days(1)));
    assert_eq!(
        h.kinds_of_run(GenerationTrigger::Manual).await,
        [SessionKind::Suggestions]
    );
    h.repo.set_last_routines_ok(None);
    assert_eq!(
        h.kinds_of_run(GenerationTrigger::Manual).await,
        [SessionKind::Routines, SessionKind::Suggestions]
    );
}

/// The sweep marks interrupted the generations whose heartbeat stopped, and
/// a nightly one's person is due again at once for the next attempt.
#[tokio::test(start_paused = true)]
async fn the_sweep_interrupts_lost_generations_and_makes_a_nightly_one_due_again() {
    let h = harness(true, true, finishes);
    let now = Utc::now();
    let silent = now - HEARTBEAT_LOST - TimeDelta::minutes(1);
    let nightly = h.repo.seed(
        &person(1),
        GenerationTrigger::Nightly,
        GenerationStatus::Generating,
        1,
        silent,
        silent,
    );
    let manual = h.repo.seed(
        &person(2),
        GenerationTrigger::Manual,
        GenerationStatus::Generating,
        1,
        silent,
        silent,
    );
    let alive = h.repo.seed(
        &person(3),
        GenerationTrigger::Onboarding,
        GenerationStatus::Generating,
        1,
        silent,
        now,
    );
    assert_eq!(h.service.sweep().await.unwrap(), 2);
    assert_eq!(
        h.repo.generation(nightly).status,
        GenerationStatus::Interrupted
    );
    assert_eq!(
        h.repo.generation(manual).status,
        GenerationStatus::Interrupted
    );
    assert_eq!(
        h.repo.generation(alive).status,
        GenerationStatus::Generating
    );
    let recorded = h.repo.nightly();
    assert_eq!(recorded.len(), 1);
    assert_eq!(recorded[0].0, person(1));
    assert_eq!(recorded[0].1, NightlyOutcome::CutShort);
    assert!(
        recorded[0]
            .2
            .is_some_and(|at| at >= now && at <= Utc::now())
    );
}

#[tokio::test(start_paused = true)]
async fn the_sweep_ends_and_deletes_sessions_a_stopped_process_left_open() {
    let h = harness(true, true, finishes);
    let earlier = Utc::now() - TimeDelta::minutes(10);
    let generation = h.repo.seed(
        &user(),
        GenerationTrigger::Nightly,
        GenerationStatus::Interrupted,
        1,
        earlier,
        earlier,
    );
    let left = h.repo.seed_session(generation, &user());
    assert_eq!(h.service.sweep().await.unwrap(), 1);
    let session = h.repo.session(left);
    assert_eq!(session.ending, Some(SessionEnding::Interrupted));
    assert_eq!(session.cleanup, Cleanup::Deleted);
    assert_eq!(h.cancelled(), [left]);
    assert_eq!(h.sessions.deleted(), [left]);
    assert_eq!(h.service.sweep().await.unwrap(), 0);
}

/// A session that can't be deleted is retried by later sweeps, each after a
/// wait, and given up after the last attempt.
#[tokio::test(start_paused = true)]
async fn a_session_that_cant_be_deleted_is_retried_then_given_up() {
    let h = harness(true, true, finishes);
    h.sessions.delete_fails.store(true, Ordering::SeqCst);
    let earlier = Utc::now() - TimeDelta::minutes(10);
    let generation = h.repo.seed(
        &user(),
        GenerationTrigger::Nightly,
        GenerationStatus::Interrupted,
        1,
        earlier,
        earlier,
    );
    let session = h.repo.seed_session(generation, &user());
    assert_eq!(h.service.sweep().await.unwrap(), 1);
    assert_eq!(h.repo.session(session).attempts, 1);
    for attempt in 2..=MAX_CLEANUP_ATTEMPTS {
        // Not before it waited.
        assert_eq!(h.service.sweep().await.unwrap(), 0);
        h.repo
            .backdate_cleanup(session, CLEANUP_RETRY + TimeDelta::minutes(1));
        assert_eq!(h.service.sweep().await.unwrap(), 1);
        let row = h.repo.session(session);
        assert_eq!(row.attempts, attempt);
        let expected = if attempt == MAX_CLEANUP_ATTEMPTS {
            Cleanup::Abandoned
        } else {
            Cleanup::Stopping
        };
        assert_eq!(row.cleanup, expected);
    }
    h.repo
        .backdate_cleanup(session, CLEANUP_RETRY + TimeDelta::minutes(1));
    assert_eq!(h.service.sweep().await.unwrap(), 0);
}

/// A session whose delete failed because it is already gone counts as
/// deleted; without knowing which sessions are stored, the delete is
/// retried.
#[tokio::test(start_paused = true)]
async fn a_session_already_gone_counts_as_deleted() {
    for (stored, cleanup, attempts) in [
        (Some(false), Cleanup::Deleted, 0),
        (Some(true), Cleanup::Stopping, 1),
        (None, Cleanup::Stopping, 1),
    ] {
        let h = build(true, true, finishes, stored);
        h.sessions.delete_fails.store(true, Ordering::SeqCst);
        let earlier = Utc::now() - TimeDelta::minutes(10);
        let generation = h.repo.seed(
            &user(),
            GenerationTrigger::Nightly,
            GenerationStatus::Interrupted,
            1,
            earlier,
            earlier,
        );
        let session = h.repo.seed_session(generation, &user());
        h.service.sweep().await.unwrap();
        let row = h.repo.session(session);
        assert_eq!(row.cleanup, cleanup, "{stored:?}");
        assert_eq!(row.attempts, attempts, "{stored:?}");
    }
}

#[test]
fn a_layout_has_at_most_three_sessions_and_every_surface_once() {
    assert!(SessionLayout::new(vec![ALL_SURFACES.to_vec()]).is_ok());
    assert!(SessionLayout::new(vec![vec![Surface::Email]; 4]).is_err());
    assert!(SessionLayout::new(vec![vec![Surface::Email]]).is_err());
    let mut twice = ALL_SURFACES.to_vec();
    twice.push(Surface::Email);
    assert!(SessionLayout::new(vec![twice]).is_err());
    assert_eq!(
        SessionLayout::default().sessions().len(),
        MAX_ROUTINE_SESSIONS
    );
    assert!(SessionLayout::new(SessionLayout::default().sessions().to_vec()).is_ok());
    assert_eq!(SessionLayout::single().sessions().len(), 1);
}

/// Loading the app counts a person as active only with suggestions on and a
/// paid plan.
#[tokio::test(start_paused = true)]
async fn loading_the_app_counts_paid_people_with_suggestions_on() {
    let h = harness(true, false, finishes);
    h.service
        .seen(&user(), chrono_tz::Asia::Tokyo)
        .await
        .unwrap();
    assert_eq!(*h.repo.seen.lock().unwrap(), ["Asia/Tokyo"]);
    h.plans.set(&user(), Answer::Unpaid);
    h.service
        .seen(&user(), chrono_tz::Asia::Tokyo)
        .await
        .unwrap();
    assert_eq!(h.repo.seen.lock().unwrap().len(), 1);
    let off = harness(false, true, finishes);
    off.service
        .seen(&user(), chrono_tz::Asia::Tokyo)
        .await
        .unwrap();
    assert!(off.repo.seen.lock().unwrap().is_empty());
}
