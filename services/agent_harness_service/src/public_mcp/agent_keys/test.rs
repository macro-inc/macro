use feature_flags::{FlagSnapshot, outbound::fake::FakeFeatureFlags};

use super::*;

const AGENT: &str = "macro|sam-rivera-abc123@agents.macro.invalid";
const PERSON: &str = "macro|person@example.com";

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_owned()).unwrap()
}

/// Every key belongs to the account named by the key itself.
struct KeysOf;

impl McpUserApiKeys for KeysOf {
    fn user<'a>(
        &'a self,
        key: &'a str,
    ) -> Pin<Box<dyn Future<Output = Option<MacroUserIdStr<'static>>> + Send + 'a>> {
        Box::pin(async move { MacroUserIdStr::try_from(key.to_owned()).ok() })
    }
}

/// The rollout on or off for [`PERSON`], who invited [`AGENT`], and the
/// other way round for the agent's own account.
fn keys(creator_rollout_on: bool) -> AgentUserApiKeys<KeysOf> {
    let mut creators = agent_credentials::FakeAgentCreators::default();
    creators.set(user(AGENT), user(PERSON));
    let mut flags = FakeFeatureFlags::default();
    flags.set(
        user(PERSON),
        Ok(FlagSnapshot::new([(
            agent_credentials::AGENT_TEAMMATES_FLAG.to_owned(),
            feature_flags::FlagValue::Boolean(creator_rollout_on),
        )])),
    );
    flags.set(
        user(AGENT),
        Ok(FlagSnapshot::new([(
            agent_credentials::AGENT_TEAMMATES_FLAG.to_owned(),
            feature_flags::FlagValue::Boolean(!creator_rollout_on),
        )])),
    );
    AgentUserApiKeys::with_lookup(
        KeysOf,
        Arc::new(|user| Box::pin(async move { user.as_ref() == AGENT })),
        BrainRollout::new(creators, flags),
    )
}

#[tokio::test]
async fn an_agent_with_the_rollout_on_for_its_creator_signs_in_with_its_own_key() {
    assert_eq!(keys(true).user(AGENT).await, Some(user(AGENT)));
}

#[tokio::test]
async fn a_person_or_an_agent_with_the_rollout_off_for_its_creator_is_refused() {
    assert_eq!(keys(true).user(PERSON).await, None);
    assert_eq!(keys(false).user(AGENT).await, None);
    // No flag provider: closed.
    let unflagged = AgentUserApiKeys::with_lookup(
        KeysOf,
        Arc::new(|_| Box::pin(async { true })),
        BrainRollout::default(),
    );
    assert_eq!(unflagged.user(AGENT).await, None);
}
