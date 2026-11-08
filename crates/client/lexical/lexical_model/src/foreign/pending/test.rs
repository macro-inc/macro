use super::*;

#[test]
fn no_op_detection_preserves_event_and_prevent_default_only_updates() -> Result<(), Error> {
    static EVENT: EventKey<u32> = EventKey::new("host-event");
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("registry");
    let mut tx = editor.transaction();
    tx.prevent_default();
    assert!(tx.has_foreign_effects());
    assert!(tx.commit()?.default_prevented);
    let mut tx = editor.transaction();
    tx.emit(&EVENT, 7);
    assert!(tx.has_foreign_effects());
    assert_eq!(tx.commit()?.events.len(), 1);
    Ok(())
}

#[test]
fn no_op_detection_preserves_selection_extensions_and_queued_work() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .extension_state(0u32)
        .build()
        .expect("registry");
    let mut tx = editor.transaction();
    tx.add_tag(UpdateTag::HistoryPush);
    assert!(!tx.has_foreign_effects());
    tx.select_start(NodeKey::ROOT)?;
    assert!(tx.has_foreign_effects());
    drop(tx);

    let mut tx = editor.transaction();
    *tx.extension_mut::<u32>()? = 7;
    assert!(tx.has_foreign_effects());
    tx.commit()?;
    assert_eq!(*editor.extension::<u32>()?, 7);

    let mut tx = editor.transaction();
    assert!(!tx.has_foreign_effects());
    tx.queue_update(
        |tx| {
            *tx.extension_mut::<u32>()? = 8;
            Ok(())
        },
        UpdateOptions::default(),
    )?;
    assert!(tx.has_foreign_effects());
    tx.commit()?;
    assert_eq!(*editor.extension::<u32>()?, 8);
    Ok(())
}

#[test]
fn suspended_update_retains_writes_selection_composition_and_tags() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("registry");
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default())?;
    let text = tx.create_text("a")?;
    tx.append(paragraph, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[paragraph.key()])?;
    tx.text(text)?.set_format(TextFormat::BOLD)?;
    tx.select_end(text)?;
    tx.set_composition_key(Some(text.key()))?;
    tx.add_tag(UpdateTag::HistoryPush);
    let pending = tx.suspend();
    assert!(editor.state().is_empty_state());
    let mut tx = editor.resume(pending)?;
    assert_eq!(tx.composition_key(), Some(text.key()));
    assert_eq!(
        tx.range_selection()?.anchor,
        Point::text(text, Utf16Offset(1))
    );
    tx.text(text)?
        .splice_text(Utf16Offset(1)..Utf16Offset(1), "b", true)?;
    let pending = tx.suspend();
    assert!(editor.state().is_empty_state());
    let commit = editor.resume(pending)?.commit()?;
    assert_eq!(commit.next.text_content(text).as_ref(), "ab");
    assert_eq!(commit.next.text_data(text)?.format, TextFormat::BOLD);
    assert!(commit.tags.contains(&UpdateTag::HistoryPush));
    assert_eq!(
        commit.changes.mutations.get(&text.key()),
        Some(&Mutation::Created)
    );
    assert!(commit.prev.is_empty_state());
    Ok(())
}

#[test]
fn dropping_suspended_update_discards_writes_without_reusing_keys() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("registry");
    let before = editor.state().to_json()?;
    let mut tx = editor.transaction();
    let abandoned = tx.create(Paragraph::default())?;
    tx.append(NodeKey::ROOT, &[abandoned.key()])?;
    drop(tx.suspend());
    assert_eq!(editor.state().to_json()?, before);
    let mut tx = editor.transaction();
    let next = tx.create(Paragraph::default())?;
    assert!(next.key() > abandoned.key());
    Ok(())
}

#[test]
fn later_commit_rejects_suspended_update_even_when_it_publishes_no_changes() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("registry");
    let pending = editor.transaction().suspend();
    editor.transaction().commit()?;
    assert!(matches!(
        editor.resume(pending),
        Err(Error::StaleSuspendedUpdate)
    ));
    Ok(())
}

#[test]
fn suspended_update_rejects_another_editor_sharing_registry_and_keys() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("registry");
    let mut peer = editor.create_conformance_peer(EditorMode::Headless)?;
    let pending = editor.transaction().suspend();
    assert!(matches!(
        peer.resume(pending),
        Err(Error::StaleSuspendedUpdate)
    ));
    assert!(editor.state().is_empty_state());
    assert!(peer.state().is_empty_state());
    Ok(())
}

#[test]
fn state_installation_rejects_a_previously_suspended_update() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("registry");
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])
    })?;
    let snapshot = editor.state().clone();
    let pending = editor.transaction().suspend();
    editor.set_editor_state(snapshot, TagSet::default())?;
    assert!(matches!(
        editor.resume(pending),
        Err(Error::StaleSuspendedUpdate)
    ));
    Ok(())
}

#[test]
fn pending_updates_are_send_and_sync() {
    fn check<T: Send + Sync>() {}
    check::<PendingUpdate>();
}

#[test]
fn suspension_retains_nested_updates_and_staged_extension_state() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .extension_state(0u32)
        .build()
        .expect("registry");
    let mut tx = editor.transaction();
    *tx.extension_mut::<u32>()? = 1;
    tx.queue_update(
        |tx| {
            *tx.extension_mut::<u32>()? += 2;
            let paragraph = tx.create(Paragraph::default())?;
            let text = tx.create_text("queued")?;
            tx.append(paragraph, &[text.key()])?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])
        },
        UpdateOptions::default(),
    )?;
    let pending = tx.suspend();
    assert_eq!(*editor.extension::<u32>()?, 0);
    assert!(editor.state().is_empty_state());
    let commit = editor.resume(pending)?.commit()?;
    assert_eq!(*editor.extension::<u32>()?, 3);
    assert_eq!(commit.next.text_content(NodeKey::ROOT).as_ref(), "queued");
    Ok(())
}

#[test]
fn host_editor_identity_survives_resumption_and_distinguishes_shared_peers() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut peer = editor.create_conformance_peer(EditorMode::Headless)?;
    let tx = editor.transaction();
    let identity = tx.foreign_editor_identity();
    let update = tx.foreign_update_identity();
    assert!(identity.matches(&tx));
    assert!(update.matches(&tx));
    let pending = tx.suspend();
    let tx = peer.transaction();
    assert!(!identity.matches(&tx));
    assert!(!update.matches(&tx));
    drop(tx);
    let tx = editor.resume(pending)?;
    assert!(identity.matches(&tx));
    assert!(update.matches(&tx));
    tx.commit()?;
    let tx = editor.transaction();
    assert!(identity.matches(&tx));
    assert!(!update.matches(&tx));
    drop(tx);
    drop(editor);
    assert!(!identity.matches(&peer.transaction()));
    Ok(())
}
