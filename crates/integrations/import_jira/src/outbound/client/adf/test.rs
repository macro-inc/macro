use super::*;
use serde_json::json;

#[test]
fn preserves_formatting_lists_links_and_unknown_containers() {
    let value = json!({"type":"doc","content":[
        {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Plan"}]},
        {"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Read docs","marks":[{"type":"link","attrs":{"href":"https://example.com"}}]}]}]}]},
        {"type":"futureContainer","content":[{"type":"text","text":"Keep this"}]},
        {"type":"media","attrs":{"id":"attachment-1"}}
    ]});
    assert_eq!(
        markdown(&value),
        "## Plan\n\n- [Read docs](https://example.com)\n\nKeep this[Jira attachment: attachment-1]"
    );
}
