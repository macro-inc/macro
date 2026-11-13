use std::collections::HashMap;
use std::sync::Mutex;

use agent_session::domain::routines::{
    PreparedRoutineSession, RoutinePendingReason, RoutinePromptAccepted, ValidatedRoutineSession,
};
use ai_billing::AiAdmissionError;
use chrono::DateTime;
use serde_json::json;

use super::*;
use crate::domain::code_check::{self, test::Checker};
use crate::domain::models::{ActionConfiguration, ActionKind, CreatedItem};
use crate::domain::ports::{HandedBack, StaleDraft};
use macro_uuid::Uuid;

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
    async fn begin(
        &self,
        session: Uuid,
        owner: &MacroUserIdStr<'static>,
        agent: BotId,
    ) -> Result<()> {
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
        created: &[CreatedItem],
    ) -> Result<bool> {
        let mut drafts = self.drafts.lock().unwrap();
        let Some((started_by, _, handed_back, _)) = drafts.get_mut(&session) else {
            return Ok(false);
        };
        if started_by != owner {
            return Ok(false);
        }
        handed_back.check = Some(check.clone());
        if check.ok {
            handed_back.passed = Some(check.clone());
        }
        handed_back.checks += 1;
        for item in created {
            if !handed_back.created.contains(item) {
                handed_back.created.push(item.clone());
            }
        }
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
/// in order, written from the prompt, each with what it says it created.
type Turn = Box<dyn Fn(&str) -> Vec<(ActionConfiguration, Vec<CreatedItem>)> + Send + Sync>;

/// The routine sessions a draft opens: preparing and prompting are
/// recorded, and the prompt's turn checks its routines into `rows` as the
/// check route would, then ends, unless the session `hangs`. Its turn
/// can't be read while it is `unreadable`.
struct Sessions {
    rows: Arc<Rows>,
    code: Arc<Checker>,
    turn: Turn,
    hangs: bool,
    unreadable: bool,
    refuses: Option<RoutineSessionError>,
    prepared: Mutex<Vec<PrepareRoutineSession>>,
    prompts: Mutex<Vec<String>>,
    cancelled: Mutex<Vec<AgentSessionId>>,
    deleted: Mutex<Vec<AgentSessionId>>,
    /// Signalled on each delete.
    deletes: tokio::sync::Notify,
}

impl Sessions {
    fn new(rows: &Arc<Rows>, turn: Turn) -> Self {
        Self {
            rows: Arc::clone(rows),
            code: Arc::new(Checker::default()),
            turn,
            hangs: false,
            unreadable: false,
            refuses: None,
            prepared: Mutex::new(Vec::new()),
            prompts: Mutex::new(Vec::new()),
            cancelled: Mutex::new(Vec::new()),
            deleted: Mutex::new(Vec::new()),
            deletes: tokio::sync::Notify::new(),
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
        for (routine, created) in (self.turn)(&command.prompt) {
            let check = checked(self.code.as_ref(), routine).await;
            self.rows
                .record(
                    command.action.session_id.as_uuid(),
                    &command.action.owner,
                    &check,
                    &created,
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
        if self.unreadable {
            return Err(RoutineSessionError::OperationFailed);
        }
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

    async fn delete(&self, command: RoutineSessionAction) -> Result<(), RoutineSessionError> {
        self.deleted.lock().unwrap().push(command.session_id);
        self.deletes.notify_one();
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

/// Stands in for `routine_program::WRITING`.
const GUIDE: &str = "Find the item whose name is exactly the name used.";

fn agent() -> DraftAgent {
    DraftAgent {
        bot: bot_id::MACRO_NEW_BOT_ID,
        guide: GUIDE,
    }
}

/// What the sessions' programs created, as their activity records it.
#[derive(Default)]
struct Recorded(Mutex<Vec<CreatedItem>>);

#[async_trait::async_trait]
impl SessionCreations for Recorded {
    async fn created_by(&self, _session: Uuid) -> Result<Vec<CreatedItem>> {
        Ok(self.0.lock().unwrap().clone())
    }
}

fn drafts(rows: &Arc<Rows>, sessions: &Arc<Sessions>) -> RoutineDrafts<Checker, Sessions> {
    RoutineDrafts::new(
        Arc::new(Checker::default()),
        Arc::clone(sessions),
        Arc::clone(rows) as Arc<dyn DraftHandBacks>,
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

/// A check that created nothing.
fn plain(routine: ActionConfiguration) -> (ActionConfiguration, Vec<CreatedItem>) {
    (routine, Vec::new())
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
                plain(configuration(
                    "Bug tasks",
                    message_posted(&[]),
                    json!([code_step("Make a task", "bad")]),
                )),
                // ...so it fixes the code and checks the finished routine.
                plain(configuration(
                    " Bug tasks ",
                    message_posted(&[]),
                    json!([code_step("Make a task", "good")]),
                )),
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
    // The person's own session, never a routine's run, billed as their
    // agent session usage.
    assert_eq!(prepared.source, SessionSource::User);
    assert_eq!(
        prepared.billing,
        agent_session::domain::model::SessionBilling::Billable
    );
    assert_eq!(
        prepared.origin,
        trigger_context::TriggerOrigin::Requested { by: owner() }
    );
    assert_eq!(prepared.selection.bot_id, bot_id::MACRO_NEW_BOT_ID);
    assert_eq!(
        prepared.selection.model.as_deref(),
        // The model the person's Ask AI steps run on, which their plan allows.
        Some("anthropic/claude-sonnet-5-5")
    );
    assert!(prepared.selection.mcp_servers.is_empty());
    let prompt = sessions.prompts.lock().unwrap()[0].clone();
    assert!(prompt.contains(BUG_REPORTS), "{prompt}");
    assert!(prompt.contains("macro.routines.check"), "{prompt}");
    // The rules every session follows, read from one place, plus drafting's.
    assert!(
        prompt.contains(&format!("<writing-routines>\n{GUIDE}\n</writing-routines>")),
        "{prompt}"
    );
    assert!(prompt.contains("You can't ask them anything"), "{prompt}");
    // The writing text leaves out how the SDK spells a filter's items, and
    // what to create beforehand; drafting says both.
    assert!(prompt.contains(super::FILTER_ITEMS), "{prompt}");
    assert!(prompt.contains("Create nothing else."), "{prompt}");
    // Macro's code routines are its worked examples.
    let inbox = routine_program::CATALOG
        .iter()
        .find(|routine| routine.key == "inbox")
        .unwrap();
    assert!(
        prompt.contains(&format!("<request>{}</request>", inbox.request)),
        "{prompt}"
    );
    assert!(drafted.created.is_empty());
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
        .map(|index| {
            (
                format!("channel-{index:04}"),
                macro_uuid::generate_uuid_v7(),
            )
        })
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
            vec![plain(configuration(
                "Tasks from bug reports",
                message_posted(&[id.unwrap()]),
                json!([code_step("Make a task", "good")]),
            ))]
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

    let drafted = drafted_routine(
        drafts
            .draft(owner(), routine(BUG_REPORTS), context)
            .await
            .unwrap(),
    );

    let Some(ActionTrigger::Events { filters }) = drafted.trigger else {
        panic!("expected an event trigger: {:?}", drafted.trigger);
    };
    assert_eq!(
        serde_json::to_value(&filters).unwrap()[0]["ids"],
        json!([bug_reports])
    );
    let prompt = sessions.prompts.lock().unwrap()[0].clone();
    assert!(
        !prompt.contains("channel-0001"),
        "the prompt carries no workspace"
    );
    // An item no name matches exactly is left for them to pick.
    assert!(prompt.contains("leave it out (no `entities`"), "{prompt}");
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
    let channels = Arc::new(Channels {
        ranked,
        per_page: 5,
    });
    let (_, pages) = channels.find("bug-reports");
    assert_eq!(pages, 2, "the exact channel is outside the top five");
    let rows = Arc::new(Rows::default());
    let sessions = Arc::new(Sessions::new(
        &rows,
        Box::new(move |_| {
            let (id, _) = channels.find("bug-reports");
            vec![plain(configuration(
                "Tasks from bug reports",
                message_posted(&[id.unwrap()]),
                json!([code_step("Make a task", "good")]),
            ))]
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
            vec![plain(configuration(
                "Research and label",
                message_posted(&[]),
                json!([agent_step(), code_step("Label", "bad")]),
            ))]
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

/// The first check that passes is the draft: the session is stopped there,
/// without waiting for its turn to end.
#[tokio::test(start_paused = true)]
async fn a_draft_stops_its_session_once_a_check_passes() {
    let rows = Arc::new(Rows::default());
    let mut sessions = Sessions::new(
        &rows,
        Box::new(|_| {
            vec![plain(configuration(
                "Bug tasks",
                message_posted(&[]),
                json!([code_step("Make a task", "good")]),
            ))]
        }),
    );
    sessions.hangs = true;
    let sessions = Arc::new(sessions);

    let started = tokio::time::Instant::now();
    let drafted = drafted_routine(draft(&drafts(&rows, &sessions), routine(BUG_REPORTS)).await);

    assert_eq!(drafted.name, "Bug tasks");
    // One poll, then the settle for activity.
    assert!(
        started.elapsed() <= POLL + ACTIVITY_SETTLE,
        "{:?}",
        started.elapsed()
    );
    assert_eq!(sessions.cancelled.lock().unwrap().len(), 1);
}

/// A turn that can't be read a few times in a row ends the draft as failed,
/// well before its timeout, and still cleans up.
#[tokio::test(start_paused = true)]
async fn a_draft_whose_turn_cannot_be_read_gives_up_and_cleans_up() {
    let rows = Arc::new(Rows::default());
    let mut sessions = Sessions::new(&rows, Box::new(|_| Vec::new()));
    sessions.hangs = true;
    sessions.unreadable = true;
    let sessions = Arc::new(sessions);

    let started = tokio::time::Instant::now();
    let draft = draft(&drafts(&rows, &sessions), routine("label mail")).await;

    assert_eq!(draft, failed(ROUTINE_FAILED));
    assert!(
        started.elapsed() < DRAFT_TIMEOUT / 4,
        "{:?}",
        started.elapsed()
    );
    let session = sessions.prepared.lock().unwrap()[0].session_id;
    assert_eq!(*sessions.cancelled.lock().unwrap(), [session]);
    assert_eq!(*sessions.deleted.lock().unwrap(), [session]);
    assert!(rows.drafts.lock().unwrap().is_empty());
}

/// A passing check is the draft even while the turn can't be read.
#[tokio::test(start_paused = true)]
async fn a_passing_check_is_drafted_while_the_turn_cannot_be_read() {
    let rows = Arc::new(Rows::default());
    let mut sessions = Sessions::new(
        &rows,
        Box::new(|_| {
            vec![plain(configuration(
                "Bug tasks",
                message_posted(&[]),
                json!([code_step("Make a task", "good")]),
            ))]
        }),
    );
    sessions.hangs = true;
    sessions.unreadable = true;
    let sessions = Arc::new(sessions);

    let drafted = drafted_routine(draft(&drafts(&rows, &sessions), routine(BUG_REPORTS)).await);

    assert_eq!(drafted.name, "Bug tasks");
    assert_eq!(sessions.deleted.lock().unwrap().len(), 1);
}

/// A check that still fails isn't the end: the session goes on fixing it.
#[tokio::test(start_paused = true)]
async fn a_failing_check_keeps_the_draft_waiting_for_the_turn() {
    let rows = Arc::new(Rows::default());
    let mut sessions = Sessions::new(
        &rows,
        Box::new(|_| {
            vec![plain(configuration(
                "Bug tasks",
                message_posted(&[]),
                json!([code_step("Make a task", "bad")]),
            ))]
        }),
    );
    sessions.hangs = true;
    let sessions = Arc::new(sessions);

    let started = tokio::time::Instant::now();
    let drafted = drafted_routine(draft(&drafts(&rows, &sessions), routine(BUG_REPORTS)).await);

    // Its last check comes back with its problems once the time runs out.
    assert!(started.elapsed() >= DRAFT_TIMEOUT);
    assert_eq!(drafted.problems.len(), 1);
}

#[tokio::test]
async fn a_session_the_allowance_refuses_is_an_error_and_cleaned_up() {
    let rows = Arc::new(Rows::default());
    let mut sessions = Sessions::new(&rows, Box::new(|_| Vec::new()));
    sessions.refuses = Some(RoutineSessionError::Admission(
        AiAdmissionError::Unavailable,
    ));
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
            vec![plain(configuration(
                "Bug tasks",
                message_posted(&[]),
                json!([
                    code_step("Make a task", "good"),
                    code_step("Post it", "bad")
                ]),
            ))]
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
            .draft(
                owner(),
                add("do it", Vec::new(), Some(StepKind::Code)),
                no_code
            )
            .await
            .unwrap(),
        failed(NO_CODE)
    );
    assert!(sessions.prepared.lock().unwrap().is_empty());
}

/// Where code can't be saved, the brief shows no code to copy.
#[tokio::test]
async fn without_code_the_brief_has_no_code_examples() {
    let rows = Arc::new(Rows::default());
    let sessions = Arc::new(Sessions::new(&rows, Box::new(|_| Vec::new())));
    let no_code = DraftContext {
        code: false,
        ..context()
    };
    drafts(&rows, &sessions)
        .draft(owner(), routine("every morning sort my inbox"), no_code)
        .await
        .unwrap();
    let prompt = sessions.prompts.lock().unwrap()[0].clone();
    assert!(prompt.contains("Code steps can't be used"), "{prompt}");
    assert!(!prompt.contains("<example>"), "{prompt}");
}

#[tokio::test]
async fn without_conditions_no_example_trigger_asks_one() {
    for (conditions, asked) in [(false, false), (true, true)] {
        let rows = Arc::new(Rows::default());
        let sessions = Arc::new(Sessions::new(&rows, Box::new(|_| Vec::new())));
        let context = DraftContext {
            conditions,
            ..context()
        };
        drafts(&rows, &sessions)
            .draft(owner(), routine("every morning sort my inbox"), context)
            .await
            .unwrap();
        let prompt = sessions.prompts.lock().unwrap()[0].clone();
        assert!(prompt.contains("<example>"), "{prompt}");
        assert_eq!(prompt.contains("\"condition\":"), asked, "{prompt}");
    }
}

#[tokio::test]
async fn a_session_that_adds_the_wrong_kind_of_step_fails_the_draft() {
    let rows = Arc::new(Rows::default());
    let sessions = Arc::new(Sessions::new(
        &rows,
        Box::new(|_| {
            vec![plain(configuration(
                "Bug tasks",
                message_posted(&[]),
                json!([code_step("Make a task", "good"), agent_step()]),
            ))]
        }),
    ));

    assert_eq!(
        draft(
            &drafts(&rows, &sessions),
            add(
                "post it",
                vec![code_step("Make a task", "good")],
                Some(StepKind::Code)
            ),
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
            vec![plain(configuration(
                "Bug tasks",
                message_posted(&[]),
                json!([{ "type": "code", "id": "renamed", "title": "Make two tasks", "summary": "", "source": "good again" }]),
            ))]
        }),
    ));
    let request = DraftRequest::ChangeStep {
        instruction: "make two".into(),
        routine: RoutineSoFar {
            trigger: None,
            steps: vec![
                json!({ "type": "code", "id": "make_a_task", "title": "Make a task", "summary": "", "source": "good" }),
            ],
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
    let (old, new) = (
        macro_uuid::generate_uuid_v7(),
        macro_uuid::generate_uuid_v7(),
    );
    rows.begin(old, &owner(), bot_id::MACRO_NEW_BOT_ID)
        .await
        .unwrap();
    rows.begin(new, &owner(), bot_id::MACRO_NEW_BOT_ID)
        .await
        .unwrap();
    rows.drafts.lock().unwrap().get_mut(&old).unwrap().3 = Utc::now() - chrono::Duration::hours(1);

    assert_eq!(drafts(&rows, &sessions).sweep().await.unwrap(), 1);

    assert_eq!(
        *sessions.deleted.lock().unwrap(),
        [AgentSessionId::new_from_uuid(old)]
    );
    assert!(rows.drafts.lock().unwrap().contains_key(&new));
}

/// A routine that writes to a database the words ask for: the session makes
/// the database, uses its id, and says it made it, so the review can show it.
#[tokio::test]
async fn a_draft_that_needs_a_new_database_creates_it_references_it_and_says_so() {
    let database = macro_uuid::generate_uuid_v7().to_string();
    let made = database.clone();
    let rows = Arc::new(Rows::default());
    let sessions = Arc::new(Sessions::new(
        &rows,
        Box::new(move |_| {
            let created = vec![CreatedItem {
                entity_type: model_entity::EntityType::Database,
                entity_id: made.clone(),
            }];
            let source = format!(
                "export async function main({{ macro, trigger }}) {{ await macro.databases.byId('{made}').addRow({{ title: trigger.subject }}); }}"
            );
            vec![
                (
                    configuration(
                        "Log bug reports",
                        message_posted(&[]),
                        json!([code_step("Add a row", "bad")]),
                    ),
                    created.clone(),
                ),
                (
                    configuration(
                        "Log bug reports",
                        message_posted(&[]),
                        json!([code_step("Add a row", &source)]),
                    ),
                    created,
                ),
            ]
        }),
    ));

    let drafted = drafted_routine(
        draft(
            &drafts(&rows, &sessions),
            routine("log every message in bug-reports to a new database called Bug log"),
        )
        .await,
    );

    assert_eq!(
        drafted.created,
        [DraftCreated {
            entity_type: model_entity::EntityType::Database,
            entity_id: database.clone(),
            used: true,
        }]
    );
    assert!(
        drafted.steps[0]["source"]
            .as_str()
            .unwrap()
            .contains(&database)
    );
}

/// The routine's own work happens when it runs: a weekly task is drafted,
/// not made. The brief says so, and nothing comes back as created.
#[tokio::test]
async fn a_weekly_task_draft_creates_no_task() {
    let rows = Arc::new(Rows::default());
    let sessions = Arc::new(Sessions::new(
        &rows,
        Box::new(|prompt| {
            // The guide says so; the brief carries it.
            assert!(prompt.contains(GUIDE), "{prompt}");
            vec![plain(configuration(
                "Monday task",
                json!({ "type": "cron", "schedule": "0 0 9 * * MON", "timezone": "America/New_York" }),
                json!([code_step("Make the task", "good")]),
            ))]
        }),
    ));

    let drafted = drafted_routine(
        draft(
            &drafts(&rows, &sessions),
            routine("make a task every Monday"),
        )
        .await,
    );

    assert!(drafted.created.is_empty());
    assert_eq!(drafted.steps[0]["title"], "Make the task");
}

/// A request dropped mid-draft still stops and deletes its session.
#[tokio::test(start_paused = true)]
async fn a_dropped_draft_request_still_cleans_up_its_session() {
    let rows = Arc::new(Rows::default());
    let mut sessions = Sessions::new(&rows, Box::new(|_| Vec::new()));
    sessions.hangs = true;
    let sessions = Arc::new(sessions);
    let drafts = drafts(&rows, &sessions);

    let request = drafts.draft(owner(), routine("label mail"), context());
    // The person leaves after ten seconds.
    assert!(
        tokio::time::timeout(Duration::from_secs(10), request)
            .await
            .is_err()
    );
    // The cleanup runs on its own task.
    sessions.deletes.notified().await;

    let session = sessions.prepared.lock().unwrap()[0].session_id;
    assert_eq!(*sessions.cancelled.lock().unwrap(), [session]);
    assert_eq!(*sessions.deleted.lock().unwrap(), [session]);
    assert!(rows.drafts.lock().unwrap().is_empty());
}

/// After a passing check the session may try something that fails, and may
/// create something more. The draft keeps the passing routine and lists
/// everything it created.
#[tokio::test(start_paused = true)]
async fn a_failing_check_after_a_passing_one_never_replaces_it() {
    let rows = Arc::new(Rows::default());
    let database = CreatedItem {
        entity_type: model_entity::EntityType::Database,
        entity_id: "bug-log".into(),
    };
    let folder = CreatedItem {
        entity_type: model_entity::EntityType::Project,
        entity_id: "bug-reports-folder".into(),
    };
    let (made_database, made_folder) = (database.clone(), folder.clone());
    let mut sessions = Sessions::new(
        &rows,
        Box::new(move |_| {
            vec![
                (
                    configuration(
                        "Log bug reports",
                        message_posted(&[]),
                        json!([code_step("Add a row", "good")]),
                    ),
                    vec![made_database.clone()],
                ),
                (
                    configuration(
                        "Log and file bug reports",
                        message_posted(&[]),
                        json!([code_step("Add a row", "good"), code_step("File it", "bad")]),
                    ),
                    vec![made_folder.clone()],
                ),
            ]
        }),
    );
    sessions.hangs = true;
    let sessions = Arc::new(sessions);

    let drafted = drafted_routine(
        draft(
            &drafts(&rows, &sessions),
            routine("log bug reports in a new database"),
        )
        .await,
    );

    assert_eq!(drafted.name, "Log bug reports");
    assert!(drafted.problems.is_empty());
    assert_eq!(drafted.steps.len(), 1);
    // The folder came with a check that failed, so the routine handed back
    // doesn't use it, and the review says so.
    assert_eq!(
        drafted.created,
        [
            DraftCreated {
                entity_type: database.entity_type,
                entity_id: database.entity_id,
                used: false,
            },
            DraftCreated {
                entity_type: folder.entity_type,
                entity_id: folder.entity_id,
                used: false,
            },
        ]
    );
}

/// The session does the routine's work now (makes today's task) and never
/// says so in a check. Its recorded activity still shows the task, marked
/// as not used by the routine, for the review to point out.
#[tokio::test(start_paused = true)]
async fn an_item_the_session_never_named_is_shown_and_marked_unused() {
    let rows = Arc::new(Rows::default());
    let database = CreatedItem {
        entity_type: model_entity::EntityType::Database,
        entity_id: "bug-log".into(),
    };
    let task = CreatedItem {
        entity_type: model_entity::EntityType::Document,
        entity_id: "todays-task".into(),
    };
    let named = database.clone();
    let sessions = Arc::new(Sessions::new(
        &rows,
        Box::new(move |_| {
            vec![(
                configuration(
                    "Monday task",
                    json!({ "type": "cron", "schedule": "0 0 9 * * MON", "timezone": "America/New_York" }),
                    json!([code_step(
                        "Make the task",
                        "export async function main() { /* writes to bug-log */ }"
                    )]),
                ),
                vec![named.clone()],
            )]
        }),
    ));
    // Its activity has the database (also named) and the task (never named).
    let recorded = Arc::new(Recorded(Mutex::new(vec![database.clone(), task.clone()])));
    let drafts = drafts(&rows, &sessions).with_session_creations(recorded);

    let drafted = drafted_routine(draft(&drafts, routine("make a task every Monday")).await);

    assert_eq!(
        drafted.created,
        [
            DraftCreated {
                entity_type: database.entity_type,
                entity_id: database.entity_id,
                used: true,
            },
            DraftCreated {
                entity_type: task.entity_type,
                entity_id: task.entity_id,
                used: false,
            },
        ]
    );
}

/// What the session made before a draft failed is still reported.
#[tokio::test(start_paused = true)]
async fn a_failed_draft_still_says_what_its_session_created() {
    let rows = Arc::new(Rows::default());
    let sessions = Arc::new(Sessions::new(&rows, Box::new(|_| Vec::new())));
    let task = CreatedItem {
        entity_type: model_entity::EntityType::Document,
        entity_id: "todays-task".into(),
    };
    let drafts = drafts(&rows, &sessions)
        .with_session_creations(Arc::new(Recorded(Mutex::new(vec![task.clone()]))));

    let Draft::Failed { message, created } = draft(&drafts, routine("label mail")).await else {
        panic!("expected a failed draft");
    };

    assert_eq!(message, ROUTINE_FAILED);
    assert_eq!(
        created,
        [DraftCreated {
            entity_type: task.entity_type,
            entity_id: task.entity_id,
            used: false,
        }]
    );
}
