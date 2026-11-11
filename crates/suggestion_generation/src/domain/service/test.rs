use std::collections::HashMap;
use std::sync::Mutex;

use agent_session::domain::routines::{
    PreparedRoutineSession, RoutineActivity, RoutinePromptAccepted, ValidatedRoutineSession,
};
use chrono::DateTime;
use feature_flags::outbound::fake::FakeFeatureFlags;
use feature_flags::{FlagSnapshot, FlagValue};
use ideas::domain::model::{
    AttachDraft, IdeaCaller, IdeaError, IdeaReview, IdeaWriteOutcome, Ideas, RetireIdea,
    RewriteIdea, SuggestIdea,
};
use model_owner::CreationPrincipal;
use scheduled_action::domain::suggestions::model::{
    RetireSuggestion, RoutineSuggestions, SuggestOutcome, SuggestRequest, SuggestionReview,
};

use super::*;
use crate::domain::model::{ALL_SURFACES, MAX_ROUTINE_SESSIONS};
use bot_id::BotId;

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|generation-owner@macro.com").unwrap()
}

/// What each session kept, as its tools would have counted it, keyed by
/// session.
#[derive(Default)]
struct Kept(Mutex<HashMap<Uuid, u32>>);

impl Kept {
    fn of(&self, session: Uuid) -> u32 {
        self.0.lock().unwrap().get(&session).copied().unwrap_or(0)
    }
}

/// How a fake session's turn goes: what it keeps, from its brief and
/// attempt.
type Turn = fn(&str, usize) -> u32;

/// Sessions whose turn "keeps" what `turn` says, as the session's tool calls
/// would.
struct FakeSessions {
    kept: Arc<Kept>,
    turn: Turn,
    undelivered: bool,
    prepared: Mutex<Vec<PrepareRoutineSession>>,
    prompts: Mutex<Vec<String>>,
    deleted: Mutex<Vec<AgentSessionId>>,
}

impl RoutineSessions for FakeSessions {
    async fn validate(
        &self,
        _: ValidateRoutineSession,
    ) -> Result<ValidatedRoutineSession, RoutineSessionError> {
        unreachable!("generations never validate a selection")
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
        if self.undelivered {
            return Err(RoutineSessionError::PromptDeliveryUnknown);
        }
        let attempt = {
            let mut prompts = self.prompts.lock().unwrap();
            prompts.push(command.prompt.clone());
            prompts
                .iter()
                .filter(|prompt| **prompt == command.prompt)
                .count()
        };
        let kept = (self.turn)(&command.prompt, attempt);
        self.kept
            .0
            .lock()
            .unwrap()
            .insert(command.action.session_id.as_uuid(), kept);
        Ok(RoutinePromptAccepted {
            action_id: command.action.action_id,
            queued: false,
        })
    }

    async fn status(
        &self,
        _: RoutineSessionAction,
    ) -> Result<RoutineActionStatus, RoutineSessionError> {
        Ok(RoutineActionStatus::Succeeded)
    }

    async fn cancel(&self, _: RoutineSessionAction) -> Result<(), RoutineSessionError> {
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
        self.deleted.lock().unwrap().push(command.session_id);
        Ok(())
    }
}

/// Routine suggestions: a brief naming its surfaces, and what was kept.
struct FakeRoutines(Arc<Kept>, Arc<Mutex<Vec<RoutineGenerationReport>>>);

