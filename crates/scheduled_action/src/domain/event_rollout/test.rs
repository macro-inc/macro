use super::*;
use feature_flags::{FlagSnapshot, FlagValue, outbound::fake::FakeFeatureFlags};

fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(format!("macro|{email}")).unwrap()
}

#[tokio::test]
async fn event_routines_follow_each_owners_flag() {
    let mut flags = FakeFeatureFlags::default();
    flags.set(
        user("on@macro.com"),
        Ok(FlagSnapshot::new([(
            EVENT_ROUTINES_FLAG.to_owned(),
            FlagValue::Boolean(true),
        )])),
    );
    flags.set(user("off@macro.com"), Ok(FlagSnapshot::default()));
    flags.set(user("down@macro.com"), Err("unavailable".to_owned()));
    let rollout = FlaggedEventRoutines::new(flags);

    assert!(rollout.enabled_for(&user("on@macro.com")).await.unwrap());
    assert!(!rollout.enabled_for(&user("off@macro.com")).await.unwrap());
    assert!(rollout.enabled_for(&user("down@macro.com")).await.is_err());
}

#[tokio::test]
async fn without_a_flag_source_event_routines_stay_off() {
    let on = user("on@macro.com");
    assert!(!EventRoutinesOff.enabled_for(&on).await.unwrap());
    let none: Option<FlaggedEventRoutines<FakeFeatureFlags>> = None;
    assert!(!none.enabled_for(&on).await.unwrap());
}
