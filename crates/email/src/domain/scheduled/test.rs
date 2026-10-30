use super::*;

#[test]
fn only_future_times_can_be_committed() {
    let now = Utc::now();
    assert!(
        validate_schedule_change(
            ScheduleChange::Set {
                send_time: now,
                source: None
            },
            now
        )
        .is_err()
    );
    assert!(
        validate_schedule_change(
            ScheduleChange::Set {
                send_time: now - chrono::Duration::seconds(1),
                source: None
            },
            now
        )
        .is_err()
    );
    assert!(
        validate_schedule_change(
            ScheduleChange::Set {
                send_time: now + chrono::Duration::seconds(1),
                source: None
            },
            now
        )
        .is_ok()
    );
    assert!(validate_schedule_change(ScheduleChange::Cancel, now).is_ok());
}
