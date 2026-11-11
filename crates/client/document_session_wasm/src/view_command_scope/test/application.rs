use super::*;
use std::sync::atomic::AtomicI64;

#[test]
fn scoped_application_select_all_uses_the_actual_decoder_and_pending_transaction() {
    let config = crate::macro_editor::config(
        document_session::EditorConfig::default(),
        Arc::new(AtomicI64::new(0)),
    );
    let mut editor = (config.builder)(EditorMode::ViewAttached, 7)
        .build()
        .unwrap();
    let (text, _) = editor
        .update(|tx| {
            let paragraph = tx.create(Paragraph::default())?;
            let text = tx.create_text("pending application selection")?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            tx.append(paragraph, &[text.key()])?;
            tx.select_end(text)?;
            Ok(text.key())
        })
        .unwrap();
    let observed = Arc::new(AtomicUsize::new(0));
    let calls = observed.clone();
    let registry = Registry::with_host(Arc::new(Transport(move |call: &Call| {
        let command = |generation| wire::EditorInputMsg::EditorApplication {
            name: "group-b.select-all".into(),
            json: "{}".into(),
            generation,
            selection: editor_input::view_selection(&ViewSelection::KeepModel),
            keyboard: false,
            key: String::new(),
            mods: 0,
            code: 0,
        };
        assert!(execute_current(
            call.scope.raw(),
            Operation::Dispatch(command(call.generation.wrapping_add(1))),
        )
        .is_err());
        assert!(matches!(
            execute_current(
                call.scope.raw(),
                Operation::Dispatch(command(call.generation))
            )
            .unwrap(),
            Value::Handled(true)
        ));
        let Value::Bytes(encoded) =
            execute_current(call.scope.raw(), Operation::Selection).unwrap()
        else {
            panic!("selection");
        };
        let selection = wire::SelectionMsg::deserialize(&encoded).unwrap();
        assert_eq!(selection.kind, 2);
        assert_eq!({ selection.anchor.key }, text.index());
        assert_eq!({ selection.anchor.offset }, 0);
        assert_eq!({ selection.focus.key }, text.index());
        assert_eq!({ selection.focus.offset }, 29);
        calls.fetch_add(1, Ordering::SeqCst);
        Ok(true)
    })))
    .unwrap();
    registry
        .insert(1, CommandPriority::Critical, |registration, listener| {
            editor.register_command_listener(registration, listener)
        })
        .unwrap();
    registry
        .invoke(doc_sync_core::Access::Edit, || editor.dispatch(&enter()))
        .unwrap()
        .unwrap();
    assert_eq!(observed.load(Ordering::SeqCst), 1);
}
