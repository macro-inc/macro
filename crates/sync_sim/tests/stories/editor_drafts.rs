use super::*;

/// covers: S7:98
#[test]
fn initialization_removes_abandoned_drafts_once_and_preserves_published_marks() {
    let mut config = SimConfig::editor(827);
    config.seeds.insert(DocIx(0), SeedDocument::StoredEditor(serde_json::from_str(r#"{"root": {
        "type":"root","version":1,"format":"","indent":0,"direction":null,"$":{"id":"root","local":{"retained":true}},
        "children":[{"type":"paragraph","version":1,"format":"","indent":0,"direction":null,"textFormat":0,"textStyle":"","$":{"id":"paragraph"},"children":[
            {"type":"comment-mark","version":1,"format":"","indent":0,"direction":null,"ids":["abandoned"],"threadId":-1,"isDraft":true,"$":{"id":"draft"},"children":[
                {"type":"text","version":1,"text":"retained🦀","format":0,"detail":0,"mode":"normal","style":"","$":{"id":"draft-text"}}]},
            {"type":"comment-mark","version":1,"format":"","indent":0,"direction":null,"ids":["published"],"threadId":42,"isDraft":false,"$":{"id":"published"},"children":[
                {"type":"text","version":1,"text":"published text","format":0,"detail":0,"mode":"normal","style":"","$":{"id":"published-text"}}]}
        ]}]
    }}"#).expect("stored source JSON")));
    let mut reader = OpenSpec::form("reader", "two");
    reader.access = Access::Read;
    let readonly = verify(config.clone(), &[Step::Open(reader.clone()), Step::Settle]);
    assert_eq!(
        readonly.finals.servers[&DocIx(0)].deep_value["root"]["children"][0]["children"][0]["isDraft"],
        true
    );
    assert!(
        !readonly
            .events
            .iter()
            .any(|event| matches!(event.fact, Fact::LocalCommit { .. }))
    );
    let outcome = verify(
        config,
        &[
            Step::Open(OpenSpec::form("writer", "one")),
            Step::Open(reader),
            Step::Settle,
        ],
    );
    let raw = &outcome.finals.servers[&DocIx(0)].deep_value;
    assert_eq!(raw["root"]["$"]["local"]["retained"], true);
    let children = raw["root"]["children"][0]["children"].as_array().unwrap();
    assert_eq!(children.len(), 2);
    assert_eq!(children[0]["type"], "text");
    assert_eq!(children[0]["text"], "retained🦀");
    assert_eq!(children[1]["type"], "comment-mark");
    assert_eq!(children[1]["ids"], serde_json::json!(["published"]));
    assert_eq!(children[1]["isDraft"], false);
    assert_eq!(outcome.events.iter().filter(|event| matches!(&event.fact, Fact::LocalCommit { client, spans } if client.0 == "writer" && !spans.is_empty())).count(), 1);
    for client in outcome.finals.clients.values() {
        let state = &client.editor.as_ref().unwrap().synced_json;
        assert!(!state.to_string().contains("abandoned"));
        assert!(state.to_string().contains("published text"));
    }
}
