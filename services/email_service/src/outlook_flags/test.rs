use super::*;
use email::domain::mailbox::live_pass::LiveImportPass;
use feature_flags::outbound::fake::FakeFeatureFlags;
use feature_flags::{FlagSnapshot, FlagValue};

#[tokio::test]
async fn a_switch_follows_its_flag_and_is_off_while_the_flag_cannot_be_read() {
    let switch = LiveImportPass::default();
    let flag = OutlookFlag {
        key: LIVE_IMPORT_PASS_FLAG,
        name: "outlook import live pass",
        set: |on| switch.set(on),
    };
    let mut on = FakeFeatureFlags::default();
    on.set_service(
        OUTLOOK_SYNC_CONTEXT,
        Ok(FlagSnapshot::new([(
            LIVE_IMPORT_PASS_FLAG.to_owned(),
            FlagValue::Boolean(true),
        )])),
    );
    let mut failing = FakeFeatureFlags::default();
    failing.set_service(OUTLOOK_SYNC_CONTEXT, Err("PostHog is unavailable".into()));

    assert!(refresh(&on, &flag, false).await);
    assert!(switch.enabled());
    assert!(!refresh(&failing, &flag, false).await);
    assert!(!switch.enabled());
}
