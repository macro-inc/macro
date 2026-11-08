use super::*;
use lexical_model::*;

#[test]
fn encoded_handles_survive_suspension_and_keep_committed_fields() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut host = Context::default();
    let create = super::super::index()
        .binary_search(&"lexical.$createTextNode")
        .expect("create") as u32;
    let create_p = super::super::index()
        .binary_search(&"lexical.$createParagraphNode")
        .expect("paragraph") as u32;
    let root = super::super::index()
        .binary_search(&"lexical.$getRoot")
        .expect("root") as u32;
    let append = super::super::index()
        .binary_search(&"LexicalNode.append")
        .expect("append") as u32;
    let content = super::super::index()
        .binary_search(&"LexicalNode.getTextContent")
        .expect("content") as u32;
    let latest = super::super::index()
        .binary_search(&"LexicalNode.getLatest")
        .expect("latest") as u32;
    let writable = super::super::index()
        .binary_search(&"LexicalNode.getWritable")
        .expect("writable") as u32;
    let set = super::super::index()
        .binary_search(&"LexicalNode.setTextContent")
        .expect("set") as u32;
    let mut tx = editor.transaction();
    host.begin_update(&mut tx)?;
    let text = host.call(&mut tx, create, json!(["a"]), None)?;
    assert_eq!(text, json!({"$h":0,"key":"1","type":"text","ver":1}));
    let pending = tx.suspend();
    let mut tx = editor.resume(pending)?;
    let paragraph = host.call(&mut tx, create_p, json!([]), None)?;
    host.call(&mut tx, append, json!([text]), Some(paragraph.clone()))?;
    let root = host.call(&mut tx, root, json!([]), None)?;
    host.call(&mut tx, append, json!([paragraph]), Some(root))?;
    assert_eq!(
        host.call(&mut tx, latest, json!([]), Some(json!({"$h":0})))?,
        json!({"$h":0})
    );
    tx.flush()?;
    host.finish_update(&tx)?;
    let commit = tx.commit()?;
    assert_eq!(host.publish(commit.next)?, 1);
    host.release_version(1)?;
    let mut tx = editor.transaction();
    host.begin_update(&mut tx)?;
    assert!(host.read_field(&mut tx, 0, "__text").is_err());
    let get_by_key = super::super::index()
        .binary_search(&"lexical.$getNodeByKey")
        .expect("get node") as u32;
    let recaptured = host.call(&mut tx, get_by_key, json!(["1"]), None)?;
    assert_eq!(recaptured["ver"], 1);
    let recaptured_id = recaptured["$h"].as_u64().expect("handle") as u32;
    let new_text = host.call(&mut tx, writable, json!([]), Some(recaptured.clone()))?;
    assert_eq!(new_text["key"], "1");
    assert_eq!(new_text["ver"], 2);
    assert_ne!(new_text["$h"], 0);
    assert_eq!(
        host.call(&mut tx, writable, json!([]), Some(recaptured.clone()))?,
        json!({"$h":new_text["$h"]})
    );
    host.call(&mut tx, set, json!(["b"]), Some(new_text))?;
    assert_eq!(
        host.call(&mut tx, content, json!([]), Some(recaptured))?,
        "b"
    );
    assert_eq!(host.read_field(&mut tx, recaptured_id, "__text")?, "a");
    assert!(host.release_version(2).is_err());
    assert!(host.release_version(1).is_err());
    assert_eq!(host.read_field(&mut tx, recaptured_id, "__text")?, "a");
    drop(tx);
    host.discard_update()?;
    host.release_version(1)?;
    let mut tx = editor.transaction();
    assert!(host.read_field(&mut tx, recaptured_id, "__text").is_err());
    Ok(())
}

