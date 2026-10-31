use super::*;
use chrono::TimeZone;
#[test]
fn once_has_exactly_one_future_firing_and_normalizes_offsets() {
    let now = Utc.with_ymd_and_hms(2026, 10, 2, 0, 0, 0).unwrap();
    let schedule: RoutineSchedule = serde_json::from_value(
        serde_json::json!({"type":"once", "at":"2026-10-03T09:15:00-04:00"}),
    )
    .unwrap();
    let trigger = schedule.cron(now).unwrap();
    assert_eq!(trigger.1, "UTC");
    let cron = trigger.0.parse::<cron::Schedule>().unwrap();
    let runs: Vec<_> = cron.after(&now).take(2).collect();
    assert_eq!(
        runs,
        vec![Utc.with_ymd_and_hms(2026, 10, 3, 13, 15, 0).unwrap()]
    );
    assert!(schedule.cron(runs[0]).is_err());
}
#[test]
fn recurring_schedules_validate_timezone_and_future_runs() {
    let now = Utc::now();
    assert!(
        RoutineSchedule::Cron {
            expression: "0 0 9 * * MON-FRI".into(),
            timezone: "America/New_York".into()
        }
        .cron(now)
        .is_ok()
    );
    assert!(
        RoutineSchedule::Cron {
            expression: "0 0 9 * * *".into(),
            timezone: "imaginary".into()
        }
        .cron(now)
        .is_err()
    );
    assert!(
        RoutineSchedule::Cron {
            expression: "0 0 9 1 1 * 2000".into(),
            timezone: "UTC".into()
        }
        .cron(now)
        .is_err()
    );
}

#[test]
fn single_agent_input_from_before_steps_becomes_one_agent_step() {
    let configuration = deserialize_configuration(serde_json::json!({
        "name": "Morning brief",
        "instructions": "Sum up my day",
        "target": { "type": "model", "model": "claude" },
        "schedule": { "type": "cron", "expression": "0 0 9 * * 2-6", "timezone": "UTC" },
    }))
    .unwrap();
    // A lone agent is stored as the single agent task every scheduler reads.
    assert_eq!(
        configuration.task(None),
        serde_json::json!({
            "model": "claude", "mcp_servers": [], "prompt": "", "user_prompt": "Sum up my day"
        })
    );
    assert!(matches!(
        configuration.triggers.as_slice(),
        [RoutineTrigger::Cron { .. }]
    ));
    configuration.validate(Utc::now()).unwrap();

    let agent = deserialize_configuration(serde_json::json!({
        "name": "Ping",
        "instructions": "Check in",
        "target": { "type": "agent", "agentId": "00000000-0000-0000-0000-000000000001" },
        "schedule": { "type": "once", "at": "2999-01-01T00:00:00Z" },
    }))
    .unwrap();
    assert_eq!(
        agent.task(None)["agent"]["bot_id"],
        "00000000-0000-0000-0000-000000000001"
    );
}

fn saved_program() -> (Value, Value) {
    let trigger = serde_json::json!({ "type": "multiple", "triggers": [
        { "type": "cron", "schedule": "0 0 9 * * MON-FRI", "timezone": "UTC" },
        { "type": "events", "filters": [
            { "events": ["email.message_received"], "condition": "Is it an invoice?" },
            { "events": ["task.status_changed"], "ids": ["00000000-0000-0000-0000-000000000007"] }
        ] }
    ] });
    let task = serde_json::json!({
        "steps": [
            { "type": "tool", "tool": "SendChannelMessage",
              "arguments": { "channel_id": "c", "content": "New mail" } },
            { "type": "agent", "model": "m", "instructions": "Summarize" }
        ],
        "mcp_servers": [{ "app_slug": "linear", "server_name": "Linear" }],
    });
    (trigger, task)
}

