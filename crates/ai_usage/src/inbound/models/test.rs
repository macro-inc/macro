use super::*;
use serde_json::json;
use std::time::Duration;

#[test]
fn token_usage_keeps_the_existing_http_shape() {
    let created_at = "2026-09-18T00:00:00Z".parse().unwrap();
    let amount = UsageAmount::Tokens {
        input: 1_000_000,
        output: 2_000_000,
    };
    let usage = Usage::from(domain::Usage {
        amount,
        model: "text-model".into(),
        price: domain::Price::compute(
            ModelPricing::Tokens {
                input: 1.0,
                output: 2.0,
            },
            amount,
        ),
        created_at,
    });
    assert_eq!(
        serde_json::to_value(usage).unwrap(),
        json!({
            "input_tokens": 1_000_000,
            "output_tokens": 2_000_000,
            "audio_seconds": null,
            "model": "text-model",
            "created_at": "2026-09-18T00:00:00Z",
            "price": {
                "price_per_million_in": 1.0,
                "price_per_million_out": 2.0,
                "price_per_audio_minute": null,
                "total": 5.0
            }
        })
    );
}

#[test]
fn audio_usage_exposes_duration_and_rate_without_inventing_tokens() {
    let amount = UsageAmount::Audio {
        duration: Duration::from_millis(90_500),
    };
    let usage = Usage::from(domain::Usage {
        amount,
        model: "whisper-1".into(),
        price: domain::Price::compute(ModelPricing::Audio { per_minute: 0.006 }, amount),
        created_at: Utc::now(),
    });
    let json = serde_json::to_value(usage).unwrap();
    assert_eq!(json["input_tokens"], 0);
    assert_eq!(json["output_tokens"], 0);
    assert_eq!(json["audio_seconds"], 90.5);
    assert!((json["price"]["price_per_audio_minute"].as_f64().unwrap() - 0.006).abs() < 1e-7);
    assert!((json["price"]["total"].as_f64().unwrap() - 0.00905).abs() < 1e-7);
}
