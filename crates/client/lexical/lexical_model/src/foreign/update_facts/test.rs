use super::*;

#[test]
fn captured_facts_keep_actual_intent_and_survive_nested_read_peers() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let ((p, t), _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let t = tx.create_text("before")?;
        tx.append(p, &[t.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok((p.key(), t.key()))
    })?;
    let committed = editor.state().clone();
    assert_eq!(
        *committed.view().foreign_update_facts(),
        ForeignUpdateFacts::default()
    );
    let mut tx = editor.transaction();
    tx.text(t)?.set_text_content("after")?;
    tx.set_indent(p, 1)?;
    tx.set_composition_key(Some(t))?;
    let source = tx.view().snapshot_for_foreign_read()?;
    assert_eq!(
        source.update_facts(),
        &ForeignUpdateFacts {
            dirty_type: ForeignDirtyType::Nodes,
            dirty_leaves: vec![t],
            dirty_elements: vec![
                (p, DirtyIntent::Intentional),
                (NodeKey::ROOT, DirtyIntent::AncestorOfDirty)
            ],
        }
    );
    source.with_read_transaction(&committed, |peer| -> Result<(), Error> {
        assert!(!peer.has_dirty_nodes());
        assert_eq!(*peer.view().foreign_update_facts(), *source.update_facts());
        assert_eq!(peer.composition_key(), Some(t));
        let nested = peer.view().snapshot_for_foreign_read()?;
        assert_eq!(nested.update_facts(), source.update_facts());
        nested.with_read_transaction(&committed, |nested_peer| -> Result<(), Error> {
            assert!(!nested_peer.has_dirty_nodes());
            assert_eq!(
                *nested_peer.view().foreign_update_facts(),
                *source.update_facts()
            );
            assert_eq!(nested_peer.composition_key(), Some(t));
            Ok(())
        })??;
        Ok(())
    })??;
    let captured = source.clone();
    tx.request_full_reconcile();
    assert_eq!(
        tx.view().foreign_update_facts().dirty_type,
        ForeignDirtyType::FullReconcile
    );
    assert_eq!(captured.update_facts().dirty_type, ForeignDirtyType::Nodes);
    let staged = tx.suspend();
    let tx = editor.resume(staged)?;
    assert_eq!(
        tx.view().foreign_update_facts().dirty_type,
        ForeignDirtyType::FullReconcile
    );
    tx.commit()?;
    assert_eq!(
        *editor.state().view().foreign_update_facts(),
        ForeignUpdateFacts::default()
    );
    Ok(())
}

#[test]
fn historical_graph_with_update_context_keeps_context_facts() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let ((p, t), _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let t = tx.create_text("old")?;
        tx.append(p, &[t.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok((p.key(), t.key()))
    })?;
    let old = editor.state().clone();
    let originless = old.view().snapshot_for_foreign_read()?;
    let mut tx = editor.transaction();
    tx.text(t)?.set_text_content("new")?;
    let context = tx.view().context_for_foreign_read()?;
    let lease = ForeignReadLease::default();
    let authorized = originless.with_read_context_from(&context, &lease)?;
    assert_eq!(
        authorized.update_facts(),
        &ForeignUpdateFacts {
            dirty_type: ForeignDirtyType::Nodes,
            dirty_leaves: vec![t],
            dirty_elements: vec![
                (p, DirtyIntent::AncestorOfDirty),
                (NodeKey::ROOT, DirtyIntent::AncestorOfDirty)
            ],
        }
    );
    assert_eq!(authorized.state().root_text_content().as_ref(), "old");
    assert_eq!(tx.text_content(NodeKey::ROOT), "new");
    assert_eq!(
        originless.update_facts().dirty_type,
        ForeignDirtyType::Clean
    );
    Ok(())
}