impl RoutineSuggestionApi for FakeRoutines {
    async fn suggestions(
        &self,
        _: &MacroUserIdStr<'static>,
        _: Option<Surface>,
    ) -> anyhow::Result<RoutineSuggestions> {
        unreachable!()
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

    async fn kept(&self, _: &MacroUserIdStr<'static>, session: Uuid) -> anyhow::Result<u32> {
        Ok(self.0.of(session))
    }

    async fn record(&self, _: &MacroUserIdStr<'static>, report: RoutineGenerationReport) {
        self.1.lock().unwrap().push(report);
    }

    async fn review(
        &self,
        _: &CreationPrincipal,
        _: Option<Uuid>,
    ) -> anyhow::Result<SuggestionReview> {
        unreachable!()
    }

    async fn retire(
        &self,
        _: &CreationPrincipal,
        _: Option<Uuid>,
        _: Uuid,
        _: RetireSuggestion,
    ) -> anyhow::Result<SuggestOutcome> {
        unreachable!()
    }

    async fn dismiss(&self, _: &MacroUserIdStr<'static>, _: Uuid) -> anyhow::Result<()> {
        unreachable!()
    }

    async fn suggest(
        &self,
        _: &CreationPrincipal,
        _: Option<Uuid>,
        _: SuggestRequest,
    ) -> anyhow::Result<SuggestOutcome> {
        unreachable!()
    }
}

/// Ideas: a brief naming its trigger, and what was changed.
struct FakeIdeas(Arc<Kept>);

impl IdeaApi for FakeIdeas {
    async fn feed(
        &self,
        _: &MacroUserIdStr<'static>,
        _: IdeaCaller,
        _: Option<Tz>,
    ) -> Result<Ideas, IdeaError> {
        unreachable!()
    }

    async fn accept(
        &self,
        _: &MacroUserIdStr<'static>,
        _: IdeaCaller,
        _: Uuid,
        _: ideas::domain::model::Accept,
    ) -> Result<(), IdeaError> {
        unreachable!()
    }

    async fn dismiss(
        &self,
        _: &MacroUserIdStr<'static>,
        _: IdeaCaller,
        _: Uuid,
    ) -> Result<(), IdeaError> {
        unreachable!()
    }

    async fn settle_runs(&self) -> Result<usize, IdeaError> {
        unreachable!()
    }

    fn brief(&self, trigger: GenerationTrigger, _: Tz) -> String {
        format!("suggestions {}", trigger.as_ref())
    }

    async fn kept(&self, _: Uuid, session: Uuid) -> Result<u32, IdeaError> {
        Ok(self.0.of(session))
    }

    async fn review(
        &self,
        _: &CreationPrincipal,
        _: Option<Uuid>,
    ) -> Result<IdeaReview, IdeaError> {
        unreachable!()
    }

    async fn suggest(
        &self,
        _: &CreationPrincipal,
        _: Option<Uuid>,
        _: SuggestIdea,
    ) -> Result<IdeaWriteOutcome, IdeaError> {
        unreachable!()
    }

    async fn rewrite(
        &self,
        _: &CreationPrincipal,
        _: Option<Uuid>,
        _: Uuid,
        _: RewriteIdea,
    ) -> Result<IdeaWriteOutcome, IdeaError> {
        unreachable!()
    }

    async fn retire(
        &self,
        _: &CreationPrincipal,
        _: Option<Uuid>,
        _: Uuid,
        _: RetireIdea,
    ) -> Result<IdeaWriteOutcome, IdeaError> {
        unreachable!()
    }

    async fn attach_draft(
        &self,
        _: &CreationPrincipal,
        _: Option<Uuid>,
        _: Uuid,
        _: AttachDraft,
    ) -> Result<IdeaWriteOutcome, IdeaError> {
        unreachable!()
    }
}

/// A generation: its id, trigger, and whether it finished as ready.
type StoredGeneration = (Uuid, GenerationTrigger, Option<bool>);
/// A session: its kind, surfaces, and whether its row is open.
type StoredSession = (SessionKind, Vec<String>, bool);

/// Generations and sessions in memory.
#[derive(Default)]
struct FakeRepo {
    generations: Mutex<Vec<StoredGeneration>>,
    sessions: Mutex<HashMap<Uuid, StoredSession>>,
    seen: Mutex<Vec<String>>,
    due: Mutex<Vec<AudienceMember>>,
    /// Whether a routines session ran this week.
    routines_this_week: std::sync::atomic::AtomicBool,
    forgotten: Mutex<usize>,
    rescheduled: Mutex<usize>,
}

/// A zone that is in its night now, so a nightly tick starts its people.
fn zone_in_its_night() -> chrono_tz::Tz {
    *chrono_tz::TZ_VARIANTS
        .iter()
        .find(|zone| night::in_night(**zone, Utc::now()))
        .unwrap()
}

/// A zone that isn't.
fn zone_out_of_its_night() -> chrono_tz::Tz {
    *chrono_tz::TZ_VARIANTS
        .iter()
        .find(|zone| !night::in_night(**zone, Utc::now()))
        .unwrap()
}

fn member(timezone: chrono_tz::Tz) -> AudienceMember {
    AudienceMember {
        user: user(),
        timezone,
        seen_at: Utc::now(),
    }
}

impl GenerationRepo for FakeRepo {
    type Err = std::convert::Infallible;

