use super::{FLAG_CONTEXT, PAUSE_FLAG, paused};
use feature_flags::{FlagSnapshot, FlagValue, outbound::fake::FakeFeatureFlags};

fn flags(result: Result<FlagSnapshot, String>) -> FakeFeatureFlags {
    let mut flags = FakeFeatureFlags::default();
    flags.set_service(FLAG_CONTEXT, result);
    flags
}

#[tokio::test]
async fn the_kill_switch_pauses_refresh() {
    let on = flags(Ok(FlagSnapshot::new([(
        PAUSE_FLAG.to_owned(),
        FlagValue::Boolean(true),
    )])));
    assert!(paused(Some(&on)).await);
}

#[tokio::test]
async fn refresh_runs_when_the_switch_is_off_missing_or_unreadable() {
    let off = flags(Ok(FlagSnapshot::new([(
        PAUSE_FLAG.to_owned(),
        FlagValue::Boolean(false),
    )])));
    assert!(!paused(Some(&off)).await);
    assert!(!paused(Some(&flags(Ok(FlagSnapshot::default())))).await);
    assert!(!paused(Some(&flags(Err("posthog down".to_owned())))).await);
    assert!(!paused::<FakeFeatureFlags>(None).await);
}
