use rig_core::providers::{
    anthropic::completion::{
        CLAUDE_HAIKU_4_5, CLAUDE_OPUS_4_7, CLAUDE_OPUS_4_8, CLAUDE_SONNET_4_6,
    },
    openai::GPT_5_5,
};

use crate::model::PredefinedModel;

#[test]
fn default_is_smart() {
    assert_eq!(PredefinedModel::default(), PredefinedModel::Smart);
}

#[test]
fn smart_is_opus_4_8() {
    // `Smart` resolves to Opus 4.8 — both as the router id (`to_string`,
    // provider-qualified) and as the serialize-only wire id (bare api id).
    assert_eq!(
        PredefinedModel::Smart.to_string(),
        format!("anthropic/{CLAUDE_OPUS_4_8}")
    );
    assert_eq!(
        serde_json::to_string(&PredefinedModel::Smart).unwrap(),
        r#""claude-opus-4-8""#
    );
}

#[test]
fn fast_is_haiku() {
    // `Fast` resolves to the same model as `Haiku4_5` (Claude Haiku 4.5).
    assert_eq!(
        PredefinedModel::Fast.to_string(),
        format!("anthropic/{CLAUDE_HAIKU_4_5}")
    );
    assert_eq!(
        PredefinedModel::Fast.to_string(),
        PredefinedModel::Haiku4_5.to_string()
    );
}

#[test]
fn retired_uses_default_api_id() {
    assert_eq!(
        PredefinedModel::Retired.to_string(),
        PredefinedModel::Smart.to_string()
    );
}

#[test]
fn variants_serialize_to_their_api_id() {
    fn ant(m: &str) -> String {
        format!("anthropic/{}", m)
    }

    assert_eq!(PredefinedModel::Opus4_7.to_string(), ant(CLAUDE_OPUS_4_7));
    assert_eq!(
        PredefinedModel::Sonnet5.to_string(),
        "anthropic/claude-sonnet-5"
    );
    assert_eq!(
        serde_json::to_string(&PredefinedModel::Sonnet5).unwrap(),
        r#""claude-sonnet-5""#
    );
    assert_eq!(PredefinedModel::Haiku4_5.to_string(), ant(CLAUDE_HAIKU_4_5));
    assert_eq!(
        PredefinedModel::Sonnet4_6.to_string(),
        ant(CLAUDE_SONNET_4_6)
    );
    assert_eq!(
        PredefinedModel::Gpt5_5.to_string(),
        format!("openai/{}", GPT_5_5)
    );
}

#[test]
fn sonnet_5_uses_adaptive_thinking() {
    let params = PredefinedModel::Sonnet5.thinking_params();
    assert_eq!(params["thinking"]["type"], "adaptive");
    assert!(params["thinking"].get("budget_tokens").is_none());
    assert!(params.get("temperature").is_none());
    assert_eq!(PredefinedModel::Sonnet5.context_window(), 1_000_000);
}