    async fn begin(
        &self,
        _: &MacroUserIdStr<'_>,
        trigger: GenerationTrigger,
        _: DateTime<Utc>,
        _: DateTime<Utc>,
        _: DateTime<Utc>,
    ) -> Result<Option<Uuid>, Self::Err> {
        let mut generations = self.generations.lock().unwrap();
        let blocked = generations.iter().any(|(_, existing, finished)| {
            finished.is_none() || (*existing == trigger && trigger == GenerationTrigger::Onboarding)
        });
        if blocked {
            return Ok(None);
        }
        let id = Uuid::now_v7();
        generations.push((id, trigger, None));
        Ok(Some(id))
    }

    async fn finish(
        &self,
        generation: Uuid,
        ready: bool,
        _: DateTime<Utc>,
    ) -> Result<(), Self::Err> {
        for (id, _, finished) in self.generations.lock().unwrap().iter_mut() {
            if *id == generation {
                *finished = Some(ready);
            }
        }
        Ok(())
    }

    async fn open_session(
        &self,
        session: Uuid,
        _: Uuid,
        _: &MacroUserIdStr<'_>,
        _: BotId,
        kind: SessionKind,
        surfaces: &[String],
        _: DateTime<Utc>,
    ) -> Result<(), Self::Err> {
        self.sessions
            .lock()
            .unwrap()
            .insert(session, (kind, surfaces.to_vec(), true));
        Ok(())
    }

    async fn close_session(&self, session: Uuid) -> Result<(), Self::Err> {
        if let Some((_, _, open)) = self.sessions.lock().unwrap().get_mut(&session) {
            *open = false;
        }
        Ok(())
    }

    async fn stale_sessions(
        &self,
        _: DateTime<Utc>,
        _: u16,
    ) -> Result<Vec<StaleSession>, Self::Err> {
        Ok(self
            .sessions
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, (_, _, open))| *open)
            .map(|(session, _)| StaleSession {
                session: *session,
                user: user(),
                agent: bot_id::MACRO_NEW_BOT_ID,
            })
            .collect())
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

    async fn reschedule(
        &self,
        user: &MacroUserIdStr<'_>,
        _: DateTime<Utc>,
    ) -> Result<(), Self::Err> {
        *self.rescheduled.lock().unwrap() += 1;
        self.due
            .lock()
            .unwrap()
            .retain(|member| member.user != *user);
        Ok(())
    }

    async fn routines_since(
        &self,
        _: &MacroUserIdStr<'_>,
        _: DateTime<Utc>,
    ) -> Result<bool, Self::Err> {
        Ok(self
            .routines_this_week
            .load(std::sync::atomic::Ordering::SeqCst))
    }

    async fn forget(&self, user: &MacroUserIdStr<'_>) -> Result<(), Self::Err> {
        *self.forgotten.lock().unwrap() += 1;
        // The first of theirs: the tests' people share an id.
        let mut due = self.due.lock().unwrap();
        if let Some(index) = due.iter().position(|member| member.user == *user) {
            due.remove(index);
        }
        Ok(())
    }

    async fn due(
        &self,
        _: DateTime<Utc>,
        _: DateTime<Utc>,
        limit: u16,
    ) -> Result<Vec<AudienceMember>, Self::Err> {
        let due = self.due.lock().unwrap();
        Ok(due.iter().take(usize::from(limit)).cloned().collect())
    }
}

type Service = GenerationService<FakeRepo, FakeSessions, FakeRoutines, FakeIdeas, FakeFeatureFlags>;

