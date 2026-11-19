use super::*;
use crate::domain::ports::RequestSessions;

const PARENT_RUN: &str = "0199a000-0000-7000-8000-000000000001";
const CHILD_RUN: &str = "0199a000-0000-7000-8000-000000000002";
const CORRELATION: &str = "0199a000-0000-7000-8000-000000000003";

fn id(text: &str) -> Uuid {
    text.parse().unwrap()
}

/// `routine` has a run in progress whose id is `run`.
fn start_run(service: &TestService, routine: &ScheduledAction, run: &str) {
    service.repo.running.lock().unwrap().push(RunningRun {
        routine_id: routine.id.unwrap(),
        parent_id: routine.parent_id(),
        owner: routine.owner.clone(),
        run_id: id(run),
    });
}

fn from_code(routine: &ScheduledAction) -> RunCaller {
    RunCaller {
        routine: routine.id,
        correlation: None,
        requester: Requester::Program,
    }
}

async fn create(
    service: &TestService,
    name: &str,
    caller: RunCaller,
    key: Option<&str>,
) -> Result<SavedAction> {
    let input = ActionConfiguration {
        name: name.into(),
        ..configuration(false)
    };
    let key = key.map(|key| SubRoutineKey::new(key).unwrap());
    service
        .create_action_from(&user_principal(), input, caller, key)
        .await
}

async fn top_level(service: &TestService, name: &str) -> ScheduledAction {
    create(
        service,
        name,
        RunCaller {
            routine: None,
            correlation: None,
            requester: Requester::Person,
        },
        None,
    )
    .await
    .unwrap()
    .into_action()
}

async fn names(service: &TestService, scope: ListScope) -> Vec<String> {
    let listed = service.get_actions(user(), true, scope).await.unwrap();
    listed
        .into_iter()
        .map(|listed| listed.action.name)
        .collect()
}

fn stored(service: &TestService, id: Uuid) -> ScheduledAction {
    stored_actions(service)
        .into_iter()
        .find(|action| action.id == Some(id))
        .unwrap()
}

#[tokio::test]
async fn a_routine_a_run_creates_follows_the_running_routines_top_level_parent() {
    let service = service(false);
    let parent = top_level(&service, "parent").await;
    start_run(&service, &parent, PARENT_RUN);

    let child = create(&service, "child", from_code(&parent), None)
        .await
        .unwrap()
        .into_action();
    let link = child.sub_routine.clone().unwrap();
    assert_eq!(link.parent_id, parent.id.unwrap());
    assert_eq!(link.created_by_run_id, id(PARENT_RUN));

    // A sub-routine's own run creates a sibling, not a third level.
    start_run(&service, &child, CHILD_RUN);
    let grandchild = create(&service, "grandchild", from_code(&child), None)
        .await
        .unwrap()
        .into_action();
    let link = grandchild.sub_routine.unwrap();
    assert_eq!(link.parent_id, parent.id.unwrap());
    assert_eq!(link.created_by_run_id, id(CHILD_RUN));

    assert_eq!(names(&service, ListScope::TopLevel).await, ["parent"]);
    assert_eq!(
        names(&service, ListScope::ChildrenOf(parent.id.unwrap())).await,
        ["child", "grandchild"]
    );
    assert_eq!(
        names(&service, ListScope::WithChildren).await,
        ["parent", "child", "grandchild"]
    );
}

#[tokio::test]
async fn a_routine_whose_run_is_over_creates_top_level_routines() {
    let service = service(false);
    let parent = top_level(&service, "parent").await;

    // The credential still names the routine, but nothing is running.
    let created = create(&service, "later", from_code(&parent), None)
        .await
        .unwrap()
        .into_action();

    assert_eq!(created.sub_routine, None);
}

struct OneSession(Uuid, Uuid);

#[async_trait::async_trait]
impl RequestSessions for OneSession {
    async fn session_of(&self, correlation: Uuid) -> Result<Option<Uuid>> {
        Ok((correlation == self.0).then_some(self.1))
    }
}

