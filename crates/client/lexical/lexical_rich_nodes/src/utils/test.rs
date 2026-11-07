use super::*;
#[test]
fn root_insertion_splits_text_and_snapshot_restore_allows_further_edits() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut text_key = NodeKey::ROOT;
    editor.update(|tx| {
        let p = tx.create(Paragraph {})?;
        let text = tx.create_text("abcd")?;
        text_key = text.key();
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.select_start(text)?;
        Ok(())
    })?;
    let saved = editor.state().clone();
    let commit = editor.update(|tx| {
        tx.set_text_node_range(text_key, Utf16Offset(2), text_key, Utf16Offset(2))?;
        let block = tx.create(Paragraph {})?;
        insert_node_to_nearest_root(tx, block.key())?;
        assert_eq!(tx.children_size(NodeKey::ROOT), 3);
        assert_eq!(tx.text_content(NodeKey::ROOT), "ab\n\n\n\ncd");
        restore_editor_state(tx, &saved)?;
        tx.text(text_key)?.set_text_content("restored")?;
        assert_eq!(tx.children_size(NodeKey::ROOT), 1);
        Ok(())
    })?;
    assert!(commit.1.full_reconcile);
    assert_eq!(editor.state().text_content(NodeKey::ROOT), "restored");
    Ok(())
}

#[test]
fn restoring_unchanged_snapshot_clones_records_and_keeps_composition() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let (text, _) = editor.update(|tx| {
        let p = tx.create(Paragraph {})?;
        let text = tx.create_text("value")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.select_end(text)?;
        Ok(text.key())
    })?;
    let saved = editor.state().clone();
    let (_, commit) = editor.update(|tx| {
        tx.set_composition_key(Some(text))?;
        restore_editor_state(tx, &saved)?;
        assert_eq!(tx.composition_key(), Some(text));
        Ok(())
    })?;
    assert!(commit.full_reconcile);
    assert_eq!(
        commit.changes.mutations.get(&text),
        Some(&Mutation::Updated)
    );
    assert_eq!(
        commit.changes.mutations.get(&NodeKey::ROOT),
        Some(&Mutation::Updated)
    );
    Ok(())
}
