use super::event_description;
use crate::domain::models::WEBHOOK_EVENT_NAMES;

#[test]
fn every_event_macro_emits_is_described() {
    let undescribed: Vec<_> = WEBHOOK_EVENT_NAMES
        .iter()
        .filter(|name| event_description(name).is_none())
        .collect();
    assert!(undescribed.is_empty(), "undescribed: {undescribed:?}");
}

#[test]
fn unknown_events_are_not_described() {
    assert_eq!(event_description("document.exploded"), None);
}
