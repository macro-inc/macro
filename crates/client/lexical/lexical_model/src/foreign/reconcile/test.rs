use super::*;
use std::sync::{
    Arc,
    atomic::{AtomicU32, Ordering},
};

fn count_transforms(tx: &mut Transaction<'_>, _: Id<Paragraph>) -> Result<(), Error> {
    tx.extension::<Arc<AtomicU32>>()?
        .fetch_add(1, Ordering::SeqCst);
    Ok(())
}

#[test]
fn derived_cache_ack_does_not_replay_transforms_and_preserves_retry_state() -> Result<(), Error> {
    let calls = Arc::new(AtomicU32::new(0));
    let mut editor = Editor::builder(EditorMode::ViewAttached)
        .without_reconciler_caches()
        .extension_state(calls.clone())
        .transform::<Paragraph>(count_transforms)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    assert!(tx.begin_foreign_reconciliation().is_err());
    tx.defer_publication = true;
    assert!(tx.begin_foreign_reconciliation().is_err());
    let paragraph = tx.create(Paragraph {})?;
    let text = tx.create_text("derived")?;
    tx.append(paragraph, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[paragraph.key()])?;
    tx.select_end(text)?;
    tx.flush()?;
    let transformed = calls.load(Ordering::SeqCst);
    assert!(transformed > 0);
    let stage = tx.begin_foreign_reconciliation()?;
    tx.mark_dirty(paragraph)?;
    tx.patch_foreign_base(paragraph.key(), ForeignBaseField::TextFormat(1))?;
    tx.patch_foreign_base(
        paragraph.key(),
        ForeignBaseField::TextStyle("color: red".into()),
    )?;
    assert!(tx.needs_flush());
    tx.finish_foreign_reconciliation(stage)?;
    assert!(!tx.needs_flush());
    assert!(tx.create_text("sealed").is_err());
    let pending = tx.suspend();
    let mut tx = editor.resume(pending)?;
    tx.reopen_foreign_reconciliation()?;
    assert_eq!(tx.text_content(NodeKey::ROOT), "derived");
    assert!(tx.selection().is_some());
    let stage = tx.begin_foreign_reconciliation()?;
    tx.finish_foreign_reconciliation(stage)?;
    let pending = tx.suspend();
    let mut admitted = editor.transaction();
    admitted.adopt_foreign_update(pending)?;
    admitted.commit()?;
    assert_eq!(calls.load(Ordering::SeqCst), transformed);
    assert_eq!(editor.state().root_text_content().as_ref(), "derived");
    assert!(editor.state().selection().is_some());
    Ok(())
}

#[test]
fn reconciliation_authority_rejects_wrong_update_and_never_grants_publication() -> Result<(), Error>
{
    let mut editor = Editor::builder(EditorMode::Headless)
        .without_reconciler_caches()
        .build()
        .expect("editor");
    let mut first = editor.transaction();
    first.defer_publication = true;
    first.flush()?;
    let token = first.begin_foreign_reconciliation()?;
    drop(first);
    let mut second = editor.transaction();
    second.defer_publication = true;
    second.flush()?;
    assert!(second.finish_foreign_reconciliation(token).is_err());
    assert!(second.reopen_foreign_reconciliation().is_err());
    let token = second.begin_foreign_reconciliation()?;
    second.finish_foreign_reconciliation(token)?;
    assert!(matches!(
        second.commit(),
        Err(Error::Invariant("host update awaits admission"))
    ));
    assert!(editor.state().is_empty_state());
    Ok(())
}

#[test]
fn same_update_stage_survives_suspend_and_resume_without_commit_authority() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .without_reconciler_caches()
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    tx.defer_publication = true;
    tx.flush()?;
    let stage = tx.begin_foreign_reconciliation()?;
    let pending = tx.suspend();
    let mut resumed = editor.resume(pending)?;
    resumed.finish_foreign_reconciliation(stage)?;
    let pending = resumed.suspend();
    let mut admitted = editor.transaction();
    admitted.adopt_staged_update(pending)?;
    admitted.commit()?;
    Ok(())
}