/// Plans the test sets: everyone paid or nobody.
struct FakePlans(std::sync::atomic::AtomicBool);

#[async_trait::async_trait]
impl Plans for FakePlans {
    async fn paid(&self, _: &MacroUserIdStr<'static>) -> Result<bool, rootcause::Report> {
        Ok(self.0.load(std::sync::atomic::Ordering::SeqCst))
    }
}

struct Harness {
    plans: Arc<FakePlans>,
    service: Service,
    repo: Arc<FakeRepo>,
    sessions: Arc<FakeSessions>,
    reports: Arc<Mutex<Vec<RoutineGenerationReport>>>,
}

fn harness(ideas: bool, routines: bool, turn: Turn, undelivered: bool) -> Harness {
    let mut flags = FakeFeatureFlags::default();
    flags.set(
        user(),
        Ok(FlagSnapshot::new([
            (IDEAS_FLAG.to_owned(), FlagValue::Boolean(ideas)),
            (
                ROUTINE_SUGGESTIONS_FLAG.to_owned(),
                FlagValue::Boolean(routines),
            ),
        ])),
    );
    let kept = Arc::new(Kept::default());
    let reports = Arc::new(Mutex::new(Vec::new()));
    let repo = Arc::new(FakeRepo::default());
    let sessions = Arc::new(FakeSessions {
        kept: Arc::clone(&kept),
        turn,
        undelivered,
        prepared: Mutex::new(Vec::new()),
        prompts: Mutex::new(Vec::new()),
        deleted: Mutex::new(Vec::new()),
    });
    let service = GenerationService::new(
        Arc::clone(&repo),
        Arc::clone(&sessions),
        Arc::new(FakeRoutines(Arc::clone(&kept), Arc::clone(&reports))),
        Arc::new(FakeIdeas(kept)),
        Some(flags),
        GenerationAgent {
            bot: bot_id::MACRO_NEW_BOT_ID,
            model: "test-model".to_owned(),
        },
        TaskTracker::new(),
        CancellationToken::new(),
    );
    let plans = Arc::new(FakePlans(std::sync::atomic::AtomicBool::new(true)));
    let service = service.with_plans(Arc::clone(&plans) as Arc<dyn Plans>);
    Harness {
        plans,
        service,
        repo,
        sessions,
        reports,
    }
}

