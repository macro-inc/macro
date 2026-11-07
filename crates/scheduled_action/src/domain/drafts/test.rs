use std::collections::HashMap;
use std::sync::Mutex;

use agent_session::domain::routines::{
    PreparedRoutineSession, RoutinePendingReason, RoutinePromptAccepted, ValidatedRoutineSession,
};
use ai_billing::{AdmissionFuture, AiAdmissionError, DisabledAiAdmissionService};
use chrono::DateTime;
use serde_json::json;

use super::*;
use crate::domain::code_check::{self, test::Checker};
use macro_uuid::Uuid;
use crate::domain::models::{ActionConfiguration, ActionKind};
use crate::domain::ports::{HandedBack, StaleDraft};

const OWNER: &str = "macro|owner@example.com";
const BUG_REPORTS: &str = "every time a message gets sent in bug-reports make a task";

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(OWNER).unwrap()
}

/// Drafts in memory, as the table keeps them.
#[derive(Default)]
struct Rows {
    drafts: Mutex<HashMap<Uuid, (MacroUserIdStr<'static>, BotId, HandedBack, DateTime<Utc>)>>,
    finished: Mutex<Vec<Uuid>>,
}

#[async_trait::async_trait]
impl DraftHandBacks for Rows {
    async fn begin(&self, session: Uuid, owner: &MacroUserIdStr<'static>, agent: BotId) -> Result<()> {
        self.drafts.lock().unwrap().insert(
            session,
            (owner.clone(), agent, HandedBack::default(), Utc::now()),
        );
        Ok(())
    }

    async fn record(
        &self,
        session: Uuid,
        owner: &MacroUserIdStr<'static>,
        check: &RoutineCheck,
    ) -> Result<bool> {
        let mut drafts = self.drafts.lock().unwrap();
        let Some((started_by, _, handed_back, _)) = drafts.get_mut(&session) else {
            return Ok(false);
        };
        if started_by != owner {
            return Ok(false);
        }
        handed_back.check = Some(check.clone());
        handed_back.checks += 1;
        Ok(true)
    }

    async fn handed_back(&self, session: Uuid) -> Result<HandedBack> {
        Ok(self
            .drafts
            .lock()
            .unwrap()
            .get(&session)
            .map(|(_, _, handed_back, _)| handed_back.clone())
            .unwrap_or_default())
    }

    async fn finish(&self, session: Uuid) -> Result<()> {
        self.drafts.lock().unwrap().remove(&session);
        self.finished.lock().unwrap().push(session);
        Ok(())
    }

    async fn stale(&self, before: DateTime<Utc>, _limit: u16) -> Result<Vec<StaleDraft>> {
        Ok(self
            .drafts
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, (_, _, _, started))| *started < before)
            .map(|(session, (owner, agent, _, _))| StaleDraft {
                session: *session,
                owner: owner.clone(),
                agent: *agent,
            })
            .collect())
    }
}

/// What the draft's session does with its prompt: the routines it checks,
/// in order, written from the prompt.
type Turn = Box<dyn Fn(&str) -> Vec<ActionConfiguration> + Send + Sync>;

/// The routine sessions a draft opens: preparing and prompting are
/// recorded, and the prompt's turn checks its routines into `rows` as the
/// check route would, then ends, unless the session `hangs`.
struct Sessions {
    rows: Arc<Rows>,
    code: Arc<Checker>,
    turn: Turn,
    hangs: bool,
    refuses: Option<RoutineSessionError>,
    prepared: Mutex<Vec<PrepareRoutineSession>>,
    prompts: Mutex<Vec<String>>,
    cancelled: Mutex<Vec<AgentSessionId>>,
    deleted: Mutex<Vec<AgentSessionId>>,
}

impl Sessions {
    fn new(rows: &Arc<Rows>, turn: Turn) -> Self {
        Self {
            rows: Arc::clone(rows),
            code: Arc::new(Checker::default()),
            turn,
            hangs: false,
            refuses: None,
            prepared: Mutex::new(Vec::new()),
            prompts: Mutex::new(Vec::new()),
            cancelled: Mutex::new(Vec::new()),
            deleted: Mutex::new(Vec::new()),
        }
    }
}

impl RoutineSessions for Sessions {
    async fn validate(
        &self,
        _: ValidateRoutineSession,
    ) -> Result<ValidatedRoutineSession, RoutineSessionError> {
        unreachable!("drafts never validate a selection")
    }

