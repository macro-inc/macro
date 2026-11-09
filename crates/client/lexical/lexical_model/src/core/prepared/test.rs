use super::*;

#[test]
fn preparation_rejects_wrong_core_without_losing_pending_ownership()
-> Result<(), Box<dyn std::error::Error>> {
    let config = CoreConfig {
        history: None,
        editable: true,
        diff: DiffOptions::default(),
        track_text_content: false,
    };
    let mut a = EditorCore::new(
        Editor::builder(EditorMode::Headless).build()?,
        config.clone(),
    );
    let mut b = EditorCore::new(Editor::builder(EditorMode::Headless).build()?, config);
    let pending = a.suspend_staged_update();
    let (pending, edited) = a.with_staged_update(pending, |tx| -> Result<(), Error> {
        let p = tx.create(Paragraph::default())?;
        let t = tx.create_text("owned main")?;
        tx.append(p, &[t.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.select_end(t)?;
        tx.flush()
    })?;
    edited?;
    let Err(refused) = b.prepare_staged_update(pending) else {
        panic!("foreign core prepared")
    };
    assert!(matches!(refused.error(), Error::StaleSuspendedUpdate));
    let (_, pending) = refused.into_parts();
    let prepared = a.prepare_staged_update(pending)?;
    assert_eq!(prepared.next().root_text_content().as_ref(), "owned main");
    assert!(!a.prepared_diff(&prepared)?.ops.is_empty());
    assert!(matches!(
        b.prepared_diff(&prepared),
        Err(Error::StaleSuspendedUpdate)
    ));
    assert!(a.state().is_empty_state());
    assert!(b.state().is_empty_state());
    let receipt = prepared.receipt();
    let output = a
        .apply(
            Input::Command {
                command: Command::FormatText(TextFormatType::Bold),
                selection: ViewSelection::KeepModel,
            },
            HistoryTime(1),
        )
        .expect("actual unhandled command");
    assert!(output.commits.is_empty());
    assert!(receipt.main_publication().is_none());
    drop(prepared);
    assert!(a.state().is_empty_state());
    Ok(())
}

#[test]
fn a_real_intervening_publication_invalidates_the_pending_model_epoch()
-> Result<(), Box<dyn std::error::Error>> {
    let mut core = EditorCore::new(
        Editor::builder(EditorMode::Headless).build()?,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    let pending = core.suspend_staged_update();
    let (pending, edited) = core.with_staged_update(pending, |tx| -> Result<(), Error> {
        let p = tx.create(Paragraph::default())?;
        let t = tx.create_text("old pending")?;
        tx.append(p, &[t.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.flush()
    })?;
    edited?;
    core.editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let t = tx.create_text("actual publication")?;
        tx.append(p, &[t.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])
    })?;
    let Err(refused) = core.prepare_staged_update(pending) else {
        panic!("stale model epoch prepared")
    };
    assert!(matches!(refused.error(), Error::StaleSuspendedUpdate));
    let (_, pending) = refused.into_parts();
    drop(pending);
    assert_eq!(
        core.state().root_text_content().as_ref(),
        "actual publication"
    );
    Ok(())
}
