use super::*;
use feature_flags::{FlagSnapshot, FlagValue, outbound::fake::FakeFeatureFlags};

#[tokio::test]
async fn only_flagged_owners_route_and_unavailable_flags_do_not() {
    let owners: Vec<_> = ["enabled", "disabled", "failure"]
        .map(|name| MacroUserIdStr::try_from(format!("macro|{name}@example.com")).unwrap())
        .into();
    let mut flags = FakeFeatureFlags::default();
    flags.set(
        owners[0].clone(),
        Ok(FlagSnapshot::new([(
            AUTO_SKILLS.into(),
            FlagValue::Boolean(true),
        )])),
    );
    flags.set(
        owners[1].clone(),
        Ok(FlagSnapshot::new([(
            AUTO_SKILLS.into(),
            FlagValue::Boolean(false),
        )])),
    );
    flags.set(owners[2].clone(), Err("provider unavailable".into()));
    let policy = FlaggedEntityRouting::new(flags);

    assert!(policy.routes(&owners[0]).await);
    assert!(!policy.routes(&owners[1]).await);
    assert!(!policy.routes(&owners[2]).await);
    assert!(!NoEntityRouting.routes(&owners[0]).await);
}