#[tokio::test]
async fn an_agent_steps_session_creates_its_runs_sub_routines() {
    let repo = Arc::new(FakeRepo::default());
    let (tx, mut rx) = tokio::sync::mpsc::channel(32);
    tokio::spawn(async move { while rx.recv().await.is_some() {} });
    // A run's id is the id of the session its agent step opens.
    let service = ScheduledActionServiceImpl::new(
        Arc::clone(&repo),
        Arc::new(FakeExecutor::default()),
        tx,
        grants(&repo),
    )
    .with_event_routines(Rollout(Some(false)))
    .with_run_sessions(Arc::new(OneSession(id(CORRELATION), id(PARENT_RUN))));
    let parent = top_level(&service, "parent").await;
    start_run(&service, &parent, PARENT_RUN);

    let from_session = RunCaller {
        routine: None,
        correlation: Some(id(CORRELATION)),
        requester: Requester::Program,
    };
    let child = create(&service, "child", from_session, None)
        .await
        .unwrap()
        .into_action();
    assert_eq!(child.parent_id(), parent.id);

    // Another session of the same person is not the run's.
    let elsewhere = RunCaller {
        routine: None,
        correlation: Some(id(CHILD_RUN)),
        requester: Requester::Program,
    };
    let own = create(&service, "own", elsewhere, None)
        .await
        .unwrap()
        .into_action();
    assert_eq!(own.sub_routine, None);
}

#[tokio::test]
async fn the_same_key_updates_the_sub_routine_instead_of_adding_another() {
    let service = service(false);
    let parent = top_level(&service, "parent").await;
    start_run(&service, &parent, PARENT_RUN);

    let first = create(&service, "follow up", from_code(&parent), Some("task-1"))
        .await
        .unwrap();
    let second = create(
        &service,
        "follow up, renamed",
        from_code(&parent),
        Some("task-1"),
    )
    .await
    .unwrap();
    let other = create(&service, "another", from_code(&parent), Some("task-2"))
        .await
        .unwrap();

    assert!(matches!(first, SavedAction::Created(_)));
    assert!(matches!(other, SavedAction::Created(_)));
    let SavedAction::Updated(updated) = second else {
        panic!("the second create under one key must update");
    };
    assert_eq!(updated.id, first.into_action().id);
    assert_eq!(
        names(&service, ListScope::ChildrenOf(parent.id.unwrap())).await,
        ["follow up, renamed", "another"]
    );
}

#[tokio::test]
async fn a_key_outside_a_routines_run_is_refused() {
    let service = service(false);

    let refused = create(
        &service,
        "keyed",
        RunCaller {
            routine: None,
            correlation: None,
            requester: Requester::Person,
        },
        Some("task-1"),
    )
    .await;

    assert_policy(refused, ActionPolicyError::KeyOutsideRun);
    assert!(stored_actions(&service).is_empty());
}

#[tokio::test]
async fn sub_routines_pause_with_their_parent_and_only_those_resume_with_it() {
    let service = service(false);
    let parent = top_level(&service, "parent").await;
    start_run(&service, &parent, PARENT_RUN);
    let follows = create(&service, "follows", from_code(&parent), None)
        .await
        .unwrap()
        .into_action();
    let off_by_hand = create(&service, "off by hand", from_code(&parent), None)
        .await
        .unwrap()
        .into_action();
    service
        .set_enabled(
            edit_receipt(off_by_hand.id.unwrap()),
            false,
            Requester::Person,
        )
        .await
        .unwrap();

    service
        .set_enabled(edit_receipt(parent.id.unwrap()), false, Requester::Person)
        .await
        .unwrap();
    let paused = stored(&service, follows.id.unwrap());
    assert!(!paused.enabled);
    assert!(paused.sub_routine.unwrap().paused_by_parent);
    assert!(
        !stored(&service, off_by_hand.id.unwrap())
            .sub_routine
            .unwrap()
            .paused_by_parent
    );

    // An edit while it is off keeps it following its parent.
    let mut renamed = update(configuration(false));
    renamed.name = "follows, renamed".into();
    renamed.enabled = None;
    service
        .update_action(
            edit_receipt(follows.id.unwrap()),
            renamed,
            Requester::Person,
        )
        .await
        .unwrap();

    service
        .set_enabled(edit_receipt(parent.id.unwrap()), true, Requester::Person)
        .await
        .unwrap();
    let resumed = stored(&service, follows.id.unwrap());
    assert!(resumed.enabled);
    assert!(!resumed.sub_routine.unwrap().paused_by_parent);
    assert!(!stored(&service, off_by_hand.id.unwrap()).enabled);
}

