use super::*;

#[test]
fn previous_selection_hydration_reuses_the_committed_object_without_activation() -> Result<(), Error>
{
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    assert!(tx.detach_previous_foreign_selection()?.is_none());
    let paragraph = tx.create(Paragraph::default())?.key();
    let text = tx.create_text("text")?.key();
    tx.append(paragraph, &[text])?;
    tx.append(NodeKey::ROOT, &[paragraph])?;
    tx.text(text)?
        .select(Some(Utf16Offset(3)), Some(Utf16Offset(1)))?;
    assert!(tx.range_is_backward_at(SelectionSlot::Active)?);
    let original = tx
        .foreign_selection_identity(SelectionSlot::Active)
        .expect("original");
    tx.commit()?;
    let mut tx = editor.transaction();
    let current = tx
        .foreign_selection_identity(SelectionSlot::Active)
        .expect("current");
    let capture = tx.view().snapshot_for_foreign_read()?;
    let committed = tx.committed_state().clone();
    capture.with_read_transaction(&committed, |peer| -> Result<(), Error> {
        let slot = peer.detach_previous_foreign_selection()?.expect("previous");
        assert_eq!(
            peer.foreign_selection_identity(slot),
            Some(original.clone())
        );
        assert_eq!(peer.range_at(slot)?.cached_is_backward(), Some(true));
        assert_eq!(peer.anchor_at(slot)?.offset(), 3);
        assert_eq!(peer.detach_previous_foreign_selection()?, Some(slot));
        assert_eq!(
            peer.foreign_selection_identity(SelectionSlot::Active),
            Some(current.clone())
        );
        assert!(
            peer.view()
                .snapshot_for_foreign_read()?
                .contains_selection_identity(&original)
        );
        Ok(())
    })??;
    let slot = tx.detach_previous_foreign_selection()?.expect("previous");
    assert_ne!(slot, SelectionSlot::Active);
    assert_eq!(tx.foreign_selection_identity(slot), Some(original.clone()));
    assert_eq!(tx.range_at(slot)?.cached_is_backward(), Some(true));
    assert_eq!(tx.detach_previous_foreign_selection()?, Some(slot));
    assert_eq!(
        tx.foreign_selection_identity(SelectionSlot::Active),
        Some(current)
    );
    let pending = tx.suspend();
    let mut tx = editor.resume(pending)?;
    assert_eq!(tx.detach_previous_foreign_selection()?, Some(slot));
    assert_eq!(tx.foreign_selection_identity(slot), Some(original));
    assert!(tx.commit()?.is_noop());
    Ok(())
}

#[test]
fn committed_and_previous_selection_objects_keep_identity_across_noop_updates() -> Result<(), Error>
{
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default())?.key();
    let text = tx.create_text("text")?.key();
    tx.append(paragraph, &[text])?;
    tx.append(NodeKey::ROOT, &[paragraph])?;
    tx.text(text)?
        .select(Some(Utf16Offset(3)), Some(Utf16Offset(1)))?;
    assert!(tx.range_is_backward_at(SelectionSlot::Active)?);
    let identity = tx
        .foreign_selection_identity(SelectionSlot::Active)
        .expect("identity");
    let committed = tx.commit()?.next;
    assert!(
        committed
            .view()
            .snapshot_for_foreign_read()?
            .contains_selection_identity(&identity)
    );
    assert!(
        committed
            .clone()
            .view()
            .snapshot_for_foreign_read()?
            .contains_selection_identity(&identity)
    );
    let replacement = committed.with_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::text(text, Utf16Offset(2)),
    ))));
    assert!(
        !replacement
            .view()
            .snapshot_for_foreign_read()?
            .contains_selection_identity(&identity)
    );
    assert_eq!(
        committed
            .selection()
            .and_then(Selection::as_range)
            .expect("range")
            .cached_is_backward(),
        Some(true)
    );
    let tx = editor.transaction();
    let pending = tx
        .foreign_selection_identity(SelectionSlot::Active)
        .expect("pending");
    assert_ne!(identity, pending);
    assert_eq!(tx.range_selection()?.cached_is_backward(), None);
    let snapshot = tx.view().snapshot_for_foreign_read()?;
    assert!(snapshot.contains_selection_identity(&identity));
    assert!(snapshot.contains_selection_identity(&pending));
    let unchanged = tx.commit()?;
    assert!(unchanged.is_noop());
    let snapshot = unchanged.next.view().snapshot_for_foreign_read()?;
    assert!(snapshot.contains_selection_identity(&identity));
    assert!(!snapshot.contains_selection_identity(&pending));
    Ok(())
}

