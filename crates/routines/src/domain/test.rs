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
    assert_eq!(
        configuration.task()["steps"],
        serde_json::json!([{ "type": "agent", "model": "claude", "instructions": "Sum up my day" }])
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
        agent.task()["steps"][0]["agent"]["bot_id"],
        "00000000-0000-0000-0000-000000000001"
    );
}
