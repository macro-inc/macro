use super::*;

#[test]
fn only_future_times_can_be_committed() {
    let now = Utc::now();
    assert!(validate_schedule_change(ScheduleChange::Set(now), now).is_err());
    assert!(
        validate_schedule_change(ScheduleChange::Set(now - chrono::Duration::seconds(1)), now)
            .is_err()
    );
    assert!(
        validate_schedule_change(ScheduleChange::Set(now + chrono::Duration::seconds(1)), now)
            .is_ok()
    );
    assert!(validate_schedule_change(ScheduleChange::Cancel, now).is_ok());
}
