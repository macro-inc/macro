use super::*;

#[test]
fn default_is_smart() {
    assert_eq!(AgentModel::default(), AgentModel::Smart);
}

#[test]
fn smart_is_opus_4_8() {
    assert_eq!(AgentModel::Smart.api_id(), "claude-opus-4-8");
    assert_eq!(
        serde_json::to_string(&AgentModel::Smart).unwrap(),
        r#""claude-opus-4-8""#
    );
}

#[test]
fn fast_is_haiku() {
    assert_eq!(AgentModel::Fast.api_id(), "claude-haiku-4-5");
    assert_eq!(AgentModel::Fast.api_id(), AgentModel::Haiku4_5.api_id());
}

#[test]
fn retired_uses_default_api_id() {
    assert_eq!(AgentModel::Retired.api_id(), AgentModel::Smart.api_id());
}

#[test]
fn variants_serialize_to_their_api_id() {
    for m in [
        AgentModel::Smart,
        AgentModel::Fast,
        AgentModel::Opus4_7,
        AgentModel::Sonnet4_6,
        AgentModel::Haiku4_5,
        AgentModel::Gpt5_5,
        AgentModel::Gpt5Mini,
        AgentModel::Retired,
    ] {
        let wire = serde_json::to_string(&m).unwrap();
        assert_eq!(wire, format!(r#""{}""#, m.api_id()), "{m:?}");
    }
}

#[test]
fn providers_are_assigned_correctly() {
    assert_eq!(AgentModel::Gpt5_5.provider(), Provider::OpenAi);
    assert_eq!(AgentModel::Gpt5Mini.provider(), Provider::OpenAi);
    assert_eq!(AgentModel::Smart.provider(), Provider::Anthropic);
    assert_eq!(AgentModel::Fast.provider(), Provider::Anthropic);
    assert_eq!(AgentModel::Retired.provider(), Provider::Anthropic);
}
