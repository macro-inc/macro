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

#[tokio::test]
async fn email_labels_follow_posthog_and_default_on_only_where_asked() {
    let mut flags = FakeFeatureFlags::default();
    flags.set(
        user("on@macro.com"),
        Ok(FlagSnapshot::new([(
            EMAIL_LABELED_FLAG.to_owned(),
            FlagValue::Boolean(true),
        )])),
    );
    flags.set(
        user("off@macro.com"),
        Ok(FlagSnapshot::new([(
            EMAIL_LABELED_FLAG.to_owned(),
            FlagValue::Boolean(false),
        )])),
    );
    flags.set(user("unset@macro.com"), Ok(FlagSnapshot::default()));
    let development = FlaggedEventRoutines::new(flags).with_email_labels_without_flag(true);

    assert!(
        development
            .email_labels_enabled_for(&user("on@macro.com"))
            .await
            .unwrap()
    );
    assert!(
        !development
            .email_labels_enabled_for(&user("off@macro.com"))
            .await
            .unwrap()
    );
    assert!(
        development
            .email_labels_enabled_for(&user("unset@macro.com"))
            .await
            .unwrap()
    );

    let mut flags = FakeFeatureFlags::default();
    flags.set(user("unset@macro.com"), Ok(FlagSnapshot::default()));
    let production = FlaggedEventRoutines::new(flags);
    assert!(
        !production
            .email_labels_enabled_for(&user("unset@macro.com"))
            .await
            .unwrap()
    );

    assert!(
        !EventRoutinesOff
            .email_labels_enabled_for(&user("on@macro.com"))
            .await
            .unwrap()
    );
}
