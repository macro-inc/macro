use super::*;

#[test]
fn admitted_update_preserves_tree_selection_tags_and_extensions() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .extension_state(0_u32)
        .build()
        .expect("editor");
    let mut staged = editor.transaction();
    let paragraph = staged.create(Paragraph::default())?;
    let text = staged.create_text("staged text")?;
    staged.append(paragraph, &[text.key()])?;
    staged.append(NodeKey::ROOT, &[paragraph.key()])?;
    staged.select_end(text)?;
    *staged.extension_mut::<u32>()? = 9;
    staged.add_tag("host-tag".parse().expect("tag"));
    let pending = staged.suspend();
    assert!(editor.state().is_empty_state());
    let mut admitted = editor.transaction();
    admitted.adopt_staged_update(pending)?;
    let commit = admitted.commit()?;
    assert_eq!(commit.next.root_text_content().as_ref(), "staged text");
    assert!(commit.selection_changed);
    assert!(commit.tags.contains(&"host-tag".parse().expect("tag")));
    assert_eq!(*editor.extension::<u32>()?, 9);
    Ok(())
}

#[test]
fn stale_or_foreign_updates_never_replace_target_state() -> Result<(), Error> {
    let mut first = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut second = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let pending = first.transaction().suspend();
    assert!(matches!(
        second.transaction().adopt_staged_update(pending),
        Err(Error::StaleSuspendedUpdate)
    ));
    let pending = first.transaction().suspend();
    let mut changed = first.transaction();
    let paragraph = changed.create(Paragraph::default())?;
    changed.append(NodeKey::ROOT, &[paragraph.key()])?;
    changed.commit()?;
    let mut current = first.transaction();
    assert!(matches!(
        current.adopt_staged_update(pending),
        Err(Error::StaleSuspendedUpdate)
    ));
    assert_eq!(current.view().children_size(NodeKey::ROOT), 1);
    Ok(())
}

#[test]
fn admission_rejects_intervening_writes_without_discarding_them() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let pending = editor.transaction().suspend();
    let mut current = editor.transaction();
    let paragraph = current.create(Paragraph::default())?;
    current.append(NodeKey::ROOT, &[paragraph.key()])?;
    assert!(matches!(
        current.adopt_staged_update(pending),
        Err(Error::Invariant("host update target is not pristine"))
    ));
    assert_eq!(current.view().children_size(NodeKey::ROOT), 1);
    Ok(())
}
#[test]
fn inherited_selection_tags_do_not_make_a_fresh_target_dirty() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default())?;
    let text = tx.create_text("original")?;
    tx.append(paragraph, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[paragraph.key()])?;
    tx.commit()?;
    let mut selection = editor.transaction();
    selection.select_end(text)?;
    selection.add_tag("selection-tag".parse().expect("tag"));
    selection.commit()?;
    let mut staged = editor.transaction();
    staged.text(text)?.set_text_content("edited")?;
    let pending = staged.suspend();
    let mut admitted = editor.transaction();
    admitted.adopt_staged_update(pending)?;
    let commit = admitted.commit()?;
    assert_eq!(commit.next.root_text_content().as_ref(), "edited");
    assert!(commit.tags.contains(&"selection-tag".parse().expect("tag")));
    Ok(())
}

#[cfg(not(feature = "foreign-nodes"))]
#[test]
fn unused_native_staging_does_not_allocate_identity_markers() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    assert!(editor.suspend_owner.get().is_none());
    let mut tx = editor.transaction();
    assert!(tx.staging_update.get().is_none());
    let p = tx.create(Paragraph::default())?;
    let text = tx.create_text("ordinary")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.flush()?;
    assert!(tx.staging_update.get().is_none());
    assert!(tx.editor.suspend_owner.get().is_none());
    tx.commit()?;
    assert!(editor.suspend_owner.get().is_none());
    let pending = editor.transaction().suspend();
    assert!(editor.suspend_owner.get().is_some());
    let tx = editor.resume(pending)?;
    assert!(tx.staging_update.get().is_some());
    Ok(())
}

#[test]
fn adoption_moves_the_same_owned_continuation_and_all_staged_effects() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .extension_state(0_u32)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let text = tx.create_text("owned")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.select_end(text)?;
    tx.set_composition_key(Some(text.key()))?;
    tx.add_tag(UpdateTag::Paste);
    *tx.extension_mut::<u32>()? = 12;
    tx.prevent_default();
    assert_eq!(
        tx.step_pipeline(
            FlushMode::Transforms,
            PipelineBudget {
                max_work: std::num::NonZeroUsize::MIN
            }
        )?,
        PipelineProgress::Pending
    );
    let address = std::ptr::from_ref(tx.pipeline_continuation.as_deref().expect("continuation"));
    let pending = tx.suspend();
    assert_eq!(
        std::ptr::from_ref(
            pending
                .pipeline_continuation
                .as_deref()
                .expect("continuation")
        ),
        address
    );
    let tx = editor.resume(pending)?;
    assert_eq!(
        std::ptr::from_ref(tx.pipeline_continuation.as_deref().expect("continuation")),
        address
    );
    let pending = tx.suspend();
    assert!(editor.state().is_empty_state());
    let mut admitted = editor.transaction();
    admitted.adopt_staged_update(pending)?;
    assert_eq!(
        std::ptr::from_ref(
            admitted
                .pipeline_continuation
                .as_deref()
                .expect("continuation")
        ),
        address
    );
    let commit = admitted.commit()?;
    assert_eq!(commit.next.root_text_content().as_ref(), "owned");
    assert!(commit.tags.contains(&UpdateTag::Paste));
    assert_eq!(commit.composition_key, Some(text.key()));
    assert!(commit.default_prevented);
    assert_eq!(*editor.extension::<u32>()?, 12);
    Ok(())
}
