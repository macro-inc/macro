use super::*;
use lexical_model::{Editor, EditorMode, KeySource, NodeKey, SharedKeyCounter};
use macro_document_model::nodes::CursorSystemNotificationNode;

#[test]
fn retained_notification_own_fields_follow_the_captured_editor() -> Result<()> {
    let keys = SharedKeyCounter::default();
    let mut first = Editor::builder(EditorMode::Headless)
        .key_source(KeySource::Shared(keys.clone()))
        .node::<CursorSystemNotificationNode>()
        .build()
        .expect("first editor");
    let mut second = Editor::builder(EditorMode::Headless)
        .key_source(KeySource::Shared(keys))
        .node::<CursorSystemNotificationNode>()
        .build()
        .expect("second editor");
    let mut tx = first.transaction();
    let left = tx.create(CursorSystemNotificationNode {
        text: "first notification".into(),
        source: "source-a".into(),
        attributes: [("kind".into(), "first".into())].into(),
    })?;
    tx.append(NodeKey::ROOT, &[left.into()])?;
    tx.commit()?;
    let mut tx = second.transaction();
    let right = tx.create(CursorSystemNotificationNode {
        text: "second notification".into(),
        source: "source-b".into(),
        attributes: [("kind".into(), "second".into())].into(),
    })?;
    tx.append(NodeKey::ROOT, &[right.into()])?;
    tx.commit()?;
    assert_eq!(left.key().index(), 1);
    assert_eq!(right.key().index(), 2);
    assert!(!first.state().view().contains(right));
    let mut replay = Replayer {
        editor_id: 0,
        version: 1,
        committed_version: 1,
        ..Replayer::default()
    };
    replay
        .bindings
        .pin_editor_state(0, 1, first.state().clone())?;
    replay
        .bindings
        .pin_editor_state(1, 1, second.state().clone())?;
    let saved = replay
        .bindings
        .published_editor_state(1, 1, second.state())?;
    let mut active = first.transaction();
    replay.execute(
        &json!({
            "op":"read", "editor":0, "state":{"$snapshot":saved},
            "calls":[
                {"op":"call", "fn":"lexical.$getRoot", "args":[],
                 "ret":{"$h":0,"key":"root","type":"root","ver":1}},
                {"op":"call", "fn":"RootNode.getChildren", "this":{"$h":0},
                 "args":[], "ret":[{"$h":1,"key":"2","type":"system-notification","ver":1}]}
            ]
        }),
        &mut active,
    )?;
    assert!(replay.read_state.is_none());
    let retained = replay.decode(&json!({"$h":1}))?;
    assert_eq!(retained["editor"], 1);
    assert_eq!(
        crate::api::nodes::call(&mut replay, &mut active, &retained, "getText", &[])?,
        json!("second notification")
    );
    assert_eq!(
        crate::api::nodes::call(&mut replay, &mut active, &retained, "getSource", &[])?,
        json!("source-b")
    );
    assert_eq!(
        crate::api::nodes::call(&mut replay, &mut active, &retained, "getAttributes", &[])?,
        json!({"kind":"second"})
    );
    assert!(
        crate::api::nodes::call(&mut replay, &mut active, &retained, "getLatest", &[]).is_err()
    );
    assert!(!active.view().contains(right));
    Ok(())
}
