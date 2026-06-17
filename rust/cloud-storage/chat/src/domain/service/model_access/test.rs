use super::*;

const HAIKU: &str = "claude-haiku-4-5";
const OPUS: &str = "claude-opus-4-8";

#[test]
fn free_user_only_has_haiku() {
    let svc = ModelAccessServiceImpl;
    assert!(svc.has_access(false, HAIKU));
    assert!(!svc.has_access(false, OPUS));
    assert!(!svc.has_access(false, "gpt-5.5"));
}

#[test]
fn professional_user_has_everything() {
    let svc = ModelAccessServiceImpl;
    assert!(svc.has_access(true, HAIKU));
    assert!(svc.has_access(true, OPUS));
    assert!(svc.has_access(true, "gpt-5.5"));
    assert!(svc.has_access(true, "gpt-5-mini"));
}

#[test]
fn unknown_model_is_never_accessible() {
    let svc = ModelAccessServiceImpl;
    assert!(!svc.has_access(true, "claude-sonnet-4-6"));
    assert!(!svc.has_access(true, "not-a-model"));
}

#[test]
fn list_flags_availability_per_plan() {
    let svc = ModelAccessServiceImpl;

    let free = svc.list_models(false);
    assert_eq!(free.models.len(), CHAT_MODELS.len());
    for m in &free.models {
        assert_eq!(m.available, m.id == HAIKU, "{}", m.id);
    }

    let pro = svc.list_models(true);
    assert!(pro.models.iter().all(|m| m.available));
}
