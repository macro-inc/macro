use std::sync::{Arc, Mutex};

use serde_json::{Value, json};

use super::SUB_ROUTINES_OFF;
use crate::domain::drafts::test::{
    BUG_REPORTS, Recorded, Rows, Sessions, SubRoutinesFor, agent_step, code_step, configuration,
    context, draft, drafted_routine, drafted_step, drafts, message_posted, owner, plain, routine,
};
use crate::domain::drafts::{
    CHANGE_FAILED, Draft, DraftContext, DraftCreated, DraftRequest, ROUTINE_FAILED, RoutineSoFar,
    STEP_FAILED, StepKind,
};
use crate::domain::models::{ActionConfiguration, ActionPolicyError, CreatedItem};
use crate::domain::ports::RoutineDraftService;

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

/// A routine that schedules a reminder per task from its one code step,
/// defining the reminder once with `definition` as its steps.
fn schedules_reminders(definition: Value) -> ActionConfiguration {
    let mut routine = configuration(
        "Due reminders",
        message_posted(&[]),
        json!([code_step("Schedule reminders", "good")]),
    );
    routine.task["sub_routines"] = json!([{
        "name": "remind",
        "title": "Remind me about a task",
        "inputs": [{ "type": "text", "name": "taskId", "label": "Task" }],
        "steps": definition,
    }]);
    routine
}

#[tokio::test]
async fn a_drafted_routine_keeps_the_sub_routines_it_defines_and_where_their_code_fails() {
    let rows = Arc::new(Rows::default());
    let sessions = Arc::new(Sessions::new(
        &rows,
        Box::new(|_| {
            vec![plain(schedules_reminders(json!([
                code_step("Read the task", "bad"),
                agent_step()
            ])))]
        }),
    ));

    let drafted = drafted_routine(
        draft(
            &drafts(&rows, &sessions).with_sub_routines(Arc::new(SubRoutinesFor(true))),
            routine("remind me the day before each task is due"),
        )
        .await,
    );

    assert_eq!(drafted.steps.len(), 1);
    assert_eq!(drafted.sub_routines.len(), 1);
    assert_eq!(drafted.sub_routines[0]["name"], "remind");
    assert_eq!(
        drafted.sub_routines[0]["steps"].as_array().unwrap().len(),
        2
    );
    assert_eq!(drafted.problems.len(), 1);
    assert_eq!(drafted.problems[0].sub_routine.as_deref(), Some("remind"));
    assert_eq!(drafted.problems[0].index, 0);
    let wire = serde_json::to_value(&drafted).unwrap();
    assert_eq!(wire["subRoutines"][0]["name"], "remind");
    assert_eq!(wire["problems"][0]["subRoutine"], "remind");
}

/// The rollout refusing a draft's sub-routines when it is checked (turned
/// off, or unreadable) can't be fixed by its session, and saving it would
/// be refused, so the draft fails saying why instead of handing it back.
#[tokio::test]
async fn a_draft_whose_sub_routines_the_rollout_refused_fails_saying_so() {
    let rows = Arc::new(Rows::default());
    let mut sessions = Sessions::new(
        &rows,
        Box::new(|_| vec![plain(schedules_reminders(json!([agent_step()])))]),
    );
    sessions.problems = vec![ActionPolicyError::SubRoutinesDisabled.to_string()];
    let sessions = Arc::new(sessions);

    let draft = draft(
        &drafts(&rows, &sessions).with_sub_routines(Arc::new(SubRoutinesFor(true))),
        routine("remind me the day before each task is due"),
    )
    .await;

    let Draft::Failed { message, .. } = draft else {
        panic!("expected a failed draft, got {draft:?}");
    };
    assert_eq!(message, SUB_ROUTINES_OFF);
}

#[tokio::test]
async fn a_routine_without_sub_routines_is_drafted_as_before() {
    let rows = Arc::new(Rows::default());
    let sessions = Arc::new(Sessions::new(
        &rows,
        Box::new(|_| {
            vec![plain(configuration(
                "Bug tasks",
                message_posted(&[]),
                json!([code_step("Make a task", "bad")]),
            ))]
        }),
    ));

    let drafted = drafted_routine(draft(&drafts(&rows, &sessions), routine(BUG_REPORTS)).await);

    assert!(drafted.sub_routines.is_empty());
    let wire = serde_json::to_value(&drafted).unwrap();
    assert!(wire.get("subRoutines").is_none(), "{wire}");
    assert_eq!(
        wire["problems"],
        json!([{ "index": 0, "problems": drafted.problems[0].problems }])
    );
}

