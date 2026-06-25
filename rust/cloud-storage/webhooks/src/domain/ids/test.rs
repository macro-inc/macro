use super::*;

#[test]
fn ids_carry_their_prefix() {
    assert!(WebhookId::generate().as_str().starts_with("wh_"));
    assert!(WebhookRuleId::generate().as_str().starts_with("whr_"));
}

#[test]
fn ids_are_unique() {
    // uuid v7 bodies are time-ordered across milliseconds; within a single
    // millisecond ordering isn't guaranteed, but values are always unique.
    let first = WebhookId::generate();
    let second = WebhookId::generate();
    assert_ne!(first.as_str(), second.as_str());
}

#[test]
fn ids_roundtrip_through_strings() {
    let id = WebhookId::generate();
    let raw = id.as_str().to_string();
    assert_eq!(WebhookId::from_string(raw.clone()).as_str(), raw);
}