    async fn prepare(
        &self,
        command: PrepareRoutineSession,
    ) -> Result<PreparedRoutineSession, RoutineSessionError> {
        if let Some(error) = self.refuses {
            return Err(error);
        }
        let session_id = command.session_id;
        self.prepared.lock().unwrap().push(command);
        Ok(PreparedRoutineSession { session_id })
    }

    async fn prompt(
        &self,
        command: PromptRoutineSession,
    ) -> Result<RoutinePromptAccepted, RoutineSessionError> {
        self.prompts.lock().unwrap().push(command.prompt.clone());
        for routine in (self.turn)(&command.prompt) {
            let check = checked(self.code.as_ref(), routine).await;
            self.rows
                .record(
                    command.action.session_id.as_uuid(),
                    &command.action.owner,
                    &check,
                )
                .await
                .unwrap();
        }
        Ok(RoutinePromptAccepted {
            action_id: command.action.action_id,
            queued: false,
        })
    }

    async fn status(
        &self,
        _: RoutineSessionAction,
    ) -> Result<RoutineActionStatus, RoutineSessionError> {
        Ok(if self.hangs {
            RoutineActionStatus::Pending(RoutinePendingReason::Running)
        } else {
            RoutineActionStatus::Succeeded
        })
    }

    async fn cancel(&self, command: RoutineSessionAction) -> Result<(), RoutineSessionError> {
        self.cancelled.lock().unwrap().push(command.session_id);
        Ok(())
    }

    async fn delete_draft(&self, command: RoutineSessionAction) -> Result<(), RoutineSessionError> {
        self.deleted.lock().unwrap().push(command.session_id);
        Ok(())
    }
}

/// What the check route answers for `routine`: its code type-checked as
/// saving checks it.
async fn checked(code: &Checker, routine: ActionConfiguration) -> RoutineCheck {
    let mut routine = routine;
    routine.task = code_check::named_steps(&routine.task);
    let (steps, task) = match code_check::checked_task(code, &routine.task, None).await {
        Ok(task) => (Vec::new(), task),
        Err(code_check::CodeCheckError::DoesNotCheck { steps }) => (
            crate::domain::service::step_positions(&routine.task, steps),
            routine.task.clone(),
        ),
        Err(error) => panic!("{error}"),
    };
    routine.task = task;
    RoutineCheck {
        ok: steps.is_empty(),
        problems: Vec::new(),
        steps,
        routine,
    }
}

struct Refused;

impl AiAdmissionService for Refused {
    fn admit<'a>(&'a self, _: &'a MacroUserIdStr<'_>, _: AiFeature) -> AdmissionFuture<'a> {
        Box::pin(async { Err(AiAdmissionError::Unavailable) })
    }
}

fn agent() -> DraftAgent {
    DraftAgent {
        bot: bot_id::MACRO_NEW_BOT_ID,
        model: Some("google/gemini-3.8-flash".into()),
    }
}

fn drafts(rows: &Arc<Rows>, sessions: &Arc<Sessions>) -> RoutineDrafts<Checker, Sessions> {
    RoutineDrafts::new(
        Arc::new(Checker::default()),
        Arc::clone(sessions),
        Arc::clone(rows) as Arc<dyn DraftHandBacks>,
        Arc::new(DisabledAiAdmissionService),
        agent(),
    )
    .with_conditions_enabled(true)
}

fn context() -> DraftContext {
    DraftContext {
        timezone: "America/New_York".into(),
        agent_model: "anthropic/claude-sonnet-5-5".into(),
        code: true,
        conditions: true,
        ignored_workspace: serde::de::IgnoredAny,
    }
}

fn routine(description: &str) -> DraftRequest {
    DraftRequest::Routine {
        description: description.into(),
    }
}

fn code_step(title: &str, source: &str) -> Value {
    json!({ "type": "code", "title": title, "summary": "", "source": source })
}

fn agent_step() -> Value {
    json!({ "type": "agent", "model": "anthropic/claude-sonnet-5-5", "instructions": "Research it." })
}

