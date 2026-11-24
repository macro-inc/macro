use super::*;
use crate::domain::models::{CHAT_MODELS, RETIRED_MODELS, current_model};

const SONNET_5_5: &str = "anthropic/claude-sonnet-5-5";
const OPUS_5_5: &str = "anthropic/claude-opus-5-5";
const HAIKU_5_5: &str = "anthropic/claude-haiku-5-5";
const GEMINI_FLASH: &str = "google/gemini-3.8-flash";
const GPT_6_2_SOL: &str = "openai/gpt-6.2-sol";
const GPT_6_LUNA: &str = "openai/gpt-6-luna";
const HAIKU_4_5: &str = "anthropic/claude-haiku-4-5";
const SONNET_5: &str = "anthropic/claude-sonnet-5";
const OPUS_5: &str = "anthropic/claude-opus-5";
const FABLE_5_1: &str = "anthropic/claude-fable-5-1";

#[test]
fn free_user_only_has_the_free_model() {
    let svc = ModelAccessServiceImpl;
    assert_eq!(svc.best_model(false), FREE_MODEL);
    assert!(svc.has_access(false, FREE_MODEL));
    assert_eq!(FREE_MODEL, GEMINI_FLASH);
    assert!(svc.has_access(false, GEMINI_FLASH));
    assert!(!svc.has_access(false, HAIKU_5_5));
    assert!(!svc.has_access(false, "unknown/model"));
    assert!(!svc.has_access(false, OPUS_5_5));
    assert!(!svc.has_access(false, SONNET_5_5));
    assert!(!svc.has_access(false, GPT_6_2_SOL));
}

#[test]
fn professional_user_has_everything() {
    let svc = ModelAccessServiceImpl;
    assert_eq!(svc.best_model(true), SONNET_5_5);
    for model in CHAT_MODELS {
        assert!(svc.has_access(true, model), "{model}");
    }
}

#[test]
fn only_the_current_anthropic_generation_is_offered() {
    let anthropic: Vec<&str> = CHAT_MODELS
        .iter()
        .copied()
        .filter(|model| model.starts_with("anthropic/"))
        .collect();
    assert_eq!(anthropic, [SONNET_5_5, OPUS_5_5, HAIKU_5_5]);
    for retired in [SONNET_5, OPUS_5, FABLE_5_1, HAIKU_4_5] {
        assert!(!CHAT_MODELS.contains(&retired), "{retired} is retired");
    }
    assert!(CHAT_MODELS.contains(&PAID_DEFAULT_MODEL));
    assert!(CHAT_MODELS.contains(&FREE_MODEL));
}

#[test]
fn only_the_current_openai_generation_is_offered() {
    let openai: Vec<&str> = CHAT_MODELS
        .iter()
        .copied()
        .filter(|model| model.starts_with("openai/"))
        .collect();
    assert_eq!(openai, ["openai/gpt-6-astra", GPT_6_2_SOL, GPT_6_LUNA]);
}

#[test]
fn every_retired_model_is_replaced_by_an_offered_one() {
    for (retired, replacement) in RETIRED_MODELS {
        assert!(!CHAT_MODELS.contains(retired), "{retired} is still offered");
        assert!(CHAT_MODELS.contains(replacement), "{replacement} is not offered");
        assert_eq!(current_model(retired), *replacement);
    }
    assert_eq!(current_model(HAIKU_4_5), HAIKU_5_5);
    assert_eq!(current_model("openai/gpt-6.1-sol"), GPT_6_2_SOL);
    assert_eq!(current_model("openai/gpt-5.6"), GPT_6_2_SOL);
    assert_eq!(current_model("openai/gpt-5.6-mini"), GPT_6_LUNA);
}

#[test]
fn current_and_unknown_models_are_kept() {
    for model in CHAT_MODELS {
        assert_eq!(current_model(model), *model);
    }
    assert_eq!(current_model("fireworks/kimi-k3"), "fireworks/kimi-k3");
    assert_eq!(current_model("auto"), "auto");
}
