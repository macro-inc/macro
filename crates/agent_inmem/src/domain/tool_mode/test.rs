use super::*;
use feature_flags::{FlagSnapshot, FlagValue, outbound::fake::FakeFeatureFlags};

#[tokio::test]
async fn only_flagged_owners_are_code_mode_only_and_unavailable_flags_are_not() {
    let owners: Vec<_> = ["enabled", "disabled", "failure", "unset"]
        .map(|name| MacroUserIdStr::try_from(format!("macro|{name}@example.com")).unwrap())
        .into();
    let mut flags = FakeFeatureFlags::default();
    flags.set(
        owners[0].clone(),
        Ok(FlagSnapshot::new([(
            AI_SESSION_CODE_MODE_ONLY.into(),
            FlagValue::Boolean(true),
        )])),
    );
    flags.set(
        owners[1].clone(),
        Ok(FlagSnapshot::new([(
            AI_SESSION_CODE_MODE_ONLY.into(),
            FlagValue::Boolean(false),
        )])),
    );
    flags.set(owners[2].clone(), Err("provider unavailable".into()));
    flags.set(owners[3].clone(), Ok(FlagSnapshot::new([])));
    let policy = FlaggedCodeModeOnly::new(flags);

    assert!(policy.requires(&owners[0]).await);
    assert!(!policy.requires(&owners[1]).await);
    assert!(!policy.requires(&owners[2]).await);
    assert!(!policy.requires(&owners[3]).await);
    assert!(!DirectFallback.requires(&owners[0]).await);
}
