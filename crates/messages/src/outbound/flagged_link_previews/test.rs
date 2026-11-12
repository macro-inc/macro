use super::*;
use feature_flags::{FlagSnapshot, FlagValue, outbound::fake::FakeFeatureFlags};

fn person(id: &str) -> MacroUserIdStr<'static> {
    macro_user_id::cowlike::CowLike::into_owned(MacroUserIdStr::parse_from_str(id).unwrap())
}

#[tokio::test]
async fn link_previews_follow_each_persons_flag() {
    let (on, off, unreadable) = (
        person("macro|on@example.com"),
        person("macro|off@example.com"),
        person("macro|unreadable@example.com"),
    );
    let mut flags = FakeFeatureFlags::default();
    flags.set(
        on.clone(),
        Ok(FlagSnapshot::new([(
            ENABLE_LINK_PREVIEWS.into(),
            FlagValue::Boolean(true),
        )])),
    );
    flags.set(off.clone(), Ok(FlagSnapshot::default()));
    flags.set(unreadable.clone(), Err("PostHog is down".into()));
    let gate = FlaggedLinkPreviews(flags);

    assert!(gate.enabled_for(&on).await);
    assert!(!gate.enabled_for(&off).await);
    assert!(!gate.enabled_for(&unreadable).await);
}
