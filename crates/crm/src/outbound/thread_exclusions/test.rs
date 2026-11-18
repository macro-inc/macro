use super::*;
use feature_flags::{FlagSnapshot, FlagValue, outbound::fake::FakeFeatureFlags};
use macro_user_id::cowlike::CowLike;

#[tokio::test]
async fn writes_require_an_explicit_enabled_flag_and_fail_closed() {
    let user = MacroUserIdStr::parse_from_str("macro|user@example.com")
        .unwrap()
        .into_owned();
    for (result, expected) in [
        (Ok(FlagSnapshot::default()), false),
        (Err("flag evaluation unavailable".into()), false),
        (
            Ok(FlagSnapshot::new([(
                ENABLE_CRM_THREAD_EXCLUSIONS.into(),
                FlagValue::Boolean(false),
            )])),
            false,
        ),
        (
            Ok(FlagSnapshot::new([(
                ENABLE_CRM_THREAD_EXCLUSIONS.into(),
                FlagValue::Boolean(true),
            )])),
            true,
        ),
    ] {
        let mut flags = FakeFeatureFlags::default();
        flags.set(user.clone(), result);
        assert_eq!(
            FlaggedThreadExclusions(flags)
                .enabled_for(user.clone())
                .await,
            expected
        );
    }
}