/// A routine as `macro.routines.check` sends it.
fn configuration(name: &str, trigger: Value, steps: Value) -> ActionConfiguration {
    ActionConfiguration {
        name: name.into(),
        trigger: serde_json::from_value(trigger).unwrap(),
        kind: ActionKind::Agent,
        task: json!({ "steps": steps }),
        enabled: true,
        run_visibility: Default::default(),
        description: String::new(),
    }
}

fn message_posted(ids: &[Uuid]) -> Value {
    json!({
        "type": "events",
        "filters": [{ "events": ["channel.message_posted"], "ids": ids }],
    })
}

async fn draft(drafts: &RoutineDrafts<Checker, Sessions>, request: DraftRequest) -> Draft {
    drafts.draft(owner(), request, context()).await.unwrap()
}

fn drafted_routine(draft: Draft) -> DraftedRoutine {
    match draft {
        Draft::Routine(routine) => routine,
        other => panic!("expected a routine, got {other:?}"),
    }
}

fn drafted_step(draft: Draft) -> DraftedStep {
    match draft {
        Draft::Step(step) => step,
        other => panic!("expected a step, got {other:?}"),
    }
}

/// A workspace's channels as a search pages through them: `per_page` at a
/// time, best match first, and the session pages until it finds the one
/// named exactly.
struct Channels {
    ranked: Vec<(String, Uuid)>,
    per_page: usize,
}

impl Channels {
    fn find(&self, name: &str) -> (Option<Uuid>, usize) {
        let mut pages = 0;
        for page in self.ranked.chunks(self.per_page) {
            pages += 1;
            if let Some((_, id)) = page.iter().find(|(channel, _)| channel == name) {
                return (Some(*id), pages);
            }
        }
        (None, pages)
    }
}

#[tokio::test]
async fn a_draft_runs_in_a_hidden_read_only_session_and_hands_back_its_last_check() {
    let rows = Arc::new(Rows::default());
    let sessions = Arc::new(Sessions::new(
        &rows,
        Box::new(|_| {
            vec![
                // Its first check finds the code doesn't type-check...
                configuration(
                    "Bug tasks",
                    message_posted(&[]),
                    json!([code_step("Make a task", "bad")]),
                ),
                // ...so it fixes the code and checks the finished routine.
                configuration(
                    " Bug tasks ",
                    message_posted(&[]),
                    json!([code_step("Make a task", "good")]),
                ),
            ]
        }),
    ));
    let drafts = drafts(&rows, &sessions);

    let drafted = drafted_routine(draft(&drafts, routine(BUG_REPORTS)).await);

    assert_eq!(drafted.name, "Bug tasks");
    assert!(drafted.problems.is_empty());
    assert_eq!(drafted.steps.len(), 1);
    assert_eq!(drafted.steps[0]["source"], "good");
    // Saving names code steps; the check named this one as saving will.
    assert_eq!(drafted.steps[0]["id"], "make_a_task");
    let prepared = sessions.prepared.lock().unwrap().clone();
    let [prepared] = prepared.as_slice() else {
        panic!("one session per draft");
    };
    assert_eq!(prepared.visibility, SessionVisibility::Hidden);
    assert_eq!(prepared.source, SessionSource::Routine);
    assert_eq!(
        prepared.origin,
        trigger_context::TriggerOrigin::RoutineDraft { by: owner() }
    );
    assert_eq!(prepared.selection.bot_id, bot_id::MACRO_NEW_BOT_ID);
    assert_eq!(
        prepared.selection.model.as_deref(),
        Some("google/gemini-3.8-flash")
    );
    assert!(prepared.selection.mcp_servers.is_empty());
    let prompt = sessions.prompts.lock().unwrap()[0].clone();
    assert!(prompt.contains(BUG_REPORTS), "{prompt}");
    assert!(prompt.contains("macro.routines.check"), "{prompt}");
    assert!(prompt.contains("Never create"), "{prompt}");
    // The session and its row are gone once the draft is back.
    let session = prepared.session_id;
    assert_eq!(*sessions.deleted.lock().unwrap(), [session]);
    assert_eq!(*rows.finished.lock().unwrap(), [session.as_uuid()]);
    assert!(rows.drafts.lock().unwrap().is_empty());
}