#[tokio::test]
async fn a_step_added_to_a_routine_with_sub_routines_is_checked_with_them() {
    let definition = json!([
        code_step("Read the task", "good"),
        code_step("Write the reminder", "bad")
    ]);
    let rows = Arc::new(Rows::default());
    let sessions = Arc::new(Sessions::new(&rows, {
        let definition = definition.clone();
        Box::new(move |prompt| {
            assert!(
                prompt.contains("Keep its sub-routines (`subRoutines`) exactly as they are too"),
                "{prompt}"
            );
            // Its data holds agents as stored; the SDK the session checks with takes a handle.
            assert!(
                prompt
                    .contains("`agent: { bot_id }` in them is `agent: macro.agents.byId(bot_id)`"),
                "{prompt}"
            );
            assert!(prompt.contains(r#""subRoutines":[{"#), "{prompt}");
            let mut routine = schedules_reminders(definition.clone());
            routine.task["steps"]
                .as_array_mut()
                .unwrap()
                .push(code_step("Post a summary", "good"));
            vec![plain(routine)]
        })
    }));
    let so_far = schedules_reminders(definition);
    let request = DraftRequest::AddStep {
        description: "then post a summary".into(),
        routine: RoutineSoFar {
            trigger: Some(message_posted(&[])),
            steps: so_far.task["steps"].as_array().unwrap().clone(),
            sub_routines: so_far.task["sub_routines"].as_array().unwrap().clone(),
        },
        kind: Some(StepKind::Code),
    };

    let drafted = drafted_step(draft(&drafts(&rows, &sessions), request).await);

    assert_eq!(drafted.step["title"], "Post a summary");
    // The sub-routine's step 1 fails, not the routine's step 1 just added.
    assert!(drafted.problems.is_empty(), "{:?}", drafted.problems);
}

/// Saving refuses sub-routines unless the owner may define them, and only a
/// draft that may write code schedules their copies: a session that defines
/// them anyway hands back no draft.
#[tokio::test]
async fn a_new_routine_never_hands_back_sub_routines_its_owner_may_not_save() {
    let definition = json!([code_step("Read the task", "good"), agent_step()]);
    // (owner may define them, code allowed, drafted)
    let cases = [
        (Some(true), true, true),
        (Some(false), true, false),
        (None, true, false),
        (Some(true), false, false),
    ];
    for (allowed, code, handed_back) in cases {
        let rows = Arc::new(Rows::default());
        let sessions = Arc::new(Sessions::new(&rows, {
            let definition = definition.clone();
            Box::new(move |_| vec![plain(schedules_reminders(definition.clone()))])
        }));
        let drafts = match allowed {
            Some(allowed) => {
                drafts(&rows, &sessions).with_sub_routines(Arc::new(SubRoutinesFor(allowed)))
            }
            None => drafts(&rows, &sessions),
        };

        let draft = drafts
            .draft(
                owner(),
                routine("remind me the day before each task is due"),
                DraftContext { code, ..context() },
            )
            .await
            .unwrap();

        match draft {
            Draft::Routine(drafted) => {
                assert!(handed_back, "allowed {allowed:?}, code {code}");
                assert_eq!(drafted.sub_routines.len(), 1);
            }
            Draft::Failed { message, .. } => {
                assert!(!handed_back, "allowed {allowed:?}, code {code}: {message}");
                assert_eq!(message, ROUTINE_FAILED);
            }
            other => panic!("expected a routine or a failure, got {other:?}"),
        }
    }
}

/// A step added or changed is applied to the routine as the editor holds
/// it, so one whose session checked it with other sub-routines (an input
/// renamed, a definition dropped) would not save there.
#[tokio::test]
async fn a_step_checked_with_other_sub_routines_than_the_routines_is_not_handed_back() {
    let definition = json!([code_step("Read the task", "good"), agent_step()]);
    let so_far = schedules_reminders(definition.clone());
    let so_far = RoutineSoFar {
        trigger: Some(message_posted(&[])),
        steps: so_far.task["steps"].as_array().unwrap().clone(),
        sub_routines: so_far.task["sub_routines"].as_array().unwrap().clone(),
    };
    let renamed = |mut routine: ActionConfiguration| {
        routine.task["sub_routines"][0]["inputs"][0]["name"] = json!("itemId");
        routine
    };
    let dropped = |mut routine: ActionConfiguration| {
        routine.task.as_object_mut().unwrap().remove("sub_routines");
        routine
    };
    let add = || DraftRequest::AddStep {
        description: "then post a summary".into(),
        routine: so_far.clone(),
        kind: Some(StepKind::Code),
    };
    let change = || DraftRequest::ChangeStep {
        instruction: "schedule them two days before".into(),
        routine: so_far.clone(),
        index: 0,
    };
    type Edit = fn(ActionConfiguration) -> ActionConfiguration;
    for (request, edit, message) in [
        (add(), renamed as Edit, STEP_FAILED),
        (add(), dropped as Edit, STEP_FAILED),
        (change(), renamed as Edit, CHANGE_FAILED),
        (change(), dropped as Edit, CHANGE_FAILED),
    ] {
        let rows = Arc::new(Rows::default());
        let sessions = Arc::new(Sessions::new(&rows, {
            let definition = definition.clone();
            Box::new(move |_| {
                let mut routine = schedules_reminders(definition.clone());
                routine.task["steps"]
                    .as_array_mut()
                    .unwrap()
                    .push(code_step("Post a summary", "good"));
                vec![plain(edit(routine))]
            })
        }));

        let draft = draft(&drafts(&rows, &sessions), request).await;

        let Draft::Failed { message: got, .. } = draft else {
            panic!("expected a failure, got {draft:?}");
        };
        assert_eq!(got, message);
    }
}

/// The SDK a session checks with can't hold a sub-routine's apps, and no
/// code reads them, so a step checked with the routine's sub-routines less
/// their apps is the step asked for.
#[tokio::test]
async fn a_step_checked_with_the_routines_sub_routines_less_their_apps_is_handed_back() {
    let definition = json!([code_step("Read the task", "good"), agent_step()]);
    let mut so_far = schedules_reminders(definition.clone());
    so_far.task["sub_routines"][0]["mcp_servers"] =
        json!([{ "app_slug": "linear", "server_name": "Linear" }]);
    let rows = Arc::new(Rows::default());
    let sessions = Arc::new(Sessions::new(
        &rows,
        Box::new(move |_| {
            let mut routine = schedules_reminders(definition.clone());
            routine.task["steps"]
                .as_array_mut()
                .unwrap()
                .push(code_step("Post a summary", "good"));
            vec![plain(routine)]
        }),
    ));
    let request = DraftRequest::AddStep {
        description: "then post a summary".into(),
        routine: RoutineSoFar {
            trigger: Some(message_posted(&[])),
            steps: so_far.task["steps"].as_array().unwrap().clone(),
            sub_routines: so_far.task["sub_routines"].as_array().unwrap().clone(),
        },
        kind: Some(StepKind::Code),
    };

    let drafted = drafted_step(draft(&drafts(&rows, &sessions), request).await);

    assert_eq!(drafted.step["title"], "Post a summary");
}

#[tokio::test]
async fn a_step_checked_with_the_routines_sub_routines_in_another_order_is_handed_back() {
    fn with_two() -> ActionConfiguration {
        let mut routine =
            schedules_reminders(json!([code_step("Read the task", "good"), agent_step()]));
        let mut check = routine.task["sub_routines"][0].clone();
        check["name"] = json!("check");
        check["title"] = json!("Check on a task");
        check["inputs"]
            .as_array_mut()
            .unwrap()
            .push(json!({ "type": "number", "name": "days", "label": "Days" }));
        routine.task["sub_routines"]
            .as_array_mut()
            .unwrap()
            .push(check);
        routine
    }
    let so_far = with_two();
    let rows = Arc::new(Rows::default());
    let sessions = Arc::new(Sessions::new(
        &rows,
        Box::new(|_| {
            // The session sent them back sorted, `check` before `remind`,
            // and `check`'s inputs sorted too.
            let mut routine = with_two();
            routine.task["sub_routines"]
                .as_array_mut()
                .unwrap()
                .reverse();
            routine.task["sub_routines"][0]["inputs"]
                .as_array_mut()
                .unwrap()
                .reverse();
            routine.task["steps"]
                .as_array_mut()
                .unwrap()
                .push(code_step("Post a summary", "good"));
            vec![plain(routine)]
        }),
    ));
    let request = DraftRequest::AddStep {
        description: "then post a summary".into(),
        routine: RoutineSoFar {
            trigger: Some(message_posted(&[])),
            steps: so_far.task["steps"].as_array().unwrap().clone(),
            sub_routines: so_far.task["sub_routines"].as_array().unwrap().clone(),
        },
        kind: Some(StepKind::Code),
    };

    let drafted = drafted_step(draft(&drafts(&rows, &sessions), request).await);

    assert_eq!(drafted.step["title"], "Post a summary");
}
