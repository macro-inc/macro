//! Tasks saved with fields their kind doesn't read.

use super::*;

/// Older builds kept fields a single agent doesn't read, and clients send a
/// task back as they loaded it, or rebuilt from the fields they know. One
/// stored with fields only a task with steps or a copy keeps still runs, is
/// renamed, paused and resumed either way, and loses them once its task
/// changes; a new task with them, such as a template's, saves without them.
#[tokio::test]
async fn a_single_agent_stored_with_stray_fields_is_saved_without_them() {
    let svc = service(true);
    let id = svc
        .create_action(&user_principal(), configuration(false))
        .await
        .unwrap()
        .id
        .unwrap();
    let agent = json!({
        "model": "model",
        "prompt": "summarize",
        "user_prompt": "task",
    });
    let mut stored = agent.clone();
    stored["inputs"] = json!([{ "type": "text", "name": "taskId", "label": "Task" }]);
    stored["sub_routine"] = json!("remind");
    svc.repo.actions.lock().unwrap()[0].task = stored.clone();
    let update = |name: &str, task: &serde_json::Value| {
        serde_json::from_value::<ActionConfigurationUpdate>(json!({
            "name": name,
            "kind": "Agent",
            "trigger": {"type": "cron", "schedule": "0 0 9 * * *", "timezone": "UTC"},
            "task": task,
        }))
        .unwrap()
    };

    // Sent back as loaded, or rebuilt without them: the task is unchanged.
    for (name, task) in [("echoed", &stored), ("rebuilt", &agent)] {
        let renamed = svc
            .update_action(edit_receipt(id), update(name, task), Requester::Person)
            .await
            .unwrap();
        assert_eq!(renamed.name, name);
        assert_eq!(renamed.task, stored);
        // Still the agent it was: no copy.
        assert!(
            RoutineProgram::from_task(&renamed.task)
                .unwrap()
                .leading_agent()
                .is_some()
        );
    }
    // Empty lists the same way: a rename keeps the row as it was.
    let mut empty = agent.clone();
    empty["inputs"] = json!([]);
    empty["sub_routines"] = json!([]);
    svc.repo.actions.lock().unwrap()[0].task = empty.clone();
    for (name, task) in [("empty echoed", &empty), ("empty rebuilt", &agent)] {
        let renamed = svc
            .update_action(edit_receipt(id), update(name, task), Requester::Person)
            .await
            .unwrap();
        assert_eq!(renamed.task, empty, "{name}");
    }
    svc.repo.actions.lock().unwrap()[0].task = stored.clone();
    svc.set_enabled(edit_receipt(id), false, Requester::Person)
        .await
        .unwrap();
    let resumed = svc
        .set_enabled(edit_receipt(id), true, Requester::Person)
        .await
        .unwrap();
    assert!(resumed.enabled);

    let mut changed = stored.clone();
    changed["user_prompt"] = json!("another task");
    let edited = svc
        .update_action(
            edit_receipt(id),
            update("edited", &changed),
            Requester::Person,
        )
        .await
        .unwrap();
    let mut expected = agent.clone();
    expected["user_prompt"] = json!("another task");
    assert_eq!(edited.task, expected);

    let mut config = configuration(false);
    config.task = stored;
    let created = svc.create_action(&user_principal(), config).await.unwrap();
    assert_eq!(created.task, agent);
}
