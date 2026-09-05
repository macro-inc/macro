use super::should_schedule_alarm;

#[test]
fn save_alarm_preempts_later_keepalive() {
    assert!(should_schedule_alarm(Some(5_000.0), 0.0, 100));
}

#[test]
fn keepalive_does_not_postpone_pending_save() {
    assert!(!should_schedule_alarm(Some(100.0), 0.0, 5_000));
}

#[test]
fn expired_alarm_is_replaced() {
    assert!(should_schedule_alarm(Some(99.0), 100.0, 5_000));
}
