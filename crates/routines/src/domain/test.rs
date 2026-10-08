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
