use super::*;

#[test]
fn publication_capture_pairs_exact_state_with_update_read_values() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default())?.key();
    let text = tx.create_text("text")?.key();
    tx.append(paragraph, &[text])?;
    tx.append(NodeKey::ROOT, &[paragraph])?;
    tx.text(text)?
        .select(Some(Utf16Offset(1)), Some(Utf16Offset(1)))?;
    tx.commit()?;
    let previous = editor.state().clone();
    let mut tx = editor.transaction();
    tx.text(text)?
        .select(Some(Utf16Offset(2)), Some(Utf16Offset(2)))?;
    tx.set_composition_key(Some(text))?;
    let detached = tx.detach_selection(Selection::Range(RangeSelection::collapsed(Point::text(
        text,
        Utf16Offset(3),
    ))));
    let detached_identity = tx
        .foreign_selection_identity(detached)
        .expect("detached identity");
    tx.flush()?;
    let owner = tx.foreign_editor_identity();
    let update = tx.foreign_update_identity();
    let source = tx.view().context_for_foreign_read()?;
    let (commit, paired) = tx.commit_foreign(|commit| {
        let lease = ForeignReadLease::default();
        let target = commit.next.view().snapshot_for_foreign_read()?;
        assert!(target.is_originless_capture_of(&commit.next));
        assert!(target.is_originless_capture_of(&commit.next.clone()));
        assert!(!target.is_originless_capture_of(&previous));
        assert!(!target.is_originless_capture_of(
            &commit.next.with_selection(commit.next.selection().cloned())
        ));
        assert!(target.view().context_for_foreign_read().is_err());
        let paired = target.with_read_context_from(&source, &lease)?;
        assert!(paired.matches_origin(&owner, &update));
        assert!(!paired.is_originless_capture_of(&commit.next));
        paired.with_read_transaction(&previous, |peer| -> Result<(), Error> {
            assert_eq!(peer.anchor()?.offset(), 2);
            assert_eq!(peer.composition_key(), Some(text));
            let old = peer
                .detach_previous_foreign_selection()?
                .expect("previous object");
            assert_eq!(
                peer.selection_at(old)?
                    .expect("previous")
                    .as_range()
                    .expect("range")
                    .anchor
                    .offset(),
                1
            );
            let detached = peer
                .foreign_selection_slot(&detached_identity)
                .expect("detached slot");
            assert_eq!(
                peer.selection_at(detached)?
                    .expect("detached")
                    .as_range()
                    .expect("range")
                    .anchor
                    .offset(),
                3
            );
            assert!(matches!(
                peer.text(text)?.set_text_content("forbidden"),
                Err(Error::ForeignReadOnly)
            ));
            Ok(())
        })??;
        Ok::<_, Error>(paired)
    })?;
    assert!(
        commit
            .next
            .view()
            .snapshot_for_foreign_read()?
            .is_originless_capture_of(editor.state())
    );
    assert_eq!(
        editor
            .state()
            .selection()
            .expect("current")
            .as_range()
            .expect("range")
            .anchor
            .offset(),
        2
    );
    assert!(!paired.matches_origin(&owner, &update));
    let other = Editor::builder(EditorMode::Headless)
        .build()
        .expect("other editor");
    assert!(!paired.is_originless_capture_of(other.state()));
    assert!(matches!(
        other
            .state()
            .view()
            .snapshot_for_foreign_read()?
            .with_read_context_from(&source, &ForeignReadLease::default()),
        Err(Error::ForeignEditorState)
    ));
    Ok(())
}

#[test]
fn no_op_publication_retains_canonical_current_and_unpublished_pending_objects() -> Result<(), Error>
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
        .select(Some(Utf16Offset(1)), Some(Utf16Offset(1)))?;
    tx.commit()?;
    let previous = editor.state().clone();
    let mut tx = editor.transaction();
    tx.flush()?;
    let pending_identity = tx
        .foreign_selection_identity(SelectionSlot::Active)
        .expect("pending identity");
    let source = tx.view().context_for_foreign_read()?;
    tx.commit_foreign(|commit| {
        let lease = ForeignReadLease::default();
        assert!(commit.is_noop());
        let target = commit.next.view().snapshot_for_foreign_read()?;
        assert!(target.is_originless_capture_of(&previous));
        let paired = target.with_read_context_from(&source, &lease)?;
        paired.with_read_transaction(&previous, |peer| -> Result<(), Error> {
            let pending = peer
                .foreign_selection_slot(&pending_identity)
                .expect("pending object");
            assert_ne!(pending, SelectionSlot::Active);
            assert_eq!(
                peer.selection_at(pending)?
                    .expect("pending")
                    .as_range()
                    .expect("range")
                    .anchor
                    .offset(),
                1
            );
            assert_eq!(peer.anchor()?.offset(), 1);
            assert_eq!(
                peer.detach_previous_foreign_selection()?,
                Some(SelectionSlot::Active)
            );
            Ok(())
        })??;
        Ok::<_, Error>(())
    })?;
    Ok(())
}