/// The bug a large workspace hit: the web sent every channel and the
/// request was refused as too large. The request carries the description
/// and settings alone (lists older web builds still send are ignored); the
/// session finds the channel itself and the draft watches it.
#[tokio::test]
async fn a_large_workspace_drafts_the_channel_the_description_names() {
    let bug_reports = macro_uuid::generate_uuid_v7();
    let mut ranked: Vec<(String, Uuid)> = (0..5_000)
        .map(|index| (format!("channel-{index:04}"), macro_uuid::generate_uuid_v7()))
        .collect();
    ranked[4_000] = ("bug-reports".to_owned(), bug_reports);
    let channels = Arc::new(Channels {
        ranked,
        per_page: 50,
    });
    let found = Arc::clone(&channels);
    let rows = Arc::new(Rows::default());
    let sessions = Arc::new(Sessions::new(
        &rows,
        Box::new(move |_| {
            let (id, _) = found.find("bug-reports");
            vec![configuration(
                "Tasks from bug reports",
                message_posted(&[id.unwrap()]),
                json!([code_step("Make a task", "good")]),
            )]
        }),
    ));
    let drafts = drafts(&rows, &sessions);
    let workspace: Vec<Value> = channels
        .ranked
        .iter()
        .map(|(name, id)| json!({ "name": name, "id": id }))
        .collect();
    let context: DraftContext = serde_json::from_value(json!({
        "timezone": "America/New_York",
        "agentModel": "anthropic/claude-sonnet-5-5",
        "code": true,
        "conditions": true,
        "workspace": { "channels": workspace },
    }))
    .unwrap();

    let drafted = drafted_routine(drafts.draft(owner(), routine(BUG_REPORTS), context).await.unwrap());

    let Some(ActionTrigger::Events { filters }) = drafted.trigger else {
        panic!("expected an event trigger: {:?}", drafted.trigger);
    };
    assert_eq!(
        serde_json::to_value(&filters).unwrap()[0]["ids"],
        json!([bug_reports])
    );
    let prompt = sessions.prompts.lock().unwrap()[0].clone();
    assert!(!prompt.contains("channel-0001"), "the prompt carries no workspace");
}

/// Search ranks loose matches before the exact name, so the channel isn't
/// on its first page; the session pages on until it finds it.
#[tokio::test]
async fn a_channel_past_searchs_first_page_is_still_found() {
    let bug_reports = macro_uuid::generate_uuid_v7();
    let mut ranked: Vec<(String, Uuid)> = [
        "bug-reports-archive",
        "bug-reports-2025",
        "bug-reports-mobile",
        "bug-reports-web",
        "old-bug-reports",
        "bug-reports-triage",
    ]
    .into_iter()
    .map(|name| (name.to_owned(), macro_uuid::generate_uuid_v7()))
    .collect();
    ranked.push(("bug-reports".to_owned(), bug_reports));
    let channels = Arc::new(Channels { ranked, per_page: 5 });
    let (_, pages) = channels.find("bug-reports");
    assert_eq!(pages, 2, "the exact channel is outside the top five");
    let rows = Arc::new(Rows::default());
    let sessions = Arc::new(Sessions::new(
        &rows,
        Box::new(move |_| {
            let (id, _) = channels.find("bug-reports");
            vec![configuration(
                "Tasks from bug reports",
                message_posted(&[id.unwrap()]),
                json!([code_step("Make a task", "good")]),
            )]
        }),
    ));

    let drafted = drafted_routine(draft(&drafts(&rows, &sessions), routine(BUG_REPORTS)).await);

    let trigger = serde_json::to_value(drafted.trigger).unwrap();
    assert_eq!(trigger["filters"][0]["ids"], json!([bug_reports]));
}

#[tokio::test]
async fn code_still_failing_at_the_last_check_comes_back_on_its_step() {
    let rows = Arc::new(Rows::default());
    let sessions = Arc::new(Sessions::new(
        &rows,
        Box::new(|_| {
            vec![configuration(
                "Research and label",
                message_posted(&[]),
                json!([agent_step(), code_step("Label", "bad")]),
            )]
        }),
    ));

    let drafted = drafted_routine(draft(&drafts(&rows, &sessions), routine("label mail")).await);

    let [problem] = drafted.problems.as_slice() else {
        panic!("{:?}", drafted.problems);
    };
    // Its place among all the steps, not among code steps.
    assert_eq!(problem.index, 1);
    assert!(problem.problems[0].contains("TS2339"));
}

