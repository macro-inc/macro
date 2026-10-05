use super::*;
use crate::domain::models::CHAT_MODELS;

const SONNET_5_5: &str = "anthropic/claude-sonnet-5-5";
const OPUS_5_5: &str = "anthropic/claude-opus-5-5";
const HAIKU_4_5: &str = "anthropic/claude-haiku-4-5";
const SONNET_5: &str = "anthropic/claude-sonnet-5";
const OPUS_5: &str = "anthropic/claude-opus-5";
const FABLE_5_1: &str = "anthropic/claude-fable-5-1";
const GPT_5_5: &str = "openai/gpt-5.5";
const GPT_5_MINI: &str = "openai/gpt-5-mini";

#[test]
fn free_user_only_has_the_free_model() {
    let svc = ModelAccessServiceImpl;
    assert_eq!(svc.best_model(false), FREE_MODEL);
    assert!(svc.has_access(false, FREE_MODEL));
    assert!(svc.has_access(false, HAIKU_4_5));
    assert!(!svc.has_access(false, OPUS_5_5));
    assert!(!svc.has_access(false, SONNET_5_5));
    assert!(!svc.has_access(false, GPT_5_5));
}

#[test]
fn professional_user_has_everything() {
    let svc = ModelAccessServiceImpl;
    assert_eq!(svc.best_model(true), SONNET_5_5);
    assert!(svc.has_access(true, SONNET_5_5));
    assert!(svc.has_access(true, OPUS_5_5));
    assert!(svc.has_access(true, HAIKU_4_5));
    assert!(svc.has_access(true, GPT_5_5));
    assert!(svc.has_access(true, GPT_5_MINI));
}

#[test]
fn only_the_current_anthropic_generation_is_offered() {
    let anthropic: Vec<&str> = CHAT_MODELS
        .iter()
        .copied()
        .filter(|model| model.starts_with("anthropic/"))
        .collect();
    assert_eq!(anthropic, [SONNET_5_5, OPUS_5_5, HAIKU_4_5]);
    for retired in [SONNET_5, OPUS_5, FABLE_5_1] {
        assert!(!CHAT_MODELS.contains(&retired), "{retired} is retired");
    }
    assert!(CHAT_MODELS.contains(&PAID_DEFAULT_MODEL));
    assert!(CHAT_MODELS.contains(&FREE_MODEL));
}