#[tokio::test]
async fn a_run_of_a_paused_routine_creates_sub_routines_that_wait_for_it() {
    let service = service(false);
    let parent = top_level(&service, "parent").await;
    service
        .set_enabled(edit_receipt(parent.id.unwrap()), false, Requester::Person)
        .await
        .unwrap();
    // Its owner ran it by hand while it was off.
    start_run(&service, &parent, PARENT_RUN);

    let child = create(&service, "child", from_code(&parent), Some("task-1"))
        .await
        .unwrap()
        .into_action();
    assert!(!child.enabled);
    // Creating it again under its key updates it, still off with its parent.
    let again = create(
        &service,
        "child, renamed",
        from_code(&parent),
        Some("task-1"),
    )
    .await
    .unwrap()
    .into_action();
    assert_eq!(again.id, child.id);
    assert!(!again.enabled);
    assert!(again.sub_routine.unwrap().paused_by_parent);

    service
        .set_enabled(edit_receipt(parent.id.unwrap()), true, Requester::Person)
        .await
        .unwrap();
    assert!(stored(&service, child.id.unwrap()).enabled);
}

#[tokio::test]
async fn deleting_a_routine_deletes_its_sub_routines_but_not_one_kept_as_the_owners() {
    let service = service(false);
    let parent = top_level(&service, "parent").await;
    start_run(&service, &parent, PARENT_RUN);
    create(&service, "child", from_code(&parent), Some("kept-key"))
        .await
        .unwrap();
    let kept = create(&service, "kept", from_code(&parent), None)
        .await
        .unwrap()
        .into_action();

    let detached = service
        .detach_action(edit_receipt(kept.id.unwrap()))
        .await
        .unwrap();
    assert_eq!(detached.sub_routine, None);
    assert_eq!(
        names(&service, ListScope::TopLevel).await,
        ["parent", "kept"]
    );
    // It is top-level now, so there is nothing left to detach.
    assert_policy(
        service.detach_action(edit_receipt(kept.id.unwrap())).await,
        ActionPolicyError::NotSubRoutine,
    );

    service
        .delete_action(owner_receipt(parent.id.unwrap()))
        .await
        .unwrap();
    assert_eq!(names(&service, ListScope::WithChildren).await, ["kept"]);
}

#[tokio::test]
async fn a_routines_history_names_what_each_run_created() {
    let service = service(false);
    let parent = top_level(&service, "parent").await;
    start_run(&service, &parent, PARENT_RUN);
    let child = create(&service, "child", from_code(&parent), None)
        .await
        .unwrap()
        .into_action();
    let run = |run: &str, at: i64| ActionExecutionRecord {
        id: Some(id(run)),
        action_id: parent.id.unwrap(),
        resource_id: None,
        start_time: at_time(at),
        end_time: at_time(at),
        is_success: true,
        result: serde_json::Value::Null,
        created_at: at_time(at),
    };
    *service.repo.records.lock().unwrap() = vec![run(PARENT_RUN, 1), run(CHILD_RUN, 2)];

    let history = service
        .get_execution_records(view_receipt(parent.id.unwrap()))
        .await
        .unwrap();

    let created: Vec<(Uuid, Vec<Uuid>)> = history
        .into_iter()
        .map(|run| {
            let created = run.created.into_iter().map(|routine| routine.id).collect();
            (run.record.id.unwrap(), created)
        })
        .collect();
    assert_eq!(
        created,
        [
            (id(PARENT_RUN), vec![child.id.unwrap()]),
            (id(CHILD_RUN), vec![]),
        ]
    );
}

fn at_time(seconds: i64) -> DateTime<Utc> {
    DateTime::from_timestamp(1_800_000_000 + seconds, 0).unwrap()
}

