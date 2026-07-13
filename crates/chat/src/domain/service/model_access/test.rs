use super::*;

const HAIKU: &str = "anthropic/claude-haiku-4-5";
const OPUS: &str = "anthropic/claude-opus-4-8";
const OPUS_4_7: &str = "anthropic/claude-opus-4-7";
const SONNET_4_6: &str = "anthropic/claude-sonnet-4-6";
const GPT_5_5: &str = "openai/gpt-5.5";
const GPT_5_MINI: &str = "openai/gpt-5-mini";

#[test]
fn free_user_only_has_haiku() {
    let svc = ModelAccessServiceImpl;
    assert!(svc.has_access(false, HAIKU));
    assert!(!svc.has_access(false, OPUS));
    assert!(!svc.has_access(false, SONNET_4_6));
    assert!(!svc.has_access(false, GPT_5_5));
}

#[test]
fn professional_user_has_everything() {
    let svc = ModelAccessServiceImpl;
    assert!(svc.has_access(true, HAIKU));
    assert!(svc.has_access(true, OPUS));
    assert!(svc.has_access(true, OPUS_4_7));
    assert!(svc.has_access(true, SONNET_4_6));
    assert!(svc.has_access(true, GPT_5_5));
    assert!(svc.has_access(true, GPT_5_MINI));
}
