use super::*;
use feature_flags::{FlagSnapshot, FlagValue, outbound::fake::FakeFeatureFlags};

#[tokio::test]
async fn computer_rollout_requires_an_explicit_successful_flag_for_the_caller() {
    let user = MacroUserIdStr::try_from("macro|admin@example.com".to_owned()).unwrap();
    assert!(!ComputerRollout::default().enabled(&user).await);
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
        flags.set(user.clone(), result);
        let rollout = ComputerRollout::new(flags);
        assert_eq!(rollout.enabled(&user).await, expected);
        assert!(
            !rollout
                .enabled(&MacroUserIdStr::try_from("macro|other@example.com".to_owned()).unwrap())
                .await
        );
    }
}

#[tokio::test]
async fn an_allowlisted_user_is_enabled_without_the_flag_and_production_refuses_an_allowlist() {
    let allowed = MacroUserIdStr::try_from("macro|tester@example.com".to_owned()).unwrap();
    let other = MacroUserIdStr::try_from("macro|other@example.com".to_owned()).unwrap();
    let allowlist = RolloutAllowlist::parse(
        Some(" macro|tester@example.com ,macro|second@example.com"),
        false,
    )
    .unwrap();

    let without_flags = ComputerRollout::default().with_allowlist(allowlist.clone());
    assert!(without_flags.enabled(&allowed).await);
    assert!(!without_flags.enabled(&other).await);

    let mut flags = FakeFeatureFlags::default();
    flags.set(allowed.clone(), Err("flag service unavailable".to_owned()));
    let with_failing_flags = ComputerRollout::new(flags).with_allowlist(allowlist);
    assert!(with_failing_flags.enabled(&allowed).await);
    assert!(!with_failing_flags.enabled(&other).await);

    assert_eq!(
        RolloutAllowlist::parse(None, true),
        Ok(RolloutAllowlist::default())
    );
    assert_eq!(
        RolloutAllowlist::parse(Some("  "), true),
        Ok(RolloutAllowlist::default())
    );
    assert_eq!(
        RolloutAllowlist::parse(Some("macro|tester@example.com"), true),
        Err(RolloutAllowlistError::Production)
    );
    assert_eq!(
        RolloutAllowlist::parse(Some("macro|tester@example.com,not a user"), false),
        Err(RolloutAllowlistError::InvalidEntry(1))
    );
}