#[test]
fn replaced_objects_retain_values_and_identity_through_reads_suspend_and_reactivation()
-> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let text = tx.create_text("text")?.key();
    tx.text(text)?
        .select(Some(Utf16Offset(3)), Some(Utf16Offset(1)))?;
    let original = tx
        .foreign_selection_identity(SelectionSlot::Active)
        .expect("identity");
    assert!(tx.range_is_backward_at(SelectionSlot::Active)?);
    tx.replace_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::text(text, Utf16Offset(2)),
    ))))?;
    let replacement = tx
        .foreign_selection_identity(SelectionSlot::Active)
        .expect("identity");
    assert_ne!(original, replacement);
    let old_slot = tx.foreign_selection_slot(&original).expect("retired");
    assert_ne!(old_slot, SelectionSlot::Active);
    assert_eq!(tx.anchor_at(old_slot)?.offset(), 3);
    assert_eq!(tx.focus_at(old_slot)?.offset(), 1);
    assert!(tx.range_is_backward_at(old_slot)?);
    let snapshot = tx.view().snapshot_for_foreign_read()?;
    assert!(snapshot.contains_selection_identity(&original));
    assert!(snapshot.clone().contains_selection_identity(&replacement));
    assert!(!snapshot.contains_selection_identity(&ForeignSelectionIdentity::default()));
    snapshot.with_read_transaction(tx.committed_state(), |peer| -> Result<(), Error> {
        assert_eq!(peer.foreign_selection_slot(&original), Some(old_slot));
        assert_eq!(
            peer.foreign_selection_identity(SelectionSlot::Active),
            Some(replacement.clone())
        );
        assert_eq!(peer.anchor_at(old_slot)?.offset(), 3);
        let owned = peer.detach_selection(Selection::Range(RangeSelection::at_root()));
        let owned = peer
            .foreign_selection_identity(owned)
            .expect("owned identity");
        assert!(!snapshot.contains_selection_identity(&owned));
        assert!(
            peer.view()
                .snapshot_for_foreign_read()?
                .contains_selection_identity(&owned)
        );
        Ok(())
    })??;
    let pending = tx.suspend();
    let mut tx = editor.resume(pending)?;
    assert_eq!(tx.foreign_selection_slot(&original), Some(old_slot));
    tx.activate_foreign_selection(old_slot)?;
    assert_eq!(
        tx.foreign_selection_identity(SelectionSlot::Active),
        Some(original.clone())
    );
    assert_eq!(tx.anchor_at(SelectionSlot::Active)?.offset(), 3);
    let second_slot = tx
        .foreign_selection_slot(&replacement)
        .expect("second retired");
    assert_eq!(tx.anchor_at(second_slot)?.offset(), 2);
    tx.set_point(PointRole::Anchor, Point::text(text, Utf16Offset(4)))?;
    assert_eq!(
        tx.foreign_selection_identity(SelectionSlot::Active),
        Some(original.clone())
    );
    tx.activate_foreign_selection(second_slot)?;
    let latest_old_slot = tx.foreign_selection_slot(&original).expect("retired again");
    assert_eq!(tx.anchor_at(latest_old_slot)?.offset(), 4);
    Ok(())
}

#[test]
fn remove_text_restores_the_original_object_after_transient_native_replacements()
-> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let first = tx.create(Paragraph::default())?.key();
    let second = tx.create(Paragraph::default())?.key();
    let a = tx.create_text("first")?.key();
    let b = tx.create_text("second")?.key();
    tx.append(first, &[a])?;
    tx.append(second, &[b])?;
    tx.append(NodeKey::ROOT, &[first, second])?;
    tx.replace_selection(Some(Selection::Range(RangeSelection::new(
        Point::text(a, Utf16Offset(2)),
        Point::text(b, Utf16Offset(3)),
    ))))?;
    let identity = tx
        .foreign_selection_identity(SelectionSlot::Active)
        .expect("identity");
    tx.remove_text()?;
    assert_eq!(
        tx.foreign_selection_identity(SelectionSlot::Active),
        Some(identity.clone())
    );
    assert_eq!(
        tx.foreign_selection_slot(&identity),
        Some(SelectionSlot::Active)
    );
    assert!(tx.range_selection()?.is_collapsed());
    assert_eq!(tx.text_content(NodeKey::ROOT), "fiond");
    Ok(())
}

