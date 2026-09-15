use super::*;
use serde_json::json;

fn event(method: &str, params: serde_json::Value) -> CloudEvent {
    CloudEvent {
        id: String::new(),
        method: method.into(),
        params,
    }
}

#[test]
fn provisional_tokens_are_replaced_by_completed_text_and_late_deltas_are_ignored() {
    let mut prose = Prose::default();
    let mut updates = Vec::new();
    for e in [
        event(
            "item/agentMessage/delta",
            json!({"itemId":"m","delta":" is"}),
        ),
        event(
            "item/agentMessage/delta",
            json!({"itemId":"m","delta":"**Codex**"}),
        ),
        event(
            "item/completed",
            json!({"item":{"id":"m","type":"agentMessage","text":"My name is **Codex**."}}),
        ),
        event(
            "item/agentMessage/delta",
            json!({"itemId":"m","delta":"My name"}),
        ),
        event(
            "item/completed",
            json!({"item":{"id":"m","type":"agentMessage","text":"My name is **Codex**."}}),
        ),
        event(
            "item/completed",
            json!({"item":{"id":"m","type":"agentMessage","text":"I'm **Codex**."}}),
        ),
    ] {
        updates.extend(prose.project(&e));
    }
    assert_eq!(updates.len(), 4);
    insta::assert_json_snapshot!(updates);
}

#[test]
fn poll_fallback_replaces_provisional_slot_and_terminal_clears_other_fragments() {
    let mut prose = Prose::default();
    let mut updates = Vec::new();
    for e in [
        event(
            "item/agentMessage/delta",
            json!({"itemId":"m1","delta":"bad prefix"}),
        ),
        event(
            "item/agentMessage/delta",
            json!({"itemId":"m2","delta":"another fragment"}),
        ),
        event(
            "item/completed",
            json!({"item":{"id":"poll-message:0","type":"agentMessage","text":"The only file is `.gitkeep`. 【F:.gitkeep†L1】"}}),
        ),
        event("session/turn_complete", json!({"status":"completed"})),
        event(
            "item/agentMessage/delta",
            json!({"itemId":"m1","delta":"late"}),
        ),
    ] {
        updates.extend(prose.project(&e));
    }
    assert_eq!(updates.len(), 4);
    insta::assert_json_snapshot!(updates);
}

#[test]
fn cancellation_clears_partial_text_and_new_turn_can_reuse_the_item_id() {
    let mut prose = Prose::default();
    let delta = event(
        "item/agentMessage/delta",
        json!({"itemId":"m","delta":"hello"}),
    );
    assert_eq!(prose.project(&delta).len(), 1);
    let cleared = prose.project(&event(
        "session/turn_complete",
        json!({"status":"cancelled"}),
    ));
    assert_eq!(
        serde_json::to_value(&cleared).unwrap()[0]["content"]["text"],
        ""
    );
    assert!(prose.project(&delta).is_empty());
    prose.project(&event("user/message", json!({"text":"again"})));
    assert_eq!(prose.project(&delta).len(), 1);
}

#[test]
fn split_citation_becomes_markdown_when_its_closing_delimiter_arrives() {
    let mut prose = Prose::default();
    prose.project(&event(
        "item/agentMessage/delta",
        json!({"itemId":"m","delta":"See 【F:.gitkeep†"}),
    ));
    let updates = prose.project(&event(
        "item/agentMessage/delta",
        json!({"itemId":"m","delta":"L1】"}),
    ));
    assert_eq!(
        serde_json::to_value(updates).unwrap()[0]["content"]["text"],
        "See `.gitkeep:1`"
    );
}

#[test]
fn repeated_and_corrected_poll_snapshots_keep_the_original_provisional_slot() {
    let mut prose = Prose::default();
    for id in ["m1", "m2"] {
        prose.project(&event(
            "item/agentMessage/delta",
            json!({"itemId":id,"delta":"provisional"}),
        ));
    }
    let completed = event(
        "item/completed",
        json!({"item":{"id":"poll-message:0","type":"agentMessage","text":"answer"}}),
    );
    let first = prose.project(&completed);
    assert_eq!(first.len(), 1);
    assert!(prose.project(&completed).is_empty());
    let corrected = prose.project(&event(
        "item/completed",
        json!({"item":{"id":"poll-message:0","type":"agentMessage","text":"corrected answer"}}),
    ));
    assert_eq!(corrected.len(), 1);
    assert_eq!(
        serde_json::to_value(&first).unwrap()[0]["_meta"],
        serde_json::to_value(&corrected).unwrap()[0]["_meta"]
    );
}
