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
    create(service, name, RunCaller::default(), None)
        .await
        .unwrap()
        .into_action()
}

async fn names(service: &TestService, scope: ListScope) -> Vec<String> {
    let listed = service.get_actions(user(), true, scope).await.unwrap();
    listed.into_iter().map(|listed| listed.action.name).collect()
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
    let service = TestService::new(
        Arc::clone(&repo),
        Arc::new(FakeExecutor::default()),
        tx,
        grants(&repo),
    )
    .with_run_sessions(Arc::new(OneSession(id(CORRELATION), id(PARENT_RUN))));
    let parent = top_level(&service, "parent").await;
    start_run(&service, &parent, PARENT_RUN);

    let from_session = RunCaller {
        routine: None,
        correlation: Some(id(CORRELATION)),
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
    let second = create(&service, "follow up, renamed", from_code(&parent), Some("task-1"))
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

    let refused = create(&service, "keyed", RunCaller::default(), Some("task-1")).await;

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
        .set_enabled(edit_receipt(off_by_hand.id.unwrap()), false)
        .await
        .unwrap();

    service
        .set_enabled(edit_receipt(parent.id.unwrap()), false)
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
        .update_action(edit_receipt(follows.id.unwrap()), renamed)
        .await
        .unwrap();

    service
        .set_enabled(edit_receipt(parent.id.unwrap()), true)
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
        .set_enabled(edit_receipt(parent.id.unwrap()), false)
        .await
        .unwrap();
    // Its owner ran it by hand while it was off.
    start_run(&service, &parent, PARENT_RUN);

    let child = create(&service, "child", from_code(&parent), None)
        .await
        .unwrap()
        .into_action();
    assert!(!child.enabled);

    service
        .set_enabled(edit_receipt(parent.id.unwrap()), true)
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
    assert_eq!(names(&service, ListScope::TopLevel).await, ["parent", "kept"]);
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
