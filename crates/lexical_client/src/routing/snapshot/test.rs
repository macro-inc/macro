use super::*;
use macro_document_model::snapshot::markdown_to_loro_snapshot;
fn snapshot(input: &str) -> Vec<u8> {
    markdown_to_loro_snapshot(input, &crate::in_process::context()).unwrap()
}
#[test]
fn independent_peers_and_generated_ids_keep_raw_and_structural_metrics_distinct() {
    let a = snapshot("Hello **world**");
    let b = snapshot("Hello **world**");
    assert_ne!(a, b);
    let input = SnapshotInput {
        markdown: "Hello **world**".into(),
        notion: None,
    };
    assert!(compatible(&input, json!(a), json!(b)).unwrap());
}
#[test]
fn content_format_and_order_differences_remain_mismatches() {
    let input = SnapshotInput {
        markdown: "Hello **world**".into(),
        notion: None,
    };
    let a = snapshot(&input.markdown);
    for changed in ["Hello world", "Hello **other**", "**world** Hello"] {
        assert!(!matches!(
            compatible(&input, json!(a), json!(snapshot(changed))),
            Ok(true)
        ));
    }
}
#[test]
fn malformed_bytes_and_lost_ancestry_never_compare_equal() {
    let input = SnapshotInput {
        markdown: "Hello".into(),
        notion: None,
    };
    assert!(compatible(&input, json!([1, 2, 3]), json!([1, 2, 3])).is_err());
    let bytes = lexical_loro::snapshot::raw_state_to_loro_snapshot(
        &json!({"root":{"type":"root","children":[]}}),
        None,
    )
    .unwrap();
    assert!(compatible(&input, json!(bytes), json!(bytes)).is_err());
}
#[test]
fn normalization_is_bijective_and_never_rewrites_payloads_or_authored_values() {
    let mut a =
        json!({"first":"aaaaaaaa","second":"bbbbbbbb","text":"aaaaaaaa","authored":"fixed"});
    let mut b =
        json!({"first":"cccccccc","second":"cccccccc","text":"aaaaaaaa","authored":"fixed"});
    let generated = [
        Field {
            path: vec![Segment::Key("first".into())],
            kind: Generated::Id,
        },
        Field {
            path: vec![Segment::Key("second".into())],
            kind: Generated::Id,
        },
    ];
    assert!(normalize(&mut a, &mut b, &generated).is_err());
    let mut a = json!({"first":"aaaaaaaa","text":"aaaaaaaa","authored":"fixed"});
    let mut b = json!({"first":"cccccccc","text":"cccccccc","authored":"fixed"});
    normalize(&mut a, &mut b, &generated[..1]).unwrap();
    assert_ne!(a, b);
    let mut found = Vec::new();

    fields(
        &json!({"type":"document-mention","createdAt":42,"$":{"id":"authored"}}),
        &json!({"type":"document-mention","createdAt":42,"$":{"id":"authored"}}),
        &mut Vec::new(),
        &mut found,
    );
    assert!(found.is_empty());
}
#[test]
fn frozen_ancestor_requires_exact_bytes_and_notion_markdown_is_exact() {
    let input = SnapshotInput {
        markdown: "".into(),
        notion: None,
    };
    assert!(
        compatible(
            &input,
            json!(lexical_loro::golden::MARKDOWN_GOLDEN),
            json!(lexical_loro::golden::MARKDOWN_GOLDEN)
        )
        .unwrap()
    );
    assert!(!compatible(&input, json!(snapshot(" ")), json!(snapshot(" "))).unwrap());
    let input = SnapshotInput {
        markdown: "Hello".into(),
        notion: Some(Default::default()),
    };
    let a = json!({"snapshot":snapshot("Hello"),"markdown":"Hello"});
    let b = json!({"snapshot":snapshot("Hello"),"markdown":"Changed"});
    assert!(compatible(&input, a, b).is_err());
}