#[tokio::test]
async fn a_parents_list_holds_every_trigger_type_without_asking_for_events() {
    let service = service(true);
    let parent = top_level(&service, "parent").await;
    start_run(&service, &parent, PARENT_RUN);
    let on_events = ActionConfiguration {
        name: "on events".into(),
        ..configuration(true)
    };
    service
        .create_action_from(&user_principal(), on_events, from_code(&parent), None)
        .await
        .unwrap();

    let children = service
        .get_actions(user(), false, ListScope::ChildrenOf(parent.id.unwrap()))
        .await
        .unwrap();
    let with_children = service
        .get_actions(user(), false, ListScope::WithChildren)
        .await
        .unwrap();

    assert_eq!(children.len(), 1);
    assert_eq!(with_children.len(), 2);
}

#[tokio::test]
async fn a_keyed_create_under_a_paused_parent_marks_a_sub_routine_that_was_off_by_hand() {
    let service = service(false);
    let parent = top_level(&service, "parent").await;
    start_run(&service, &parent, PARENT_RUN);
    let child = create(&service, "child", from_code(&parent), Some("task-1"))
        .await
        .unwrap()
        .into_action();
    service
        .set_enabled(edit_receipt(child.id.unwrap()), false, Requester::Person)
        .await
        .unwrap();
    service
        .set_enabled(edit_receipt(parent.id.unwrap()), false, Requester::Person)
        .await
        .unwrap();

    // The run asks for it on again, unchanged, while its parent is off.
    create(&service, "child", from_code(&parent), Some("task-1"))
        .await
        .unwrap();
    let held = stored(&service, child.id.unwrap());
    assert!(!held.enabled);
    assert!(held.sub_routine.unwrap().paused_by_parent);

    service
        .set_enabled(edit_receipt(parent.id.unwrap()), true, Requester::Person)
        .await
        .unwrap();
    assert!(stored(&service, child.id.unwrap()).enabled);
}

/// A routine that lists what is due and defines one reminder, scheduled
/// once per task.
fn reminders_task(reminder: &str) -> serde_json::Value {
    json!({
        "steps": [{ "type": "agent", "model": "model", "instructions": "List what is due" }],
        "sub_routines": [{
            "name": "remind",
            "title": "Remind me about a task",
            "inputs": [{ "type": "text", "name": "task", "label": "Task" }],
            "steps": [{ "type": "agent", "model": "model", "instructions": reminder }],
        }],
    })
}

async fn reminders(service: &TestService) -> ScheduledAction {
    let input = ActionConfiguration {
        name: "Due reminders".into(),
        task: reminders_task("Remind me"),
        ..configuration(false)
    };
    service
        .create_action(&user_principal(), input)
        .await
        .unwrap()
}

fn remind(task: &str, key: Option<&str>) -> ScheduleSubRoutine {
    ScheduleSubRoutine {
        sub_routine: "remind".into(),
        trigger: serde_json::from_value(json!({ "type": "once", "at": "2030-01-01T09:00:00Z" }))
            .unwrap(),
        inputs: json!({ "task": task }).as_object().unwrap().clone(),
        name: None,
        key: key.map(Into::into),
    }
}

async fn schedule(
    service: &TestService,
    request: ScheduleSubRoutine,
    caller: RunCaller,
) -> Result<SavedAction> {
    service
        .schedule_sub_routine(&user_principal(), request, caller)
        .await
}

/// The program a stored copy runs now.
fn runs(service: &TestService, copy: &ScheduledAction) -> RoutineProgram {
    let mut handle = ExecutionHandle::default();
    handle.parent = Some(stored(service, copy.parent_id().unwrap()));
    handle.program(copy).unwrap()
}

fn agent_instructions(program: &RoutineProgram) -> &str {
    let routine_program::Step::Agent(step) = &program.steps[0] else {
        panic!("the definition's agent step");
    };
    &step.instructions
}