#[tokio::test]
async fn a_session_that_hands_nothing_back_says_the_draft_failed() {
    let rows = Arc::new(Rows::default());
    let sessions = Arc::new(Sessions::new(&rows, Box::new(|_| Vec::new())));

    assert_eq!(
        draft(&drafts(&rows, &sessions), routine("label mail")).await,
        failed(ROUTINE_FAILED)
    );
    assert_eq!(sessions.deleted.lock().unwrap().len(), 1);
}

#[tokio::test(start_paused = true)]
async fn a_draft_that_runs_out_of_time_says_so_and_cleans_up() {
    let rows = Arc::new(Rows::default());
    let mut sessions = Sessions::new(&rows, Box::new(|_| Vec::new()));
    sessions.hangs = true;
    let sessions = Arc::new(sessions);

    let draft = draft(&drafts(&rows, &sessions), routine("label mail")).await;

    assert_eq!(draft, failed(TIMED_OUT));
    let session = sessions.prepared.lock().unwrap()[0].session_id;
    assert_eq!(*sessions.cancelled.lock().unwrap(), [session]);
    assert_eq!(*sessions.deleted.lock().unwrap(), [session]);
    assert!(rows.drafts.lock().unwrap().is_empty());
}

#[tokio::test(start_paused = true)]
async fn a_check_handed_back_before_the_time_runs_out_is_kept() {
    let rows = Arc::new(Rows::default());
    let mut sessions = Sessions::new(
        &rows,
        Box::new(|_| {
            vec![configuration(
                "Bug tasks",
                message_posted(&[]),
                json!([code_step("Make a task", "good")]),
            )]
        }),
    );
    sessions.hangs = true;
    let sessions = Arc::new(sessions);

    let drafted = drafted_routine(draft(&drafts(&rows, &sessions), routine(BUG_REPORTS)).await);

    assert_eq!(drafted.name, "Bug tasks");
}

