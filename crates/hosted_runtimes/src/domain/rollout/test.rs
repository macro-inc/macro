use super::*;
use feature_flags::{FlagSnapshot, FlagValue, outbound::fake::FakeFeatureFlags};

#[tokio::test]
async fn computer_rollout_requires_an_explicit_successful_flag_for_the_caller() {
    let user = "macro|admin@example.com";
    assert!(!ComputerRollout::default().enabled(user).await);
    for (result, expected) in [
        (Ok(FlagSnapshot::default()), false),
        (Err("flag service unavailable".to_owned()), false),
        (
            Ok(FlagSnapshot::new([(
                ENABLE_MACRO_COMPUTERS.into(),
                FlagValue::Boolean(false),
            )])),
            false,
        ),
        (
            Ok(FlagSnapshot::new([(
                ENABLE_MACRO_COMPUTERS.into(),
                FlagValue::Boolean(true),
            )])),
            true,
        ),
    ] {
        let mut flags = FakeFeatureFlags::default();
        flags.set(MacroUserIdStr::try_from(user.to_owned()).unwrap(), result);
        let rollout = ComputerRollout::new(flags);
        assert_eq!(rollout.enabled(user).await, expected);
        assert!(!rollout.enabled("macro|other@example.com").await);
    }
}
