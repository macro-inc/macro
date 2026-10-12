use super::*;

pub(super) mod admission;

#[test]
fn slack_gather_lists_channels_with_an_explicit_empty_query() {
    let prompt = prompts::gather_system();

    assert!(prompt.contains("FIRST call `Search channels`"));
    assert!(prompt.contains(r#"{"query": ""}"#));
    assert!(prompt.contains("an empty query lists all channels"));
    assert!(!prompt.contains("Always pass a non-empty query"));
    assert!(prompt.contains("Participant details are optional"));
}