#[test]
fn native_node_replacement_clones_only_range_selection_objects() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default())?.key();
    let a = tx.create_text("old")?.key();
    let b = tx.create_text("new")?.key();
    tx.append(paragraph, &[a])?;
    tx.append(NodeKey::ROOT, &[paragraph])?;
    tx.text(a)?
        .select(Some(Utf16Offset(1)), Some(Utf16Offset(2)))?;
    let identity = tx
        .foreign_selection_identity(SelectionSlot::Active)
        .expect("range identity");
    tx.replace(a, b, false)?;
    assert_ne!(
        tx.foreign_selection_identity(SelectionSlot::Active),
        Some(identity.clone())
    );
    let old = tx.foreign_selection_slot(&identity).expect("old range");
    assert_ne!(old, SelectionSlot::Active);
    assert_eq!(tx.anchor_at(old)?, Point::text(a, Utf16Offset(1)));
    assert_eq!(tx.focus_at(old)?, Point::text(a, Utf16Offset(2)));
    assert_eq!(tx.anchor_at(SelectionSlot::Active)?.key(), b);
    let c = tx.create_text("third")?.key();
    let mut nodes = NodeSelection::new();
    nodes.add(b);
    tx.replace_selection(Some(Selection::Node(nodes)))?;
    let identity = tx
        .foreign_selection_identity(SelectionSlot::Active)
        .expect("node identity");
    let replacements = tx.selection_replacements();
    tx.replace(b, c, false)?;
    assert_eq!(
        tx.foreign_selection_identity(SelectionSlot::Active),
        Some(identity)
    );
    assert_eq!(tx.selection_replacements(), replacements);
    Ok(())
}

#[test]
fn selecting_a_range_retires_the_node_selection_object() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default())?.key();
    let text = tx.create_text("text")?.key();
    tx.append(paragraph, &[text])?;
    tx.append(NodeKey::ROOT, &[paragraph])?;
    let mut nodes = NodeSelection::new();
    nodes.add(text);
    tx.replace_selection(Some(Selection::Node(nodes)))?;
    let old = tx
        .foreign_selection_identity(SelectionSlot::Active)
        .expect("node identity");
    tx.text(text)?
        .select(Some(Utf16Offset(1)), Some(Utf16Offset(2)))?;
    let new = tx
        .foreign_selection_identity(SelectionSlot::Active)
        .expect("range identity");
    assert_ne!(old, new);
    let retired = tx
        .foreign_selection_slot(&old)
        .expect("retired node selection");
    assert!(tx.selection_at(retired)?.expect("node selection").is_node());
    assert_eq!(
        tx.selection_at(retired)?
            .and_then(Selection::as_node)
            .expect("node selection")
            .keys()
            .collect::<Vec<_>>(),
        vec![text]
    );
    tx.text(text)?
        .select(Some(Utf16Offset(2)), Some(Utf16Offset(2)))?;
    assert_eq!(
        tx.foreign_selection_identity(SelectionSlot::Active),
        Some(new)
    );
    Ok(())
}

#[test]
fn inserting_nodes_into_node_selection_creates_a_distinct_range_object() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default())?.key();
    let text = tx.create_text("selected")?.key();
    tx.append(paragraph, &[text])?;
    tx.append(NodeKey::ROOT, &[paragraph])?;
    let mut nodes = NodeSelection::new();
    nodes.add(text);
    tx.replace_selection(Some(Selection::Node(nodes)))?;
    let old = tx
        .foreign_selection_identity(SelectionSlot::Active)
        .expect("node identity");
    let inserted = tx.create_text("inserted")?.key();
    tx.insert_nodes_at(SelectionSlot::Active, &[inserted])?;
    assert_ne!(
        tx.foreign_selection_identity(SelectionSlot::Active),
        Some(old.clone())
    );
    let retired = tx.foreign_selection_slot(&old).expect("old selection");
    assert_ne!(retired, SelectionSlot::Active);
    assert!(tx.selection_at(retired)?.expect("node selection").is_node());
    assert!(tx.selection().expect("range selection").is_range());
    assert_eq!(tx.text_content(NodeKey::ROOT), "inserted");
    Ok(())
}