#[test]
fn a_saved_routine_reads_back_in_the_shape_updates_take_and_writes_back_unchanged() {
    let (trigger, task) = saved_program();
    let configuration = RoutineConfiguration::from_saved("Inbox", &trigger, &task).unwrap();
    assert_eq!(configuration.steps.len(), 2);
    assert_eq!(
        configuration.required_apps.as_ref().unwrap()[0].app_slug,
        "linear"
    );
    // Sent back as read, it reproduces what is saved.
    let round_trip: RoutineConfiguration =
        serde_json::from_value(serde_json::to_value(&configuration).unwrap()).unwrap();
    assert_eq!(round_trip.trigger(Utc::now()).unwrap(), trigger);
    assert_eq!(round_trip.task(Some(&task)), task);
}

#[test]
fn routines_with_what_these_tools_cant_state_are_not_editable_here() {
    let (_, task) = saved_program();
    for filter in [
        serde_json::json!({ "events": ["github"], "github": { "events": ["push"] } }),
        serde_json::json!({ "events": ["task.created"], "match": [{ "path": ["x"], "exists": true }] }),
        serde_json::json!({ "events": ["channel.message_attachment_created"] }),
    ] {
        let trigger = serde_json::json!({ "type": "events", "filters": [filter] });
        let error = RoutineConfiguration::from_saved("Watch", &trigger, &task).unwrap_err();
        assert!(
            error
                .to_string()
                .ends_with("Edit it on the routine's page in Macro."),
            "{error}"
        );
    }
}

#[test]
fn updates_keep_saved_apps_unless_told_and_a_saved_program_stays_a_program() {
    let (trigger, task) = saved_program();
    let mut configuration = RoutineConfiguration::from_saved("Inbox", &trigger, &task).unwrap();
    configuration.required_apps = None;
    assert_eq!(
        configuration.task(Some(&task))["mcp_servers"],
        task["mcp_servers"]
    );
    configuration.required_apps = Some(Vec::new());
    assert_eq!(
        configuration.task(Some(&task))["mcp_servers"],
        serde_json::json!([])
    );

    // Down to one agent step: still a program, since the saved one is.
    configuration.steps.remove(0);
    let replacement = configuration.task(Some(&task));
    assert_eq!(replacement["steps"].as_array().unwrap().len(), 1);
    // Saved as a single agent task, it stays one.
    let legacy = serde_json::json!({ "model": "m", "prompt": "", "user_prompt": "Summarize" });
    assert_eq!(
        configuration.task(Some(&legacy))["user_prompt"],
        "Summarize"
    );
    assert!(configuration.task(Some(&legacy)).get("steps").is_none());
}

#[test]
fn a_saved_single_agent_task_keeps_its_routine_instructions_apart() {
    let trigger = serde_json::json!({
        "type": "cron", "schedule": "0 0 9 * * *", "timezone": "UTC"
    });
    let saved = serde_json::json!({
        "model": "m", "prompt": "Be brief.", "user_prompt": "Summarize my day"
    });
    let mut configuration = RoutineConfiguration::from_saved("Digest", &trigger, &saved).unwrap();
    // Read back joined; a rename sends it back unchanged.
    let task = configuration.task(Some(&saved));
    assert_eq!(task["prompt"], "Be brief.");
    assert_eq!(task["user_prompt"], "Summarize my day");

    // An edit after the saved instructions keeps them apart too.
    if let Some(Step::Agent(agent)) = configuration.steps.first_mut() {
        agent.instructions = "Be brief.\n\nSummarize my week".into();
    }
    let task = configuration.task(Some(&saved));
    assert_eq!(task["prompt"], "Be brief.");
    assert_eq!(task["user_prompt"], "Summarize my week");

    // Rewritten instructions replace both.
    if let Some(Step::Agent(agent)) = configuration.steps.first_mut() {
        agent.instructions = "List my meetings".into();
    }
    let task = configuration.task(Some(&saved));
    assert_eq!(task["prompt"], "");
    assert_eq!(task["user_prompt"], "List my meetings");
}
