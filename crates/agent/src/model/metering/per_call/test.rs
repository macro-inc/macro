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
    pricing.record(usage.clone(), Some("fast")).unwrap();
    assert!(pricing.record(usage.clone(), None).is_err());
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
