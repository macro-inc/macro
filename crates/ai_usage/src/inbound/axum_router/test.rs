use super::*;
use serde_json::{Value, json};

fn pricing(body: Value) -> Result<ModelPricing, &'static str> {
    serde_json::from_value::<SetPricingRequest>(body)
        .unwrap()
        .pricing()
}

#[test]
fn omitted_token_prices_cannot_silently_reprice_usage_to_zero() {
    for body in [
        json!({"model": "text-model"}),
        json!({"model": "text-model", "price_per_audio_minute": null}),
        json!({"model": "text-model", "price_per_mil_in": 1.0}),
        json!({"model": "text-model", "price_per_mil_out": 2.0}),
    ] {
        assert_eq!(
            pricing(body),
            Err("provide both token prices or an audio price")
        );
    }
}

#[test]
fn token_prices_remain_explicit_including_free_models() {
    for (input, output) in [(1.0, 2.0), (0.0, 0.0)] {
        assert_eq!(
            pricing(json!({
                "model": "text-model",
                "price_per_mil_in": input,
                "price_per_mil_out": output,
            })),
            Ok(ModelPricing::Tokens { input, output })
        );
    }
}

#[test]
fn audio_prices_allow_omitted_or_zero_token_fields() {
    for body in [
        json!({"model": "whisper-1", "price_per_audio_minute": 0.006}),
        json!({
            "model": "whisper-1",
            "price_per_mil_in": 0.0,
            "price_per_mil_out": 0.0,
            "price_per_audio_minute": 0.006,
        }),
    ] {
        assert_eq!(pricing(body), Ok(ModelPricing::Audio { per_minute: 0.006 }));
    }
}

#[test]
fn mixed_billing_units_are_rejected() {
    for (input, output) in [(1.0, 0.0), (0.0, 2.0)] {
        assert_eq!(
            pricing(json!({
                "model": "whisper-1",
                "price_per_mil_in": input,
                "price_per_mil_out": output,
                "price_per_audio_minute": 0.006,
            })),
            Err("choose token pricing or audio pricing")
        );
    }
}
