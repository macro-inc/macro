use super::*;
use lexical_model::*;
use serde_json::json;
use std::cell::RefCell;

#[test]
fn preparation_authorizes_only_its_exact_originless_state_and_clears_after_error() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut context = Context::default();
    let callbacks = context.callbacks();
    let mut tx = editor.transaction();
    context.begin_update(&mut tx)?;
    let text = tx.create_text("prepared")?.key();
    let paragraph = tx.create(Paragraph::default())?.key();
    tx.append(paragraph, &[text])?;
    tx.append(NodeKey::ROOT, &[paragraph])?;
    tx.text(text)?
        .select(Some(Utf16Offset(1)), Some(Utf16Offset(1)))?;
    tx.flush()?;
    let source = tx.view().context_for_foreign_read()?;
    let state = tx.view().snapshot_for_foreign_read()?.state().clone();
    let target = state.view().snapshot_for_foreign_read()?;
    let different_selection = state
        .with_selection(None)
        .view()
        .snapshot_for_foreign_read()?;
    let old_state = tx.committed_state().view().snapshot_for_foreign_read()?;
    let handle = callbacks.node(&tx, text)?;
    let get_text = crate::api::index()
        .binary_search(&"LexicalNode.getTextContent")
        .expect("get text") as u32;
    assert!(
        context
            .with_prepared_reads(source.clone(), &state, || Ok(()))
            .is_err()
    );
    assert!(callbacks.with_read_scope(&target, |_| Ok(())).is_err());
    context.finish_update(&tx)?;
    assert!(callbacks.with_read_scope(&target, |_| Ok(())).is_err());
    let derived = RefCell::new(None);
    let result: Result<()> = context.with_prepared_reads(source.clone(), &state, || {
        assert!(
            callbacks
                .with_read_scope(&different_selection, |_| Ok(()))
                .is_err()
        );
        assert!(callbacks.with_read_scope(&old_state, |_| Ok(())).is_err());
        assert!(
            context
                .with_prepared_reads(source.clone(), &state, || Ok(()))
                .is_err()
        );
        callbacks.with_read_scope(&target, |scope| {
            assert_eq!(
                scope.call(get_text, json!([]), Some(handle.clone()))?,
                "prepared"
            );
            Ok(())
        })?;
        let forged_lease = ForeignReadLease::default();
        let paired_with_other_lease = target.with_read_context_from(&source, &forged_lease)?;
        assert!(
            callbacks
                .with_read_scope(&paired_with_other_lease, |_| Ok(()))
                .is_err()
        );
        let paired = context.frames.read_capture(&target)?.into_owned();
        let recaptured = paired.view().snapshot_for_foreign_read()?;
        callbacks.with_read_scope(&recaptured, |_| Ok(()))?;
        *derived.borrow_mut() = Some(recaptured);
        Err(fail("preparation failed"))
    });
    assert_eq!(
        result.expect_err("preparation error").to_string(),
        "preparation failed"
    );
    assert!(callbacks.with_read_scope(&target, |_| Ok(())).is_err());
    assert!(
        callbacks
            .with_read_scope(derived.borrow().as_ref().expect("derived capture"), |_| Ok(
                ()
            ))
            .is_err()
    );
    context.with_prepared_reads(source, &state, || {
        callbacks.with_read_scope(&target, |scope| {
            assert_eq!(scope.call(get_text, json!([]), Some(handle))?, "prepared");
            Ok(())
        })
    })?;
    assert!(callbacks.with_read_scope(&target, |_| Ok(())).is_err());
    drop(tx);
    context.discard_update()?;
    assert!(callbacks.with_read_scope(&target, |_| Ok(())).is_err());
    Ok(())
}
