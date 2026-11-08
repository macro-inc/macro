use super::*;

#[test]
fn associated_reads_start_empty_and_reject_unknown_versions() -> Result<()> {
    let editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut host = Session::new(editor);
    let root = crate::api::index()
        .binary_search(&"lexical.$getRoot")
        .expect("root") as u32;
    let content = crate::api::index()
        .binary_search(&"LexicalNode.getTextContent")
        .expect("text") as u32;
    host.read_state(0, |read| {
        let root = read.call(root, json!([]), None)?;
        assert_eq!(read.call(content, json!([]), Some(root))?, "");
        Ok(())
    })?;
    assert_eq!(host.committed_version(), 0);
    assert!(host.read_state(1, |_| Ok(())).is_err());
    assert!(host.pending.is_none());
    Ok(())
}

#[test]
fn historical_reads_restore_authority_and_preserve_pending_writes() -> Result<()> {
    let editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut host = Session::new(editor);
    let index = crate::api::index();
    let root = index.binary_search(&"lexical.$getRoot").expect("root") as u32;
    let content = index
        .binary_search(&"LexicalNode.getTextContent")
        .expect("content") as u32;
    let selection = index
        .binary_search(&"lexical.$getSelection")
        .expect("selection") as u32;
    let previous = index
        .binary_search(&"lexical.$getPreviousSelection")
        .expect("previous") as u32;
    let anchor = index.binary_search(&"get:anchor").expect("anchor") as u32;
    let offset = index.binary_search(&"get:offset").expect("offset") as u32;
    let create = index
        .binary_search(&"lexical.$createTextNode")
        .expect("create") as u32;
    host.begin_update(TagSet::default())?;
    let text = host.with_update(|_, tx| {
        let paragraph = tx.create(Paragraph::default())?.key();
        let text = tx.create_text("first")?.key();
        tx.append(paragraph, &[text])?;
        tx.append(NodeKey::ROOT, &[paragraph])?;
        tx.text(text)?
            .select(Some(Utf16Offset(1)), Some(Utf16Offset(1)))?;
        Ok(text)
    })?;
    host.commit()?;
    let first = host.committed_version();
    host.begin_update(TagSet::default())?;
    host.with_update(|_, tx| {
        tx.text(text)?.set_text_content("second")?;
        tx.text(text)?
            .select(Some(Utf16Offset(2)), Some(Utf16Offset(2)))?;
        Ok(())
    })?;
    host.commit()?;
    let second = host.committed_version();
    let (old_selection, previous_point) = host.read_state(first, |read| {
        let node = read.call(root, json!([]), None)?;
        assert_eq!(read.call(content, json!([]), Some(node.clone()))?, "first");
        let old = read.call(selection, json!([]), None)?;
        let point = read.call(anchor, json!([]), Some(old.clone()))?;
        assert_eq!(read.call(offset, json!([]), Some(point))?, 1);
        let latest = read.call(previous, json!([]), None)?;
        let point = read.call(anchor, json!([]), Some(latest))?;
        assert_eq!(read.call(offset, json!([]), Some(point.clone()))?, 2);
        assert!(read.call(create, json!(["forbidden"]), None).is_err());
        assert!(read.with_state_read(999, |_| Ok(())).is_err());
        let nested: Result<()> = read.with_state_read(second, |nested| {
            let node = nested.call(root, json!([]), None)?;
            assert_eq!(nested.call(content, json!([]), Some(node))?, "second");
            Err(fail("caught nested read"))
        });
        assert!(nested.is_err());
        assert_eq!(read.call(content, json!([]), Some(node))?, "first");
        Ok((old, point))
    })?;
    host.release_version(first)?;
    host.read_state(second, |read| {
        assert_eq!(read.call(offset, json!([]), Some(previous_point))?, 2);
        assert!(read.call(anchor, json!([]), Some(old_selection)).is_err());
        Ok(())
    })?;
    assert!(host.read_state(first, |_| Ok(())).is_err());
    host.begin_update(TagSet::default())?;
    host.with_update(|_, tx| {
        tx.text(text)?.set_text_content("pending")?;
        Ok(())
    })?;
    host.read_state(second, |read| {
        let node = read.call(root, json!([]), None)?;
        assert_eq!(read.call(content, json!([]), Some(node))?, "second");
        Ok(())
    })?;
    assert_eq!(host.committed_version(), second);
    host.with_update(|_, tx| {
        assert_eq!(tx.view().text_content(text), "pending");
        Ok(())
    })?;
    host.commit()?;
    Ok(())
}

#[test]
fn retained_read_values_survive_pending_rollback_without_reusing_selection_ids() -> Result<()> {
    let editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut host = Session::new(editor);
    let index = crate::api::index();
    let create = index
        .binary_search(&"lexical.$createRangeSelection")
        .expect("create") as u32;
    let anchor = index.binary_search(&"get:anchor").expect("anchor") as u32;
    let offset = index.binary_search(&"get:offset").expect("offset") as u32;
    let set = index.binary_search(&"Selection.set").expect("set") as u32;
    host.begin_update(TagSet::default())?;
    let abandoned = host.call(create, json!([]), None)?;
    let (selection, point) = host.read_state(0, |read| {
        let selection = read.call(create, json!([]), None)?;
        let point = read.call(anchor, json!([]), Some(selection.clone()))?;
        read.call(set, json!(["root", 4, "element"]), Some(point.clone()))?;
        Ok((selection, point))
    })?;
    host.discard_update()?;
    host.begin_update(TagSet::default())?;
    let fresh = host.call(create, json!([]), None)?;
    assert_ne!(fresh["$sel"], selection["$sel"]);
    assert!(host.call(anchor, json!([]), Some(abandoned)).is_err());
    assert_eq!(host.call(offset, json!([]), Some(point.clone()))?, 4);
    assert_eq!(host.call(anchor, json!([]), Some(selection))?, point);
    host.discard_update()?;
    Ok(())
}