impl Harness {
    async fn onboard(&self) -> Result<bool, GenerationError> {
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

    fn kinds(&self) -> Vec<SessionKind> {
        let sessions = self.repo.sessions.lock().unwrap();
        let mut kinds: Vec<SessionKind> = sessions.values().map(|(kind, _, _)| *kind).collect();
        kinds.sort_by_key(|kind| kind.as_ref().to_owned());
        kinds
    }
}

#[tokio::test]
async fn onboarding_runs_one_ideas_session_and_a_routines_session_per_group_once() {
    let h = harness(true, true, |_, _| 1, false);
    assert!(h.onboard().await.unwrap());
    let groups = SessionLayout::default().sessions().len();
    let mut expected = vec![SessionKind::Ideas];
    expected.extend(std::iter::repeat_n(SessionKind::Routines, groups));
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
    // Every session was deleted and its row closed.
    assert_eq!(h.sessions.deleted.lock().unwrap().len(), groups + 1);
    assert!(
        h.repo
            .sessions
            .lock()
            .unwrap()
            .values()
            .all(|(_, _, open)| !open)
    );
    // Each routines session was told its surfaces, by wire name.
    let prompts = h.sessions.prompts.lock().unwrap().clone();
    assert!(prompts.contains(&"suggestions onboarding".to_owned()));
    assert!(
        prompts
            .iter()
            .any(|prompt| prompt.starts_with("routines onboarding [Email"))
    );
    assert!(
        h.repo
            .sessions
            .lock()
            .unwrap()
            .values()
            .any(|(_, surfaces, _)| surfaces == &["email", "calendar", "tasks"])
    );
    assert_eq!(*h.repo.seen.lock().unwrap(), ["Europe/Paris"]);
    // Routine suggestions logged the run for their dashboard.
    let reports = h.reports.lock().unwrap().clone();
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
    assert_eq!(
        h.repo.generations.lock().unwrap()[0].2,
        Some(true),
        "recorded as ready"
    );
    // Onboarding runs once.
    assert!(!h.onboard().await.unwrap());
    assert_eq!(h.sessions.prepared.lock().unwrap().len(), groups + 1);
}

#[tokio::test]
async fn only_the_kinds_on_for_the_person_run() {
    let h = harness(true, false, |_, _| 1, false);
    assert!(h.onboard().await.unwrap());
    assert_eq!(h.kinds(), [SessionKind::Ideas]);

    let h = harness(false, false, |_, _| 1, false);
    assert!(matches!(h.onboard().await, Err(GenerationError::NotFound)));
    assert!(h.repo.generations.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_onboarding_routines_session_that_kept_nothing_is_retried_once_a_nightly_one_never() {
    // Routines sessions keep something only on their second try; the ideas
    // session keeps nothing and is never retried.
    let second_try =
        |brief: &str, attempt: usize| u32::from(brief.starts_with("routines") && attempt == 2);
    let h = harness(true, true, second_try, false);
    h.onboard().await.unwrap();
    let groups = SessionLayout::default().sessions().len();
    assert_eq!(h.sessions.prepared.lock().unwrap().len(), 1 + groups * 2);

    let h = harness(true, true, second_try, false);
    h.repo.due.lock().unwrap().push(member(zone_in_its_night()));
    assert_eq!(h.service.nightly().await.unwrap(), 1);
    h.service.wait().await;
    // At night one routines session covers every surface.
    assert_eq!(h.sessions.prepared.lock().unwrap().len(), 2);
    assert!(
        h.repo
            .sessions
            .lock()
            .unwrap()
            .values()
            .any(|(kind, surfaces, _)| *kind == SessionKind::Routines
                && surfaces.len() == ALL_SURFACES.len())
    );
    let prompts = h.sessions.prompts.lock().unwrap().clone();
    assert!(prompts.contains(&"suggestions nightly".to_owned()));
    // A nightly run never counts the person in; reading their feed does.
    assert!(h.repo.seen.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_generation_whose_prompts_may_not_have_arrived_is_recorded_failed() {
    let h = harness(true, false, |_, _| 1, true);
    h.onboard().await.unwrap();
    // The session was stopped and deleted, and the run counted as failed.
    assert_eq!(h.sessions.deleted.lock().unwrap().len(), 1);
    assert_eq!(h.repo.generations.lock().unwrap()[0].2, Some(false));
}

#[tokio::test]
async fn nightly_starts_at_most_as_many_runs_as_the_process_has_room_for() {
    let h = harness(true, false, |_, _| 1, false);
    for _ in 0..5 {
        h.repo.due.lock().unwrap().push(member(zone_in_its_night()));
    }
    // The fake lets one run at a time per person, so one starts.
    assert_eq!(h.service.nightly().await.unwrap(), 1);
    h.service.wait().await;
}

/// People dropped (inactive or unpaid) or whose night ended don't use up a
/// tick: it keeps reading who is due, starts those in their night, and moves
/// the rest to their next night.
#[tokio::test]
async fn dropped_and_passed_over_people_dont_hold_up_a_nightly_tick() {
    let h = harness(true, false, |_, _| 1, false);
    let inactive = AudienceMember {
        seen_at: Utc::now() - ACTIVE_WITHIN - chrono::TimeDelta::hours(1),
        ..member(zone_in_its_night())
    };
    for _ in 0..(MAX_NIGHTLY_RUNS * 2 + 3) {
        h.repo.due.lock().unwrap().push(inactive.clone());
    }
    h.repo.due.lock().unwrap().push(member(zone_in_its_night()));
    assert_eq!(h.service.nightly().await.unwrap(), 1);
    h.service.wait().await;
    assert_eq!(*h.repo.forgotten.lock().unwrap(), MAX_NIGHTLY_RUNS * 2 + 3);
    assert_eq!(*h.repo.rescheduled.lock().unwrap(), 1);
    // Due after their night ended: no run, the next night instead.
    let h = harness(true, false, |_, _| 1, false);
    h.repo
        .due
        .lock()
        .unwrap()
        .push(member(zone_out_of_its_night()));
    assert_eq!(h.service.nightly().await.unwrap(), 0);
    assert_eq!(*h.repo.rescheduled.lock().unwrap(), 1);
    assert_eq!(*h.repo.forgotten.lock().unwrap(), 0);
    assert!(h.sessions.prepared.lock().unwrap().is_empty());
}

#[tokio::test]
async fn the_sweep_deletes_sessions_a_stopped_process_left_open() {
    let h = harness(true, true, |_, _| 1, false);
    let left = Uuid::now_v7();
    h.repo
        .open_session(
            left,
            Uuid::now_v7(),
            &user(),
            bot_id::MACRO_NEW_BOT_ID,
            SessionKind::Ideas,
            &[],
            Utc::now(),
        )
        .await
        .unwrap();
    assert_eq!(h.service.sweep().await.unwrap(), 1);
    assert_eq!(
        h.sessions.deleted.lock().unwrap().clone(),
        [AgentSessionId::new_from_uuid(left)]
    );
    assert_eq!(h.service.sweep().await.unwrap(), 0);
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

impl Harness {
    async fn nightly_kinds(&self) -> Vec<SessionKind> {
        self.repo.sessions.lock().unwrap().clear();
        self.repo.generations.lock().unwrap().clear();
        self.service
            .start(&user(), GenerationTrigger::Nightly, chrono_tz::UTC)
            .await
            .unwrap();
        self.service.wait().await;
        let mut kinds = self.kinds();
        kinds.dedup();
        kinds
    }
}

/// A nightly run suggests routines once a week; other nights only the
/// ideas session runs.
#[tokio::test]
async fn a_nightly_run_suggests_routines_once_a_week() {
    let h = harness(true, true, |_, _| 1, false);
    assert_eq!(
        h.nightly_kinds().await,
        [SessionKind::Ideas, SessionKind::Routines]
    );
    h.repo
        .routines_this_week
        .store(true, std::sync::atomic::Ordering::SeqCst);
    assert_eq!(h.nightly_kinds().await, [SessionKind::Ideas]);
    // With ideas off, a night without routines runs nothing.
    let h = harness(false, true, |_, _| 1, false);
    h.repo
        .routines_this_week
        .store(true, std::sync::atomic::Ordering::SeqCst);
    assert!(h.nightly_kinds().await.is_empty());
}

/// Only people on a paid plan get nightly runs; the others leave the
/// nightly audience. Onboarding runs for everyone.
#[tokio::test]
async fn only_paid_plans_get_nightly_runs() {
    let h = harness(true, false, |_, _| 1, false);
    h.plans.0.store(false, std::sync::atomic::Ordering::SeqCst);
    h.repo.due.lock().unwrap().push(member(zone_in_its_night()));
    assert_eq!(h.service.nightly().await.unwrap(), 0);
    assert_eq!(*h.repo.forgotten.lock().unwrap(), 1);
    assert!(h.onboard().await.unwrap());
    assert!(
        h.repo.seen.lock().unwrap().is_empty(),
        "free plans aren't in the audience"
    );
}

/// Loading the app counts a person as active only with ideas on and a paid
/// plan.
#[tokio::test]
async fn loading_the_app_counts_paid_people_with_ideas_on() {
    let h = harness(true, false, |_, _| 1, false);
    h.service
        .seen(&user(), chrono_tz::Asia::Tokyo)
        .await
        .unwrap();
    assert_eq!(*h.repo.seen.lock().unwrap(), ["Asia/Tokyo"]);
    h.plans.0.store(false, std::sync::atomic::Ordering::SeqCst);
    h.service
        .seen(&user(), chrono_tz::Asia::Tokyo)
        .await
        .unwrap();
    assert_eq!(h.repo.seen.lock().unwrap().len(), 1);
    let off = harness(false, true, |_, _| 1, false);
    off.service
        .seen(&user(), chrono_tz::Asia::Tokyo)
        .await
        .unwrap();
    assert!(off.repo.seen.lock().unwrap().is_empty());
}