#[tokio::test]
async fn a_run_schedules_copies_of_its_routines_sub_routine_that_hold_only_a_trigger_and_inputs() {
    let service = service(true);
    let parent = reminders(&service).await;
    start_run(&service, &parent, PARENT_RUN);

    let SavedAction::Created(copy) = schedule(
        &service,
        remind("Ship the release", Some("task-1")),
        from_code(&parent),
    )
    .await
    .unwrap() else {
        panic!("the first schedule creates the copy");
    };
    assert_eq!(copy.parent_id(), parent.id);
    assert_eq!(copy.name, "Remind me about a task");
    assert_eq!(
        copy.task,
        json!({ "sub_routine": "remind", "inputs": { "task": "Ship the release" } })
    );
    assert_eq!(copy.trigger, remind("", None).trigger);

    // Scheduling the same key again changes that copy's inputs.
    let SavedAction::Updated(updated) = schedule(
        &service,
        remind("Ship the hotfix", Some("task-1")),
        from_code(&parent),
    )
    .await
    .unwrap() else {
        panic!("the same key updates the copy");
    };
    assert_eq!(updated.id, copy.id);
    assert_eq!(updated.task["inputs"]["task"], "Ship the hotfix");

    // A copy's own run schedules its parent's sub-routines, as a sibling.
    start_run(&service, &updated, CHILD_RUN);
    let sibling = schedule(&service, remind("Write notes", None), from_code(&updated))
        .await
        .unwrap()
        .into_action();
    assert_eq!(sibling.parent_id(), parent.id);
    assert_eq!(
        names(&service, ListScope::ChildrenOf(parent.id.unwrap())).await,
        ["Remind me about a task", "Remind me about a task"]
    );
}

#[tokio::test]
async fn scheduling_needs_a_run_a_defined_name_and_inputs_that_fit() {
    let service = service(true);
    let parent = reminders(&service).await;

    let person = RunCaller {
        routine: None,
        correlation: None,
        requester: Requester::Person,
    };
    assert_policy(
        schedule(&service, remind("Ship", None), person).await,
        ActionPolicyError::ScheduleOutsideRun,
    );
    // The credential names the routine, but nothing is running.
    assert_policy(
        schedule(&service, remind("Ship", None), from_code(&parent)).await,
        ActionPolicyError::ScheduleOutsideRun,
    );

    start_run(&service, &parent, PARENT_RUN);
    let mut unknown = remind("Ship", None);
    unknown.sub_routine = "follow_up".into();
    assert_policy(
        schedule(&service, unknown, from_code(&parent)).await,
        ActionPolicyError::UnknownSubRoutine("follow_up".into()),
    );
    let mut missing = remind("Ship", None);
    missing.inputs.clear();
    assert_policy(
        schedule(&service, missing, from_code(&parent)).await,
        ActionPolicyError::SubRoutineInputs("input `task` needs a value".into()),
    );
    let mut wrong = remind("Ship", None);
    wrong.inputs.insert("task".into(), json!(7));
    assert_policy(
        schedule(&service, wrong, from_code(&parent)).await,
        ActionPolicyError::SubRoutineInputs("input `task` takes a string".into()),
    );
    assert_eq!(stored_actions(&service).len(), 1);
}

#[tokio::test]
async fn an_edit_to_the_definition_reaches_the_copies_that_have_not_run() {
    let service = service(true);
    let parent = reminders(&service).await;
    start_run(&service, &parent, PARENT_RUN);
    let copy = schedule(
        &service,
        remind("Ship the release", None),
        from_code(&parent),
    )
    .await
    .unwrap()
    .into_action();

    let program = runs(&service, &copy);
    assert_eq!(agent_instructions(&program), "Remind me");
    assert_eq!(
        program.input_values(),
        *json!({ "task": "Ship the release" }).as_object().unwrap()
    );

    let mut edit = configuration(false);
    edit.name = "Due reminders".into();
    edit.task = reminders_task("Remind me, and say how late it is");
    service
        .update_action(
            edit_receipt(parent.id.unwrap()),
            update(edit),
            Requester::Person,
        )
        .await
        .unwrap();

    // The copy is stored as it was, and runs the edited definition.
    assert_eq!(stored(&service, copy.id.unwrap()).task, copy.task);
    assert_eq!(
        agent_instructions(&runs(&service, &copy)),
        "Remind me, and say how late it is"
    );
}

