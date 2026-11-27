use super::*;
use ai_usage::financial::{TrustedTokenUsage, UnresolvedReason};
use ai_usage::{AiFeature, UsageEvent};
use std::sync::Mutex;

#[derive(Default)]
struct Recorder(Mutex<Vec<UsageEvent>>);
impl UsageRecorder for Recorder {
    fn record(&self, event: UsageEvent) {
        self.0.lock().unwrap().push(event);
    }
}

fn setup(model: &str, speed: ModelSpeed) -> (PerCallUsage, Arc<Recorder>) {
    let recorder = Arc::new(Recorder::default());
    let usage = UsageContext::new(
        AiFeature::Chat,
        "macro|speed@example.com".to_owned().try_into().unwrap(),
    );
    (
        PerCallUsage::new(recorder.clone(), usage, model, speed),
        recorder,
    )
}

#[test]
fn prices_delivered_tier_and_each_calls_inclusive_prompt() {
    let (pricing, recorder) = setup("openai/gpt-6-astra", ModelSpeed::Ultrafast);
    for (input, cached, tier) in [
        (270_000, 2_000, "ultrafast"),
        (270_000, 2_001, "ultrafast"),
        (1, 0, "default"),
    ] {
        pricing
            .record(
                UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(input, 10, cached, 0, 5)),
                Some(tier),
            )
            .unwrap();
    }
    let events = recorder.0.lock().unwrap();
    assert_eq!(
        events.iter().map(|e| e.model.as_str()).collect::<Vec<_>>(),
        [
            "gpt-6-astra:ultrafast",
            "gpt-6-astra:ultrafast:long",
            "gpt-6-astra"
        ]
    );
    assert!(matches!(
        events[0].amount,
        UsageAmount::Tokens {
            output: 15,
            cache_read: 2_000,
            ..
        }
    ));
}

#[test]
fn fast_claude_records_cache_writes_and_rejects_unknown_tiers() {
    let (pricing, recorder) = setup("anthropic/claude-opus-5-5", ModelSpeed::Fast);
    let usage = UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(5, 10, 20, 30, 0));
    pricing.record(usage, Some("fast")).unwrap();
    assert!(pricing.record(usage, None).is_err());
    assert!(pricing.record(usage, Some("priority")).is_err());
    pricing
        .record(UsageEvidence::Missing(UnresolvedReason::Interrupted), None)
        .unwrap();
    let events = recorder.0.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].model, "claude-opus-5-5:fast");
    assert!(matches!(
        events[0].amount,
        UsageAmount::Tokens {
            cache_write: 30,
            ..
        }
    ));
}

#[test]
fn priority_gpt_prices_either_reported_name_and_downgrades() {
    let (pricing, recorder) = setup("openai/gpt-6.2-sol", ModelSpeed::Priority);
    for (input, tier) in [
        (10, "priority"),
        (10, "fast"),
        (300_000, "priority"),
        (10, "default"),
    ] {
        pricing
            .record(
                UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(input, 10, 0, 0, 0)),
                Some(tier),
            )
            .unwrap();
    }
    let events = recorder.0.lock().unwrap();
    assert_eq!(
        events.iter().map(|e| e.model.as_str()).collect::<Vec<_>>(),
        [
            "gpt-6.2-sol:priority",
            "gpt-6.2-sol:priority",
            "gpt-6.2-sol:priority:long",
            "gpt-6.2-sol"
        ]
    );
    let body = serde_json::json!({ "service_tier": "priority" });
    let model = ProviderModel::new("openai", "gpt-6.2-sol").unwrap();
    assert!(pricing.matches(&model, &body));
}

#[test]
fn haiku_5_5_prices_prompts_over_100k_at_its_long_rate() {
    let (pricing, recorder) = setup("anthropic/claude-haiku-5-5", ModelSpeed::Standard);
    for (input, cached, written) in [(60_000, 40_000, 0), (60_000, 40_000, 1), (100, 0, 0)] {
        pricing
            .record(
                UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(
                    input, 10, cached, written, 0,
                )),
                Some("standard"),
            )
            .unwrap();
    }
    let events = recorder.0.lock().unwrap();
    assert_eq!(
        events.iter().map(|e| e.model.as_str()).collect::<Vec<_>>(),
        [
            "claude-haiku-5-5",
            "claude-haiku-5-5:long",
            "claude-haiku-5-5"
        ]
    );
}

#[test]
fn luna_and_sol_price_prompts_over_272k_at_their_long_rate() {
    for (model, key) in [
        ("openai/gpt-6-luna", "gpt-6-luna"),
        ("openai/gpt-6.2-sol", "gpt-6.2-sol"),
    ] {
        let (pricing, recorder) = setup(model, ModelSpeed::Standard);
        for input in [272_000, 272_001] {
            pricing
                .record(
                    UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(input, 10, 0, 0, 0)),
                    Some("default"),
                )
                .unwrap();
        }
        let events = recorder.0.lock().unwrap();
        assert_eq!(
            events.iter().map(|e| e.model.clone()).collect::<Vec<_>>(),
            [key.to_owned(), format!("{key}:long")]
        );
    }
}

#[test]
fn other_claude_models_have_no_long_rate() {
    assert_eq!(
        ModelSpeed::long_context_threshold("anthropic/claude-opus-5-5"),
        None
    );
    assert_eq!(
        ModelSpeed::long_context_threshold("anthropic/claude-haiku-5-5"),
        Some(100_000)
    );
}
