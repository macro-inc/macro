use super::*;

const PARENT_RUN: &str = "0199a000-0000-7000-8000-000000000001";
const CHILD_RUN: &str = "0199a000-0000-7000-8000-000000000002";

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
        session: None,
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
            session: None,
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
    .with_event_routines(Rollout(Some(false)));
    let parent = top_level(&service, "parent").await;
    start_run(&service, &parent, PARENT_RUN);

    let from_session = RunCaller {
        routine: None,
        session: Some(id(PARENT_RUN)),
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
        session: Some(id(CHILD_RUN)),
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
            session: None,
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
        session: None,
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
    // Even a name that fits is the caller's text, which errors are logged
    // with: not repeated.
    assert_eq!(
        schedule(&service, unknown, from_code(&parent))
            .await
            .unwrap_err()
            .to_string(),
        "the routine that is running defines no sub-routine by that name"
    );
    // A name no definition could have is the caller's text: not repeated.
    let mut odd = remind("Ship", None);
    odd.sub_routine = "someone@example.com".into();
    assert_policy(
        schedule(&service, odd, from_code(&parent)).await,
        ActionPolicyError::InvalidSubRoutineName,
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

/// Postgres can't store a NUL in text, and its refusal would be a server
/// error quoting the text: a key or name holding one is refused first.
#[tokio::test]
async fn a_scheduled_key_or_name_holding_a_nul_is_refused_before_the_write() {
    let service = service(true);
    let parent = reminders(&service).await;
    start_run(&service, &parent, PARENT_RUN);

    let nul_key = remind("Ship", Some("ship\u{0}it"));
    assert_policy(
        schedule(&service, nul_key, from_code(&parent)).await,
        ActionPolicyError::InvalidKey,
    );
    let mut nul_name = remind("Ship", None);
    nul_name.name = Some("Ship\u{0}it".into());
    assert_eq!(
        schedule(&service, nul_name, from_code(&parent))
            .await
            .unwrap_err()
            .to_string(),
        "a scheduled sub-routine's name can't hold a NUL character"
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
async fn with_the_rollout_off_runs_schedule_nothing_and_a_copy_can_still_stand_alone() {
    let service = service(false);
    // A parent and a keyed copy saved while the rollout was on.
    let parent_id = top_level(&service, "Due reminders").await.id.unwrap();
    let copy_id = top_level(&service, "Ship").await.id.unwrap();
    for action in service.repo.actions.lock().unwrap().iter_mut() {
        if action.id == Some(parent_id) {
            action.task = reminders_task("Remind me");
        } else if action.id == Some(copy_id) {
            action.task = json!({ "sub_routine": "remind", "inputs": { "task": "Ship" } });
            action.sub_routine = Some(SubRoutine {
                parent_id,
                created_by_run_id: id(PARENT_RUN),
                key: Some(SubRoutineKey::new("task-1").unwrap()),
                paused_by_parent: false,
            });
        }
    }
    let parent = stored(&service, parent_id);
    start_run(&service, &parent, PARENT_RUN);
    let before = stored(&service, copy_id);

    // Moving the copy under its key, even with the same inputs.
    let mut again = remind("Ship", Some("task-1"));
    again.trigger =
        serde_json::from_value(json!({ "type": "once", "at": "2031-01-01T09:00:00Z" })).unwrap();
    assert_policy(
        schedule(&service, again, from_code(&parent)).await,
        ActionPolicyError::SubRoutinesDisabled,
    );
    assert_eq!(stored(&service, copy_id).next_run_at, before.next_run_at);

    // Its owner can still make it a routine of its own.
    let detached = service.detach_action(edit_receipt(copy_id)).await.unwrap();
    assert_eq!(detached.sub_routine, None);
    assert_eq!(
        agent_instructions(&RoutineProgram::from_task(&detached.task).unwrap()),
        "Remind me"
    );
}

/// Each read of the rollout asks the flag service over the network.
#[tokio::test]
async fn scheduling_reads_the_owners_rollout_once_whether_it_creates_or_moves_a_copy() {
    use crate::domain::event_runs::test_support::SUB_ROUTINE_FLAG_READS;
    let service = service(true);
    let parent = reminders(&service).await;
    start_run(&service, &parent, PARENT_RUN);
    let reads = |request: ScheduleSubRoutine| {
        let service = Arc::clone(&service);
        let caller = from_code(&parent);
        SUB_ROUTINE_FLAG_READS.scope(std::cell::Cell::new(0), async move {
            schedule(&service, request, caller).await.unwrap();
            SUB_ROUTINE_FLAG_READS.with(std::cell::Cell::get)
        })
    };

    assert_eq!(reads(remind("Ship", Some("task-1"))).await, 1);
    // Under its key with other inputs.
    assert_eq!(reads(remind("Ship v2", Some("task-1"))).await, 1);
    assert_eq!(stored_actions(&service).len(), 2);
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

/// A routine's steps: one agent step, with `extra` fields beside them.
fn steps_task(extra: serde_json::Value) -> serde_json::Value {
    let mut task = json!({
        "steps": [{ "type": "agent", "model": "model", "instructions": "Follow up" }],
    });
    if let (Some(task), Some(extra)) = (task.as_object_mut(), extra.as_object()) {
        task.extend(extra.clone());
    }
    task
}

#[tokio::test]
async fn copies_and_inputs_wait_for_the_rollout_on_every_write() {
    let service = service(false);
    // A parent that defined its sub-routine while the rollout was on.
    let parent_id = top_level(&service, "Due reminders").await.id.unwrap();
    service
        .repo
        .actions
        .lock()
        .unwrap()
        .iter_mut()
        .find(|action| action.id == Some(parent_id))
        .unwrap()
        .task = reminders_task("Remind me");
    let parent = stored(&service, parent_id);
    start_run(&service, &parent, PARENT_RUN);

    assert_policy(
        schedule(&service, remind("Ship", Some("task-1")), from_code(&parent)).await,
        ActionPolicyError::SubRoutinesDisabled,
    );

    // A run's keyed create again, now holding inputs.
    let principal = user_principal();
    let keyed = |task: serde_json::Value| {
        let input = ActionConfiguration {
            name: "Follow up".into(),
            task,
            ..configuration(false)
        };
        service.create_action_from(
            &principal,
            input,
            from_code(&parent),
            Some(SubRoutineKey::new("follow-up").unwrap()),
        )
    };
    let child = keyed(steps_task(json!({}))).await.unwrap().into_action();
    let inputs =
        json!({ "inputs": [{ "type": "text", "name": "task", "label": "Task", "value": "Ship" }] });
    assert_policy(
        keyed(steps_task(inputs)).await,
        ActionPolicyError::SubRoutinesDisabled,
    );
    assert_eq!(stored(&service, child.id.unwrap()).task, child.task);

    // None of either is stored as none, which a build from before them reads.
    let input = ActionConfiguration {
        task: steps_task(json!({ "sub_routines": [], "inputs": [] })),
        ..configuration(false)
    };
    let saved = service
        .create_action(&user_principal(), input)
        .await
        .unwrap();
    assert_eq!(saved.task, steps_task(json!({})));
}

#[tokio::test]
async fn a_routine_becomes_a_copy_only_by_scheduling_and_a_child_defines_no_sub_routines() {
    let service = service(true);
    let parent = reminders(&service).await;
    start_run(&service, &parent, PARENT_RUN);
    let copy = schedule(&service, remind("Ship", None), from_code(&parent))
        .await
        .unwrap()
        .into_action();
    let child = create(&service, "Follow up", from_code(&parent), None)
        .await
        .unwrap()
        .into_action();
    let edit = |task: serde_json::Value| {
        let mut input = configuration(false);
        input.name = "Follow up".into();
        input.task = task;
        service.update_action(
            edit_receipt(child.id.unwrap()),
            update(input),
            Requester::Person,
        )
    };

    assert_policy(
        edit(copy.task.clone()).await,
        ActionPolicyError::CopyTaskFixed,
    );
    // Its parent's sub-routines are the ones it schedules.
    assert_policy(
        edit(reminders_task("Nested")).await,
        ActionPolicyError::NestedSubRoutines,
    );
    let nested = ActionConfiguration {
        name: "Nested".into(),
        task: reminders_task("Nested"),
        ..configuration(false)
    };
    assert_policy(
        service
            .create_action_from(&user_principal(), nested.clone(), from_code(&parent), None)
            .await,
        ActionPolicyError::NestedSubRoutines,
    );
    let key = SubRoutineKey::new("follow-up").unwrap();
    let keyed = ActionConfiguration {
        task: steps_task(json!({})),
        ..nested.clone()
    };
    service
        .create_action_from(
            &user_principal(),
            keyed,
            from_code(&parent),
            Some(key.clone()),
        )
        .await
        .unwrap();
    assert_policy(
        service
            .create_action_from(&user_principal(), nested, from_code(&parent), Some(key))
            .await,
        ActionPolicyError::NestedSubRoutines,
    );
    assert_eq!(stored(&service, child.id.unwrap()).task, child.task);
}

#[tokio::test]
async fn a_copys_agents_are_authorized_with_its_parent_not_again_for_each_copy() {
    let base = service(true);
    let sessions = Arc::new(Sessions::default());
    let service = ScheduledActionServiceImpl::new(
        base.repo.clone(),
        base.executor.clone(),
        base.dispatcher_tx.clone(),
        grants(&base.repo),
    )
    .with_event_routines(Rollout(Some(true)))
    .with_target_validation(TargetValidation::new(sessions.clone()));
    let input = ActionConfiguration {
        name: "Due reminders".into(),
        task: reminders_task("Remind me"),
        ..configuration(false)
    };
    let parent = service
        .create_action(&user_principal(), input)
        .await
        .unwrap();
    start_run(&base, &parent, PARENT_RUN);

    // Validating a copy's agents would fail now; scheduling it asks nothing.
    *sessions.error.lock().unwrap() = Some(RoutineSessionError::Forbidden);
    let copy = service
        .schedule_sub_routine(&user_principal(), remind("Ship", None), from_code(&parent))
        .await
        .unwrap()
        .into_action();
    assert_eq!(copy.parent_id(), parent.id);
}

#[tokio::test]
async fn a_copy_never_writes_as_its_owner_though_its_parent_does() {
    let service = service(true);
    let parent = reminders(&service).await;
    // Only a person makes a routine write as them.
    let mut as_owner = configuration(false);
    as_owner.name = "Due reminders".into();
    as_owner.task = reminders_task("Remind me");
    as_owner.task["dangerously_operate_as_user"] = json!(true);
    let parent = service
        .update_action(
            edit_receipt(parent.id.unwrap()),
            update(as_owner),
            Requester::Person,
        )
        .await
        .unwrap();
    start_run(&service, &parent, PARENT_RUN);
    let copy = schedule(&service, remind("Ship", None), from_code(&parent))
        .await
        .unwrap()
        .into_action();
    assert!(!runs(&service, &copy).dangerously_operate_as_user);

    // Kept as the owner's own routine, it still doesn't, until they say so.
    let detached = service
        .detach_action(edit_receipt(copy.id.unwrap()))
        .await
        .unwrap();
    assert!(
        !RoutineProgram::from_task(&detached.task)
            .unwrap()
            .dangerously_operate_as_user
    );
}

/// Code Macro rewrote in a definition, unreviewed, stays off the owner's
/// identity in a copy made standalone: detaching keeps the sources the copy
/// holds, apart from its own upgrades, and switching it to write as its
/// owner is refused until that code changes.
#[tokio::test]
async fn a_copy_made_standalone_keeps_its_parents_rewritten_code_off_its_owners_identity() {
    let repo = Arc::clone(&service(true).repo);
    let with = |upgrades: Rewritten| {
        let (tx, mut rx) = tokio::sync::mpsc::channel(32);
        tokio::spawn(async move { while rx.recv().await.is_some() {} });
        ScheduledActionServiceImpl::new(
            Arc::clone(&repo),
            Arc::new(FakeExecutor::default()),
            tx,
            grants(&repo),
        )
        .with_event_routines(Rollout(Some(true)))
        .with_code(
            Arc::new(crate::domain::code_check::test::Checker::default()),
            Arc::new(upgrades),
        )
    };
    let rewritten = "export async function main() { /* rewritten */ }";
    let mut task = reminders_task("Remind me");
    task["sub_routines"][0]["steps"] =
        json!([{ "type": "code", "title": "Remind", "source": rewritten }]);
    let parent = with(Rewritten::default())
        .create_action(
            &user_principal(),
            ActionConfiguration {
                name: "Due reminders".into(),
                task,
                ..configuration(false)
            },
        )
        .await
        .unwrap();
    let parent_id = parent.id.unwrap();
    repo.running.lock().unwrap().push(RunningRun {
        routine_id: parent_id,
        parent_id: None,
        owner: parent.owner.clone(),
        run_id: id(PARENT_RUN),
    });

    // Macro rewrote the parent's definition.
    let rewrote = with(Rewritten {
        task: parent.task.clone(),
        of: Some(parent_id),
        ..Default::default()
    });
    let copy_id = rewrote
        .schedule_sub_routine(&user_principal(), remind("Ship", None), from_code(&parent))
        .await
        .unwrap()
        .into_action()
        .id
        .unwrap();
    let detached = rewrote.detach_action(edit_receipt(copy_id)).await.unwrap();
    assert_eq!(
        *repo.inherited.lock().unwrap(),
        [(copy_id, vec![rewritten.to_owned()])]
    );

    // It has no upgrades of its own; what detach kept for it refuses its
    // owner's identity.
    let kept = with(Rewritten {
        of: Some(parent_id),
        inherited: repo.inherited.lock().unwrap().clone(),
        ..Default::default()
    });
    let mut as_owner = ActionConfiguration {
        name: detached.name.clone(),
        trigger: detached.trigger.clone(),
        kind: detached.kind.clone(),
        task: detached.task.clone(),
        enabled: detached.enabled,
        run_visibility: detached.run_visibility,
        description: detached.description.clone(),
    };
    as_owner.task["dangerously_operate_as_user"] = json!(true);
    assert_policy(
        kept.update_action(
            edit_receipt(copy_id),
            update(as_owner.clone()),
            Requester::Person,
        )
        .await,
        ActionPolicyError::UnreviewedRewrite,
    );
    // Changed in its steps and in the definition it kept from its parent.
    let reviewed = json!("export async function main() { /* reviewed */ }");
    as_owner.task["steps"][0]["source"] = reviewed.clone();
    as_owner.task["sub_routines"][0]["steps"][0]["source"] = reviewed;
    let saved = kept
        .update_action(edit_receipt(copy_id), update(as_owner), Requester::Person)
        .await
        .unwrap();
    assert_eq!(saved.task["dangerously_operate_as_user"], true);
}