#[tokio::test]
async fn a_refused_admission_is_an_error_and_starts_no_session() {
    let rows = Arc::new(Rows::default());
    let sessions = Arc::new(Sessions::new(&rows, Box::new(|_| Vec::new())));
    let drafts = RoutineDrafts::new(
        Arc::new(Checker::default()),
        Arc::clone(&sessions),
        Arc::clone(&rows) as Arc<dyn DraftHandBacks>,
        Arc::new(Refused),
        agent(),
    );

    let error = drafts
        .draft(owner(), routine("label mail"), context())
        .await
        .unwrap_err();

    assert!(error.downcast_ref::<AiAdmissionError>().is_some());
    assert!(sessions.prepared.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_session_the_allowance_refuses_is_an_error_and_cleaned_up() {
    let rows = Arc::new(Rows::default());
    let mut sessions = Sessions::new(&rows, Box::new(|_| Vec::new()));
    sessions.refuses = Some(RoutineSessionError::Admission(AiAdmissionError::Unavailable));
    let sessions = Arc::new(sessions);

    let error = drafts(&rows, &sessions)
        .draft(owner(), routine("label mail"), context())
        .await
        .unwrap_err();

    assert!(error.downcast_ref::<AiAdmissionError>().is_some());
    assert!(rows.drafts.lock().unwrap().is_empty());
    assert_eq!(sessions.deleted.lock().unwrap().len(), 1);
}

fn add(description: &str, steps: Vec<Value>, kind: Option<StepKind>) -> DraftRequest {
    DraftRequest::AddStep {
        description: description.into(),
        routine: RoutineSoFar {
            trigger: Some(message_posted(&[])),
            steps,
        },
        kind,
    }
}

#[tokio::test]
async fn adds_the_step_the_session_checked_at_the_end() {
    let rows = Arc::new(Rows::default());
    let sessions = Arc::new(Sessions::new(
        &rows,
        Box::new(|prompt| {
            assert!(prompt.contains("Add ONE step at the end"), "{prompt}");
            vec![configuration(
                "Bug tasks",
                message_posted(&[]),
                json!([code_step("Make a task", "good"), code_step("Post it", "bad")]),
            )]
        }),
    ));

    let drafted = drafted_step(
        draft(
            &drafts(&rows, &sessions),
            add("post it", vec![code_step("Make a task", "good")], None),
        )
        .await,
    );

    assert_eq!(drafted.step["title"], "Post it");
    assert_eq!(drafted.step["id"], "post_it");
    assert_eq!(drafted.problems.len(), 1);
}

#[tokio::test]
async fn refuses_a_step_it_cannot_add() {
    let rows = Arc::new(Rows::default());
    let sessions = Arc::new(Sessions::new(&rows, Box::new(|_| Vec::new())));
    let drafts = drafts(&rows, &sessions);

    assert_eq!(
        draft(
            &drafts,
            add("research it", vec![agent_step()], Some(StepKind::Agent))
        )
        .await,
        failed(HAS_AGENT)
    );
    let no_code = DraftContext {
        code: false,
        ..context()
    };
    assert_eq!(
        drafts
            .draft(owner(), add("do it", Vec::new(), Some(StepKind::Code)), no_code)
            .await
            .unwrap(),
        failed(NO_CODE)
    );
    assert!(sessions.prepared.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_session_that_adds_the_wrong_kind_of_step_fails_the_draft() {
    let rows = Arc::new(Rows::default());
    let sessions = Arc::new(Sessions::new(
        &rows,
        Box::new(|_| {
            vec![configuration(
                "Bug tasks",
                message_posted(&[]),
                json!([code_step("Make a task", "good"), agent_step()]),
            )]
        }),
    ));

    assert_eq!(
        draft(
            &drafts(&rows, &sessions),
            add("post it", vec![code_step("Make a task", "good")], Some(StepKind::Code)),
        )
        .await,
        failed(STEP_FAILED)
    );
}

#[tokio::test]
async fn changes_a_code_step_in_place_keeping_its_output_name() {
    let rows = Arc::new(Rows::default());
    let sessions = Arc::new(Sessions::new(
        &rows,
        Box::new(|_| {
            vec![configuration(
                "Bug tasks",
                message_posted(&[]),
                json!([{ "type": "code", "id": "renamed", "title": "Make two tasks", "summary": "", "source": "good again" }]),
            )]
        }),
    ));
    let request = DraftRequest::ChangeStep {
        instruction: "make two".into(),
        routine: RoutineSoFar {
            trigger: None,
            steps: vec![json!({ "type": "code", "id": "make_a_task", "title": "Make a task", "summary": "", "source": "good" })],
        },
        index: 0,
    };

    let drafted = drafted_step(draft(&drafts(&rows, &sessions), request).await);

    assert_eq!(drafted.step["id"], "make_a_task");
    assert_eq!(drafted.step["source"], "good again");
}

#[tokio::test]
async fn refuses_requests_it_cannot_draft() {
    let rows = Arc::new(Rows::default());
    let sessions = Arc::new(Sessions::new(&rows, Box::new(|_| Vec::new())));
    let drafts = drafts(&rows, &sessions);
    for (request, context) in [
        (routine("  "), context()),
        (
            routine("label mail"),
            DraftContext {
                timezone: "Mars/Olympus".into(),
                ..context()
            },
        ),
        (
            DraftRequest::ChangeStep {
                instruction: "make two".into(),
                routine: RoutineSoFar {
                    trigger: None,
                    steps: vec![agent_step()],
                },
                index: 0,
            },
            context(),
        ),
    ] {
        let error = drafts.draft(owner(), request, context).await.unwrap_err();
        assert!(error.downcast_ref::<InvalidDraft>().is_some(), "{error}");
    }
    assert!(sessions.prepared.lock().unwrap().is_empty());
}

#[tokio::test]
async fn the_sweep_deletes_drafts_a_stopped_process_left_behind() {
    let rows = Arc::new(Rows::default());
    let sessions = Arc::new(Sessions::new(&rows, Box::new(|_| Vec::new())));
    let (old, new) = (macro_uuid::generate_uuid_v7(), macro_uuid::generate_uuid_v7());
    rows.begin(old, &owner(), bot_id::MACRO_NEW_BOT_ID).await.unwrap();
    rows.begin(new, &owner(), bot_id::MACRO_NEW_BOT_ID).await.unwrap();
    rows.drafts.lock().unwrap().get_mut(&old).unwrap().3 =
        Utc::now() - chrono::Duration::hours(1);

    assert_eq!(drafts(&rows, &sessions).sweep().await.unwrap(), 1);

    assert_eq!(
        *sessions.deleted.lock().unwrap(),
        [AgentSessionId::new_from_uuid(old)]
    );
    assert!(rows.drafts.lock().unwrap().contains_key(&new));
}
