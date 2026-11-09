use super::*;
#[test]
fn staged_state_replacement_cannot_publish_before_admission() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default())?;
    let text = tx.create_text("published")?;
    tx.append(paragraph, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[paragraph.key()])?;
    tx.commit()?;
    let original = editor.state().clone();
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: Some(HistoryConfig::default()),
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    let pending = core.suspend_staged_update();
    let (pending, result) = core.with_staged_update(pending, |tx| -> Result<(), Error> {
        tx.text(text)?.set_text_content("unpublished")?;
        tx.set_editor_state(original, TagSet::default())
    })?;
    assert!(matches!(
        result,
        Err(Error::Invariant("host update awaits admission"))
    ));
    assert_eq!(core.state().root_text_content().as_ref(), "published");
    assert!(core.take_initial_output().is_none());
    let (pending, result) = core.with_staged_update(pending, |tx| {
        assert_eq!(
            tx.view().text_content(NodeKey::ROOT).as_ref(),
            "unpublished"
        );
        tx.commit_phase()
    })?;
    assert!(matches!(
        result,
        Err(Error::Invariant("host update awaits admission"))
    ));
    drop(pending);
    assert_eq!(core.state().root_text_content().as_ref(), "published");
    assert!(!core.history().expect("history").availability().can_undo);
    Ok(())
}
