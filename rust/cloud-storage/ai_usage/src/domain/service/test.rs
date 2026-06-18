use super::*;
use macro_user_id::user_id::MacroUserIdStr;

fn user() -> MacroUserIdStr<'static> {
    SYSTEM_USER_ID.clone()
}

fn completion(feature: AiFeature, total: Option<f32>) -> CompletionUsage {
    CompletionUsage {
        feature,
        user: user(),
        entity: None,
        cost: Usage {
            input_tokens: 1000,
            output_tokens: 500,
            model: "claude-opus-4-8".to_string(),
            price: total.map(|t| Price {
                price_per_million_in: 5.0,
                price_per_million_out: 25.0,
                total: t,
            }),
            created_at: Utc::now(),
        },
    }
}

#[test]
fn price_compute_uses_per_million_rates() {
    let usage = Usage {
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        model: "m".to_string(),
        price: None,
        created_at: Utc::now(),
    };
    let price = Price::compute(5.0, 25.0, &usage);
    assert!((price.total - 30.0).abs() < 1e-3);
}

#[test]
fn summarize_groups_by_feature_and_totals() {
    let rows = vec![
        completion(AiFeature::Chat, Some(1.0)),
        completion(AiFeature::Chat, Some(2.5)),
        completion(AiFeature::Memory, Some(0.5)),
        completion(AiFeature::Memory, None), // unpriced rows contribute 0
    ];

    let summary = summarize(rows);

    assert_eq!(summary.entries.len(), 2);
    assert!((summary.total - 4.0).abs() < 1e-4);

    let chat = summary
        .entries
        .iter()
        .find(|f| f.feature == AiFeature::Chat)
        .unwrap();
    assert_eq!(chat.entries.len(), 2);
    assert!((chat.total - 3.5).abs() < 1e-4);

    let memory = summary
        .entries
        .iter()
        .find(|f| f.feature == AiFeature::Memory)
        .unwrap();
    assert_eq!(memory.entries.len(), 2);
    assert!((memory.total - 0.5).abs() < 1e-4);
}

#[test]
fn ai_feature_roundtrips_through_snake_case() {
    assert_eq!(
        AiFeature::DynamicCompletionsApi.to_string(),
        "dynamic_completions_api"
    );
    assert_eq!(
        "channel_bot".parse::<AiFeature>().unwrap(),
        AiFeature::ChannelBot
    );
}

#[test]
fn system_user_is_valid() {
    assert_eq!(SYSTEM_USER_ID.as_ref(), "macro|ai-system@macro.com");
}