#[tokio::test]
async fn a_copys_steps_change_only_in_its_parent_and_copies_are_made_only_by_scheduling() {
    let service = service(true);
    let parent = reminders(&service).await;
    start_run(&service, &parent, PARENT_RUN);
    let copy = schedule(&service, remind("Ship", None), from_code(&parent))
        .await
        .unwrap()
        .into_action();

    // Renamed, it stays a copy.
    let mut renamed = configuration(false);
    renamed.name = "Ship reminder".into();
    renamed.task = copy.task.clone();
    let saved = service
        .update_action(
            edit_receipt(copy.id.unwrap()),
            update(renamed.clone()),
            Requester::Person,
        )
        .await
        .unwrap();
    assert_eq!(saved.name, "Ship reminder");
    assert_eq!(saved.task, copy.task);

    let mut rewritten = renamed;
    rewritten.task =
        json!({ "steps": [{ "type": "agent", "model": "model", "instructions": "Other" }] });
    assert_policy(
        service
            .update_action(
                edit_receipt(copy.id.unwrap()),
                update(rewritten),
                Requester::Person,
            )
            .await,
        ActionPolicyError::CopyTaskFixed,
    );

    let mut forged = configuration(false);
    forged.task = copy.task.clone();
    assert_policy(
        service
            .create_action(&user_principal(), forged.clone())
            .await,
        ActionPolicyError::CopyOutsideRun,
    );
    assert_policy(
        service
            .create_action_from(&user_principal(), forged, from_code(&parent), None)
            .await,
        ActionPolicyError::CopyOutsideRun,
    );
    assert_eq!(stored_actions(&service).len(), 2);
}

#[tokio::test]
async fn sub_routines_and_inputs_wait_for_the_owners_rollout() {
    let service = service(false);
    let input = ActionConfiguration {
        task: reminders_task("Remind me"),
        ..configuration(false)
    };
    assert_policy(
        service.create_action(&user_principal(), input).await,
        ActionPolicyError::SubRoutinesDisabled,
    );
    let created = top_level(&service, "plain").await;
    let mut edit = configuration(false);
    edit.task = json!({
        "steps": [{ "type": "agent", "model": "model", "instructions": "Hi" }],
        "inputs": [{ "type": "text", "name": "task", "label": "Task", "value": "Ship" }],
    });
    assert_policy(
        service
            .update_action(
                edit_receipt(created.id.unwrap()),
                update(edit),
                Requester::Person,
            )
            .await,
        ActionPolicyError::SubRoutinesDisabled,
    );
}

#[tokio::test]
async fn an_update_that_would_drop_the_definitions_is_refused() {
    let service = service(true);
    let parent = reminders(&service).await;
    let mut stale = configuration(false);
    stale.task =
        json!({ "steps": [{ "type": "agent", "model": "model", "instructions": "List" }] });
    let error = service
        .update_action(
            edit_receipt(parent.id.unwrap()),
            update(stale),
            Requester::Person,
        )
        .await
        .unwrap_err();
    assert_eq!(
        error.downcast_ref(),
        Some(&TargetValidationError::ExplicitSubRoutinesRequired)
    );
}

#[tokio::test]
async fn detaching_a_copy_keeps_the_steps_it_ran_with_its_inputs() {
    let service = service(true);
    let parent = reminders(&service).await;
    start_run(&service, &parent, PARENT_RUN);
    let copy = schedule(&service, remind("Ship", None), from_code(&parent))
        .await
        .unwrap()
        .into_action();

    let detached = service
        .detach_action(edit_receipt(copy.id.unwrap()))
        .await
        .unwrap();

    assert_eq!(detached.sub_routine, None);
    let program = RoutineProgram::from_task(&detached.task).unwrap();
    assert_eq!(agent_instructions(&program), "Remind me");
    assert_eq!(
        program.input_values(),
        *json!({ "task": "Ship" }).as_object().unwrap()
    );
    assert_eq!(stored(&service, copy.id.unwrap()).task, detached.task);
}
