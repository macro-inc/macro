use super::*;
use feature_flags::{FlagSnapshot, FlagValue, outbound::fake::FakeFeatureFlags};

fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(format!("macro|{email}")).unwrap()
}

#[tokio::test]
async fn webhooks_follow_each_users_flag() {
    let mut flags = FakeFeatureFlags::default();
    flags.set(
        user("on@macro.com"),
        Ok(FlagSnapshot::new([(
            ROUTINE_WEBHOOKS_FLAG.to_owned(),
            FlagValue::Boolean(true),
        )])),
    );
    flags.set(user("off@macro.com"), Ok(FlagSnapshot::default()));
    flags.set(user("down@macro.com"), Err("unavailable".to_owned()));
    let rollout = FlaggedWebhooks::new(flags);

    assert!(rollout.enabled_for(&user("on@macro.com")).await.unwrap());
    assert!(!rollout.enabled_for(&user("off@macro.com")).await.unwrap());
    assert!(rollout.enabled_for(&user("down@macro.com")).await.is_err());
}

#[tokio::test]
async fn without_a_flag_source_webhooks_stay_off() {
    let none: Option<FlaggedWebhooks<FakeFeatureFlags>> = None;
    assert!(!none.enabled_for(&user("on@macro.com")).await.unwrap());
}
