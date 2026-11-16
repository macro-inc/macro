use feature_flags::outbound::fake::FakeFeatureFlags;
use feature_flags::{FlagSnapshot, FlagValue};
use macro_user_id::cowlike::CowLike;

use super::*;

const AGENT: &str = "macro|sam-rivera-abc123@agents.macro.invalid";
const CREATOR: &str = "macro|admin@macro.com";

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap().into_owned()
}

fn rollout(on: bool) -> Result<FlagSnapshot, String> {
    Ok(FlagSnapshot::new([(
        AGENT_TEAMMATES_FLAG.to_owned(),
        FlagValue::Boolean(on),
    )]))
}

fn invited_by_creator() -> FakeAgentCreators {
    let mut creators = FakeAgentCreators::default();
    creators.set(user(AGENT), user(CREATOR));
    creators
}

#[tokio::test]
async fn an_agent_follows_its_creators_rollout_not_its_own() {
    let mut flags = FakeFeatureFlags::default();
    flags.set(user(CREATOR), rollout(true));
    flags.set(user(AGENT), rollout(false));

    assert!(agent_teammates_enabled(&invited_by_creator(), Some(&flags), &user(AGENT)).await);
}

#[tokio::test]
async fn with_the_rollout_off_for_its_creator_an_agent_is_off() {
    let mut flags = FakeFeatureFlags::default();
    flags.set(user(CREATOR), rollout(false));
    flags.set(user(AGENT), rollout(true));

    assert!(!agent_teammates_enabled(&invited_by_creator(), Some(&flags), &user(AGENT)).await);
}

#[tokio::test]
async fn an_agent_without_a_creator_is_off() {
    let mut flags = FakeFeatureFlags::default();
    flags.set(user(AGENT), rollout(true));

    assert!(
        !agent_teammates_enabled(&FakeAgentCreators::default(), Some(&flags), &user(AGENT)).await
    );
}

#[tokio::test]
async fn without_flags_or_when_they_fail_to_load_an_agent_is_off() {
    assert!(
        !agent_teammates_enabled(
            &invited_by_creator(),
            None::<&FakeFeatureFlags>,
            &user(AGENT)
        )
        .await
    );

    let mut failing = FakeFeatureFlags::default();
    failing.set(user(CREATOR), Err("PostHog is down".to_owned()));
    assert!(!agent_teammates_enabled(&invited_by_creator(), Some(&failing), &user(AGENT)).await);
}
