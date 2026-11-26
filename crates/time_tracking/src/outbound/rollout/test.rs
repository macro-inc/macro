use feature_flags::{FlagSnapshot, FlagValue, outbound::fake::FakeFeatureFlags};
use macro_user_id::cowlike::CowLike;

use super::*;

fn person() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|logger@example.com")
        .unwrap()
        .into_owned()
}

fn flags_for(result: Result<FlagSnapshot, String>) -> FlaggedTimeTracking<FakeFeatureFlags> {
    let mut flags = FakeFeatureFlags::default();
    flags.set(person(), result);
    FlaggedTimeTracking(flags)
}

#[tokio::test]
async fn the_flag_turns_time_tracking_on_for_that_person() {
    let rollout = flags_for(Ok(FlagSnapshot::new([(
        TIME_TRACKING_FLAG.to_string(),
        FlagValue::Boolean(true),
    )])));

    assert!(rollout.enabled_for(&person()).await);
}

#[tokio::test]
async fn a_flag_that_is_off_or_missing_keeps_writes_off() {
    let off = flags_for(Ok(FlagSnapshot::new([(
        TIME_TRACKING_FLAG.to_string(),
        FlagValue::Boolean(false),
    )])));
    let missing = flags_for(Ok(FlagSnapshot::default()));

    assert!(!off.enabled_for(&person()).await);
    assert!(!missing.enabled_for(&person()).await);
}

#[tokio::test]
async fn a_flag_load_that_fails_keeps_writes_off() {
    let rollout = flags_for(Err("flag service unavailable".to_string()));

    assert!(!rollout.enabled_for(&person()).await);
}

#[tokio::test]
async fn a_local_stack_has_time_tracking_on() {
    assert!(LocalTimeTracking.enabled_for(&person()).await);
}

#[tokio::test]
async fn a_host_without_a_flag_client_keeps_writes_off() {
    assert!(!TimeTrackingOff.enabled_for(&person()).await);
}
