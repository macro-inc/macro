use super::*;

static EVENT: EventKey<u32> = EventKey::new("update-local.test");

fn editor() -> Editor {
    Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor")
}

fn paragraph(tx: &mut Transaction<'_>) -> Result<(), Error> {
    let paragraph = tx.create(Paragraph::default())?;
    tx.append(NodeKey::ROOT, &[paragraph.key()])?;
    Ok(())
}

#[test]
fn a_slot_starts_empty_and_holds_typed_values_for_the_transaction() -> Result<(), Error> {
    let mut editor = editor();
    let mut tx = editor.transaction();
    assert_eq!(tx.update_local::<u32>(), None);
    *tx.update_local_mut::<u32>()? += 2;
    *tx.update_local_mut::<u32>()? += 3;
    assert_eq!(tx.update_local::<u32>(), Some(&5));
    assert_eq!(tx.update_local::<u64>(), None);
    Ok(())
}

#[test]
fn every_successful_publication_resets_the_slot_including_empty_ones() -> Result<(), Error> {
    let mut editor = editor();
    // Dirty publication in place.
    let mut tx = editor.transaction();
    paragraph(&mut tx)?;
    *tx.update_local_mut::<u32>()? = 1;
    tx.commit_phase()?;
    assert_eq!(tx.update_local::<u32>(), None);
    drop(tx);
    // Empty publication (no changes, no selection change).
    let mut tx = editor.transaction();
    *tx.update_local_mut::<u32>()? = 2;
    let commit = tx.commit_phase()?;
    assert!(commit.is_noop());
    assert_eq!(tx.update_local::<u32>(), None);
    drop(tx);
    // Event-only publication.
    let mut tx = editor.transaction();
    tx.emit(&EVENT, 1);
    *tx.update_local_mut::<u32>()? = 4;
    let commit = tx.commit_phase()?;
    assert_eq!(
        commit.events_of(&EVENT).copied().collect::<Vec<_>>(),
        vec![1]
    );
    assert_eq!(tx.update_local::<u32>(), None);
    drop(tx);
    // Tag-only publication.
    let mut tx = editor.transaction();
    tx.add_tag("only-a-tag".parse().expect("tag"));
    *tx.update_local_mut::<u32>()? = 3;
    tx.commit_phase()?;
    assert_eq!(tx.update_local::<u32>(), None);
    Ok(())
}

#[test]
fn set_editor_state_resets_through_its_publication_prefix() -> Result<(), Error> {
    let mut editor = editor();
    editor.update(paragraph)?;
    let state = editor.state().clone();
    let mut tx = editor.transaction();
    paragraph(&mut tx)?;
    *tx.update_local_mut::<u32>()? = 1;
    tx.set_editor_state(state, TagSet::default())?;
    assert_eq!(tx.update_local::<u32>(), None);
    // The sealed transaction rejects further slot writes like any other write.
    assert!(matches!(
        tx.update_local_mut::<u32>(),
        Err(Error::WriteAfterSetEditorState)
    ));
    Ok(())
}

#[test]
fn restore_flush_and_nested_updates_keep_the_slot() -> Result<(), Error> {
    let mut editor = editor();
    editor.update(paragraph)?;
    let state = editor.state().clone();
    let mut tx = editor.transaction();
    *tx.update_local_mut::<u32>()? = 7;
    paragraph(&mut tx)?;
    tx.restore_editor_state(&state)?;
    assert_eq!(tx.update_local::<u32>(), Some(&7));
    tx.queue_update(
        |tx| {
            *tx.update_local_mut::<u32>()? += 1;
            Ok(())
        },
        UpdateOptions::default(),
    )?;
    tx.flush()?;
    assert_eq!(tx.update_local::<u32>(), Some(&8));
    Ok(())
}

#[test]
fn suspend_resume_and_adoption_move_the_slot() -> Result<(), Error> {
    let mut editor = editor();
    let mut tx = editor.transaction();
    *tx.update_local_mut::<u32>()? = 4;
    let pending = tx.suspend();
    let tx = editor.resume(pending)?;
    assert_eq!(tx.update_local::<u32>(), Some(&4));
    let pending = tx.suspend();
    let mut target = editor.transaction();
    target.adopt_staged_update(pending)?;
    assert_eq!(target.update_local::<u32>(), Some(&4));
    Ok(())
}

#[test]
fn adoption_requires_an_empty_target_slot_and_keeps_the_target_slot_on_refusal() -> Result<(), Error>
{
    let mut editor = editor();
    let mut staged = editor.transaction();
    *staged.update_local_mut::<u32>()? = 4;
    let pending = staged.suspend();
    let mut target = editor.transaction();
    *target.update_local_mut::<u64>()? = 9;
    assert!(matches!(
        target.adopt_staged_update(pending),
        Err(Error::Invariant("host update target is not pristine"))
    ));
    assert_eq!(target.update_local::<u64>(), Some(&9));
    assert_eq!(target.update_local::<u32>(), None);
    Ok(())
}

#[test]
fn rollback_and_consuming_commits_leave_the_next_transaction_empty() -> Result<(), Error> {
    let mut editor = editor();
    let mut tx = editor.transaction();
    *tx.update_local_mut::<u32>()? = 1;
    drop(tx);
    assert_eq!(editor.transaction().update_local::<u32>(), None);
    let mut tx = editor.transaction();
    paragraph(&mut tx)?;
    *tx.update_local_mut::<u32>()? = 2;
    tx.commit()?;
    assert_eq!(editor.transaction().update_local::<u32>(), None);
    Ok(())
}

#[test]
fn a_refused_resume_hands_back_the_same_slot() -> Result<(), Error> {
    let mut editor = editor();
    let mut tx = editor.transaction();
    *tx.update_local_mut::<u32>()? = 4;
    let pending = tx.suspend();
    editor.update(paragraph)?;
    let Err(failure) = editor.resume_owned(pending) else {
        panic!("a stale update must be refused")
    };
    let (error, pending) = failure.into_parts();
    assert!(matches!(error, Error::StaleSuspendedUpdate));
    assert_eq!(pending.update_local.get::<u32>(), Some(&4));
    Ok(())
}

#[cfg(feature = "foreign-nodes")]
#[test]
fn a_foreign_read_only_transaction_rejects_slot_writes() -> Result<(), Error> {
    let mut editor = editor();
    let mut tx = editor.transaction();
    tx.foreign_read_only = true;
    assert!(matches!(
        tx.update_local_mut::<u32>(),
        Err(Error::ForeignReadOnly)
    ));
    assert_eq!(tx.update_local::<u32>(), None);
    Ok(())
}