#[test]
fn selections_and_points_keep_identity_across_suspended_calls() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut host = Context::default();
    let create = super::super::index()
        .binary_search(&"lexical.$createRangeSelection")
        .expect("create") as u32;
    let set = super::super::index()
        .binary_search(&"lexical.$setSelection")
        .expect("set") as u32;
    let get = super::super::index()
        .binary_search(&"lexical.$getSelection")
        .expect("get") as u32;
    let anchor = super::super::index()
        .binary_search(&"get:anchor")
        .expect("anchor") as u32;
    let point_set = super::super::index()
        .binary_search(&"Selection.set")
        .expect("point set") as u32;
    let offset = super::super::index()
        .binary_search(&"get:offset")
        .expect("offset") as u32;
    let mut tx = editor.transaction();
    assert!(host.call(&mut tx, create, json!([]), None).is_err());
    host.begin_update(&mut tx)?;
    assert!(host.begin_update(&mut tx).is_err());
    let selection = host.call(&mut tx, create, json!([]), None)?;
    assert_eq!(selection, json!({"$sel":0,"kind":"range"}));
    host.call(&mut tx, set, json!([selection]), None)?;
    assert_eq!(host.call(&mut tx, get, json!([]), None)?, json!({"$sel":0}));
    let point = host.call(&mut tx, anchor, json!([]), Some(json!({"$sel":0})))?;
    assert_eq!(point, json!({"$pt":1}));
    let pending = tx.suspend();
    let mut tx = editor.resume(pending)?;
    host.call(
        &mut tx,
        point_set,
        json!(["root", 0, "element"]),
        Some(point),
    )?;
    assert_eq!(
        host.call(&mut tx, anchor, json!([]), Some(json!({"$sel":0})))?,
        json!({"$pt":1})
    );
    assert_eq!(
        host.call(&mut tx, offset, json!([]), Some(json!({"$pt":1})))?,
        0
    );
    tx.flush()?;
    host.finish_update(&tx)?;
    let commit = tx.commit()?;
    host.publish(commit.next)?;
    let mut tx = editor.transaction();
    host.begin_update(&mut tx)?;
    assert_eq!(
        host.call(&mut tx, get, json!([]), None)?,
        json!({"$sel":2,"kind":"range"})
    );
    assert_eq!(
        host.call(&mut tx, offset, json!([]), Some(json!({"$pt":1})))?,
        0
    );
    Ok(())
}

#[test]
fn discarded_updates_invalidate_handles_and_burn_their_allocated_keys() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut host = Context::default();
    let create = super::super::index()
        .binary_search(&"lexical.$createTextNode")
        .expect("create") as u32;
    let mut tx = editor.transaction();
    host.begin_update(&mut tx)?;
    let abandoned = host.call(&mut tx, create, json!(["abandoned"]), None)?;
    assert_eq!(abandoned["key"], "1");
    host.finish_update(&tx)?;
    assert!(host.begin_update(&mut tx).is_err());
    drop(tx);
    host.discard_update()?;
    assert!(host.discard_update().is_err());
    let mut tx = editor.transaction();
    host.begin_update(&mut tx)?;
    assert!(
        host.read_field(
            &mut tx,
            abandoned["$h"].as_u64().expect("handle") as u32,
            "__text"
        )
        .is_err()
    );
    let next = host.call(&mut tx, create, json!(["next"]), None)?;
    assert_eq!(next["key"], "2");
    assert_eq!(next["ver"], 2);
    assert_ne!(next["$h"], abandoned["$h"]);
    assert!(host.publish(tx.committed_state().clone()).is_err());
    drop(tx);
    host.discard_update()?;
    Ok(())
}

#[test]
fn publication_refreshes_editor_state_handles_and_release_drops_saved_snapshots() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut host = Context::default();
    let state = super::super::index()
        .binary_search(&"LexicalEditor.getEditorState")
        .expect("state") as u32;
    let mut tx = editor.transaction();
    host.begin_update(&mut tx)?;
    let initial = host.call(&mut tx, state, json!([]), None)?;
    assert_eq!(initial, json!({"$state":0}));
    host.finish_update(&tx)?;
    let commit = tx.commit()?;
    host.publish(commit.next)?;
    let mut tx = editor.transaction();
    host.begin_update(&mut tx)?;
    let published = host.call(&mut tx, state, json!([]), None)?;
    assert_eq!(published, json!({"$state":1}));
    host.release_version(0)?;
    assert!(host.replay.saved_states[0].is_none());
    assert!(host.replay.saved_states[1].is_some());
    assert!(host.replay.decode(&initial).is_err());
    assert!(host.replay.decode(&published).is_ok());
    Ok(())
}

#[test]
fn first_seen_committed_root_and_its_writable_record_have_distinct_versions() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut host = Context::default();
    let root = super::super::index()
        .binary_search(&"lexical.$getRoot")
        .expect("root") as u32;
    let writable = super::super::index()
        .binary_search(&"LexicalNode.getWritable")
        .expect("writable") as u32;
    let mut tx = editor.transaction();
    host.begin_update(&mut tx)?;
    let committed = host.call(&mut tx, root, json!([]), None)?;
    assert_eq!(
        committed,
        json!({"$h":0,"key":"root","type":"root","ver":0})
    );
    let pending = host.call(&mut tx, writable, json!([]), Some(committed))?;
    assert_eq!(pending, json!({"$h":1,"key":"root","type":"root","ver":1}));
    assert_eq!(
        host.call(&mut tx, writable, json!([]), Some(json!({"$h":1})))?,
        json!({"$h":1})
    );
    Ok(())
}
