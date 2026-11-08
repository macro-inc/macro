use super::*;
use lexical_model::*;
use serde_json::json;

#[test]
fn host_calls_publish_only_at_commit_and_keep_caught_errors_inside_the_update() -> Result<()> {
    let editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut host = Session::new(editor);
    let root = super::super::index()
        .binary_search(&"lexical.$getRoot")
        .expect("root") as u32;
    let paragraph = super::super::index()
        .binary_search(&"lexical.$createParagraphNode")
        .expect("paragraph") as u32;
    let text = super::super::index()
        .binary_search(&"lexical.$createTextNode")
        .expect("text") as u32;
    let append = super::super::index()
        .binary_search(&"LexicalNode.append")
        .expect("append") as u32;
    let content = super::super::index()
        .binary_search(&"LexicalNode.getTextContent")
        .expect("content") as u32;
    assert!(host.call(text, json!(["outside"]), None).is_err());
    let mut tags = TagSet::default();
    tags.insert("host-update".parse().expect("tag"));
    host.begin_update(tags)?;
    assert!(host.begin_update(TagSet::default()).is_err());
    let root = host.call(root, json!([]), None)?;
    let p = host.call(paragraph, json!([]), None)?;
    let t = host.call(text, json!(["hello 🌍"]), None)?;
    host.call(append, json!([t]), Some(p.clone()))?;
    host.call(append, json!([p]), Some(root))?;
    assert!(host.call(u32::MAX, json!([]), None).is_err());
    host.flush()?;
    assert_eq!(host.state().root_text_content().as_ref(), "");
    assert_eq!(
        host.call(content, json!([]), Some(json!({"$h":2})))?,
        "hello 🌍"
    );
    let commit = host.commit()?;
    assert!(commit.tags.contains(&"host-update".parse().expect("tag")));
    assert_eq!(commit.next.root_text_content().as_ref(), "hello 🌍");
    assert_eq!(host.state().root_text_content().as_ref(), "hello 🌍");
    assert_eq!(host.read_field(2, "__text")?, "hello 🌍");
    assert!(host.commit().is_err());
    assert!(host.flush().is_err());
    Ok(())
}

#[test]
fn host_rollback_invalidates_handles_and_does_not_reuse_global_keys() -> Result<()> {
    let keys = SharedKeyCounter::new();
    let editor = Editor::builder(EditorMode::Headless)
        .key_source(KeySource::Shared(keys.clone()))
        .build()
        .expect("editor");
    let other = Editor::builder(EditorMode::Headless)
        .key_source(KeySource::Shared(keys))
        .build()
        .expect("other editor");
    let mut host = Session::new(editor);
    let mut other = Session::new(other);
    let create = super::super::index()
        .binary_search(&"lexical.$createTextNode")
        .expect("text") as u32;
    host.begin_update(TagSet::default())?;
    let abandoned = host.call(create, json!(["abandoned"]), None)?;
    assert_eq!(abandoned["key"], "1");
    host.discard_update()?;
    assert!(host.read_field(0, "__text").is_err());
    assert!(host.discard_update().is_err());
    other.begin_update(TagSet::default())?;
    let second = other.call(create, json!(["other"]), None)?;
    assert_eq!(second["key"], "2");
    host.begin_update(TagSet::default())?;
    let third = host.call(create, json!(["next"]), None)?;
    assert_eq!(third["key"], "3");
    assert_eq!(host.state().root_text_content().as_ref(), "");
    host.discard_update()?;
    other.discard_update()?;
    Ok(())
}

#[test]
fn stale_resumption_discards_host_bookkeeping_and_allows_a_new_update() -> Result<()> {
    let editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut host = Session::new(editor);
    let create = super::super::index()
        .binary_search(&"lexical.$createTextNode")
        .expect("text") as u32;
    host.begin_update(TagSet::default())?;
    host.call(create, json!(["stale"]), None)?;
    host.editor.transaction().commit()?;
    assert!(matches!(
        host.call(create, json!(["lost"]), None),
        Err(crate::replay::ReplayError::Model(
            Error::StaleSuspendedUpdate
        ))
    ));
    assert!(host.pending.is_none());
    assert!(host.read_field(0, "__text").is_err());
    host.begin_update(TagSet::default())?;
    let next = host.call(create, json!(["new"]), None)?;
    assert_eq!(next["key"], "2");
    assert_eq!(
        host.read_field(next["$h"].as_u64().expect("handle") as u32, "__text")?,
        "new"
    );
    host.discard_update()?;
    Ok(())
}

#[test]
fn commit_transform_failure_rolls_back_writes_and_invalidates_only_pending_handles() -> Result<()> {
    struct Reject;
    impl ForeignTransform for Reject {
        fn transform(
            &self,
            tx: &mut Transaction<'_>,
            key: NodeKey,
        ) -> std::result::Result<(), Error> {
            tx.text(key)?.set_text_content("rejected")?;
            Err(Error::NodeNotFound(key))
        }
    }
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?.key();
        let text = tx.create_text("before")?.key();
        tx.append(p, &[text])?;
        tx.append(NodeKey::ROOT, &[p])
    })?;
    let reject = editor.register_foreign_transform("text", std::sync::Arc::new(Reject))?;
    let mut host = Session::new(editor);
    let root = super::super::index()
        .binary_search(&"lexical.$getRoot")
        .expect("root") as u32;
    let children = super::super::index()
        .binary_search(&"LexicalNode.getChildren")
        .expect("children") as u32;
    let set = super::super::index()
        .binary_search(&"LexicalNode.setTextContent")
        .expect("set") as u32;
    host.begin_update(TagSet::default())?;
    let root = host.call(root, json!([]), None)?;
    let p = host.call(children, json!([]), Some(root))?[0].clone();
    let text = host.call(children, json!([]), Some(p))?[0].clone();
    let writable = host.call(set, json!(["changed"]), Some(text.clone()))?;
    assert_ne!(writable["$h"], text["$h"]);
    assert!(matches!(
        host.commit(),
        Err(crate::replay::ReplayError::Model(Error::NodeNotFound(_)))
    ));
    assert_eq!(host.state().root_text_content().as_ref(), "before");
    assert_eq!(
        host.read_field(text["$h"].as_u64().expect("handle") as u32, "__text")?,
        "before"
    );
    assert!(
        host.read_field(writable["$h"].as_u64().expect("handle") as u32, "__text")
            .is_err()
    );
    host.editor.unregister_foreign_transform(reject);
    host.begin_update(TagSet::default())?;
    host.call(set, json!(["after"]), Some(text))?;
    host.commit()?;
    assert_eq!(host.state().root_text_content().as_ref(), "after");
    Ok(())
}