#[test]
fn originless_read_peer_point_and_memo_edits_do_not_match_the_canonical_selection()
-> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default())?.key();
    let text = tx.create_text("text")?.key();
    tx.append(paragraph, &[text])?;
    tx.append(NodeKey::ROOT, &[paragraph])?;
    tx.text(text)?
        .select(Some(Utf16Offset(1)), Some(Utf16Offset(2)))?;
    tx.commit()?;
    let canonical = editor.state();
    let target = canonical.view().snapshot_for_foreign_read()?;
    assert!(target.is_originless_capture_of(canonical));
    target.with_read_transaction(canonical, |peer| -> Result<(), Error> {
        peer.set_point(PointRole::Anchor, Point::text(text, Utf16Offset(3)))?;
        let changed = peer.view().snapshot_for_foreign_read()?;
        assert!(!changed.is_originless_capture_of(canonical));
        Ok(())
    })??;
    target.with_read_transaction(canonical, |peer| -> Result<(), Error> {
        // Alter the internal fixture; the guarded model ABI rejects direct memo writes.
        let Some(Selection::Range(range)) = peer.pending.selection.as_mut() else {
            unreachable!()
        };
        range.cached_direction = Some((range.anchor, range.focus, false));
        let changed = peer.view().snapshot_for_foreign_read()?;
        assert!(!changed.is_originless_capture_of(canonical));
        Ok(())
    })??;
    Ok(())
}

#[test]
fn metadata_context_does_not_clone_already_writable_view_cache_records() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::ViewAttached)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default())?.key();
    let text = tx.create_text("one")?.key();
    tx.append(paragraph, &[text])?;
    tx.append(NodeKey::ROOT, &[paragraph])?;
    tx.commit()?;
    let mut tx = editor.transaction();
    tx.set_indent(NodeKey::ROOT, 1)?;
    tx.set_indent(paragraph, 1)?;
    tx.text(text)?
        .set_text_content("two")?
        .set_format(TextFormat::BOLD)?
        .set_style("color: blue")?;
    tx.flush()?;
    let root = tx.view().foreign_record_identity(NodeKey::ROOT)?;
    let element = tx.view().foreign_record_identity(paragraph)?;
    let metadata = tx.view().context_for_foreign_read()?;
    let (commit, ()) = tx.commit_foreign(|commit| {
        assert!(root.matches(commit.next.view().node(NodeKey::ROOT).expect("root")));
        assert!(element.matches(commit.next.view().node(paragraph).expect("element")));
        assert_eq!(
            commit.next.view().element_data(paragraph)?.text_format,
            TextFormat::BOLD
        );
        assert_eq!(
            commit
                .next
                .view()
                .element_data(paragraph)?
                .text_style
                .as_ref(),
            "color: blue"
        );
        Ok::<_, Error>(())
    })?;
    drop(metadata);
    assert_eq!(commit.next.root_text_content().as_ref(), "two");
    let mut tx = editor.transaction();
    tx.set_indent(NodeKey::ROOT, 2)?;
    tx.set_indent(paragraph, 2)?;
    tx.text(text)?
        .set_text_content("three")?
        .set_format(TextFormat::ITALIC)?
        .set_style("color: green")?;
    tx.flush()?;
    let root = tx.view().foreign_record_identity(NodeKey::ROOT)?;
    let element = tx.view().foreign_record_identity(paragraph)?;
    let commit = tx.commit()?;
    assert!(root.matches(commit.next.view().node(NodeKey::ROOT).expect("root")));
    assert!(element.matches(commit.next.view().node(paragraph).expect("element")));
    assert_eq!(
        commit.next.view().element_data(paragraph)?.text_format,
        TextFormat::ITALIC
    );
    assert_eq!(
        commit
            .next
            .view()
            .element_data(paragraph)?
            .text_style
            .as_ref(),
        "color: green"
    );
    assert_eq!(commit.next.root_text_content().as_ref(), "three");
    Ok(())
}
