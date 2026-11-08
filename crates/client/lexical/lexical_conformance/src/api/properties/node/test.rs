use super::*;
use lexical_rich_nodes::link::{AutoLinkNode, LinkNode};

#[test]
fn inherited_link_fields_remain_readable_from_live_and_retired_raw_records() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<LinkNode>()
        .node::<AutoLinkNode>()
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let key = tx
        .create(AutoLinkNode {
            link: LinkNode {
                url: "https://example.com".into(),
                target: Some("_blank".into()),
                rel: Some("noopener".into()),
                title: Some("example".into()),
            },
            is_unlinked: false,
        })?
        .key();
    let receiver = json!({"$node": key.to_string(), "ver":1});
    assert_eq!(
        get(tx.node_or_err(key)?, &receiver, "__url")?,
        "https://example.com"
    );
    assert_eq!(get(tx.node_or_err(key)?, &receiver, "__target")?, "_blank");
    tx.flush()?;
    assert!(!tx.contains(key));
    let record = tx.retired_record(key).expect("retired auto link");
    assert_eq!(get(record, &receiver, "__url")?, "https://example.com");
    assert_eq!(get(record, &receiver, "__rel")?, "noopener");
    assert_eq!(get(record, &receiver, "__title")?, "example");
    Ok(())
}

#[test]
fn retired_raw_fields_stay_with_their_editor_when_keys_and_versions_match() -> Result<()> {
    let mut first = Editor::builder(EditorMode::Headless)
        .build()
        .expect("first editor");
    let mut second = Editor::builder(EditorMode::Headless)
        .build()
        .expect("second editor");
    let mut first_tx = first.transaction();
    let mut second_tx = second.transaction();
    let first_key = first_tx.create_text("first")?.key();
    let second_key = second_tx.create_text("second")?.key();
    assert_eq!(first_key, second_key);
    let first_receiver = json!({"$node": first_key.index(), "generation":first_key.generation(), "ver":1, "editor":1});
    let second_receiver = json!({"$node": second_key.index(), "generation":second_key.generation(), "ver":1, "editor":2});
    let replay = crate::replay::Replayer::default();
    replay
        .bindings
        .bind_handle("first".into(), first_receiver.clone())?;
    replay
        .bindings
        .bind_handle("second".into(), second_receiver.clone())?;
    first_tx.flush()?;
    second_tx.flush()?;
    replay.bindings.capture_retired_records(&first_tx, 1, 1)?;
    replay.bindings.capture_retired_records(&second_tx, 2, 1)?;
    assert_eq!(
        super::super::with_captured_record(&replay, &first_tx, &first_receiver, |node| get(
            node,
            &first_receiver,
            "__text"
        ))?,
        "first"
    );
    assert_eq!(
        super::super::with_captured_record(&replay, &second_tx, &second_receiver, |node| get(
            node,
            &second_receiver,
            "__text"
        ))?,
        "second"
    );
    replay.bindings.release_editor_state(1, 1)?;
    assert!(replay.bindings.retired_record(1, 1, first_key)?.is_none());
    assert!(replay.bindings.retired_record(2, 1, second_key)?.is_some());
    Ok(())
}
