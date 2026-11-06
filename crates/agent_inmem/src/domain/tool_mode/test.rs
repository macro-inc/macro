use super::*;
use feature_flags::{FlagSnapshot, FlagValue, outbound::fake::FakeFeatureFlags};

#[tokio::test]
async fn flag_results_are_scoped_to_the_exact_owner_and_failures_keep_standard_tools() {
    let users: Vec<_> = ["enabled", "variant", "disabled", "missing", "failure"]
        .map(|name| MacroUserIdStr::try_from(format!("macro|{name}@example.com")).unwrap())
        .into();
    let mut flags = FakeFeatureFlags::default();
    for (owner, value) in users.iter().zip([
        Some(FlagValue::Boolean(true)),
        Some(FlagValue::Variant("enabled".into())),
        Some(FlagValue::Boolean(false)),
        None,
    ]) {
        flags.set(
            owner.clone(),
            Ok(FlagSnapshot::new(value.map(|v| (AI_CODE_MODE.into(), v)))),
        );
    }
    flags.set(users[4].clone(), Err("provider unavailable".into()));
    let selector = FlaggedToolMode::new(flags);
    for (owner, expected) in users.iter().zip([
        ToolMode::Code,
        ToolMode::Code,
        ToolMode::Standard,
        ToolMode::Standard,
        ToolMode::Standard,
    ]) {
        assert_eq!(selector.select(owner).await, expected);
    }
    // A prior enabled user must never become another user's fallback.
    assert_eq!(selector.select(&users[0]).await, ToolMode::Code);
    assert_eq!(selector.select(&users[4]).await, ToolMode::Standard);
    assert_eq!(StandardTools.select(&users[0]).await, ToolMode::Standard);
}
