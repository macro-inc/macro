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

struct Accounts;
impl AgentAccounts for Accounts {
    fn is_teammate<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
    ) -> Pin<Box<dyn Future<Output = Result<bool, AgentAccountError>> + Send + 'a>> {
        Box::pin(async move { Ok(user.as_ref() == "macro|agent@example.com") })
    }
}

#[tokio::test]
async fn teammate_rule_enables_code_mode_without_changing_ordinary_users_flags() {
    let mut flags = FakeFeatureFlags::default();
    let enabled = MacroUserIdStr::parse_from_str("macro|enabled@example.com").unwrap();
    let ordinary = MacroUserIdStr::parse_from_str("macro|ordinary@example.com").unwrap();
    let agent = MacroUserIdStr::parse_from_str("macro|agent@example.com").unwrap();
    flags.set(
        enabled.clone(),
        Ok(FlagSnapshot::new([(
            AI_CODE_MODE.into(),
            FlagValue::Boolean(true),
        )])),
    );
    flags.set(
        ordinary.clone(),
        Ok(FlagSnapshot::new([(
            AI_CODE_MODE.into(),
            FlagValue::Boolean(false),
        )])),
    );
    flags.set(
        agent.clone(),
        Ok(FlagSnapshot::new([(
            AI_CODE_MODE.into(),
            FlagValue::Boolean(false),
        )])),
    );
    let selector = AgentToolMode::new(Accounts, std::sync::Arc::new(FlaggedToolMode::new(flags)));
    assert_eq!(selector.select(&agent).await, ToolMode::Code);
    assert_eq!(selector.select(&ordinary).await, ToolMode::Standard);
    assert_eq!(selector.select(&enabled).await, ToolMode::Code);
    let no_provider = AgentToolMode::new(Accounts, std::sync::Arc::new(StandardTools));
    assert_eq!(no_provider.select(&agent).await, ToolMode::Code);
    assert_eq!(no_provider.select(&ordinary).await, ToolMode::Standard);
}
