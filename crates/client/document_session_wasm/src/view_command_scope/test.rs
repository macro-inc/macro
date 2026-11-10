use super::*;
use std::sync::atomic::AtomicUsize;
struct Transport<F>(F);
impl<F> Host for Transport<F>
where
    F: Fn(&Call) -> Result<bool, HostFailure> + Send + Sync,
{
    fn dispatch(&self, call: &Call) -> Result<bool, HostFailure> {
        (self.0)(call)
    }
}
fn enter() -> Command {
    Command::Key {
        command: KeyCommand::Enter,
        event: None,
    }
}
fn normal() -> CommandRegistration {
    CommandRegistration {
        command: CommandKind::Key(KeyCommand::Enter),
        priority: CommandPriority::Normal,
        placement: Placement::After,
    }
}
struct Native<F>(F);
impl<F> CommandListener for Native<F>
where
    F: Fn(&mut Transaction<'_>) -> Result<Handled, Error> + Send + Sync + 'static,
{
    fn handle(&self, tx: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        (self.0)(tx)
    }
}
#[test]
fn pending_text_selection_and_own_json_follow_earlier_native_listener_without_publication() {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let (key, _) = editor
        .update(|tx| {
            let paragraph = tx.create(Paragraph::default())?;
            let text = tx.create_text("before")?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            tx.append(paragraph.key(), &[text.key()])?;
            Ok(text.key())
        })
        .unwrap();
    let published = editor.state().clone();
    editor.register_command_listener(
        normal(),
        Arc::new(Native(move |tx: &mut Transaction<'_>| {
            tx.text(key)?.set_text_content("pending")?;
            tx.select_end(key)?;
            Ok(Handled::No)
        })),
    );
    let calls = Arc::new(AtomicUsize::new(0));
    let observed = calls.clone();
    let registry = Registry::with_host(Arc::new(Transport(move |call: &Call| {
        assert_eq!(call.access, doc_sync_core::Access::Edit);
        assert!(call.programmatic);
        assert!(matches!(execute_current(call.scope.raw(), Operation::Text(key.index())).unwrap(), Value::Text(value) if value == "pending"));
        assert!(matches!(execute_current(call.scope.raw(), Operation::OwnJSON(key.index())).unwrap(), Value::Text(value) if value.contains("pending")));
        let Value::Bytes(encoded) = execute_current(call.scope.raw(), Operation::Selection).unwrap() else { panic!("selection"); };
        let selection = wire::SelectionMsg::deserialize(&encoded).unwrap();
        assert_eq!(selection.kind, 2);
        assert_eq!({ selection.anchor.key }, key.index());
        assert_eq!({ selection.anchor.offset }, 7);
        assert_eq!(published.view().text_content(key), "before");
        observed.fetch_add(1, Ordering::SeqCst);
        Ok(false)
    }))).unwrap();
    registry
        .insert(1, CommandPriority::Normal, |registration, callback| {
            editor.register_command_listener(registration, callback)
        })
        .unwrap();
    let later = Arc::new(AtomicUsize::new(0));
    let seen = later.clone();
    editor.register_command_listener(
        normal(),
        Arc::new(Native(move |tx: &mut Transaction<'_>| {
            assert_eq!(tx.view().text_content(key), "pending");
            seen.fetch_add(1, Ordering::SeqCst);
            Ok(Handled::Yes)
        })),
    );
    let (handled, _) = registry
        .invoke(doc_sync_core::Access::Edit, || editor.dispatch(&enter()))
        .unwrap()
        .unwrap();
    assert_eq!(handled, Handled::Yes);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(later.load(Ordering::SeqCst), 1);
}
#[test]
fn nested_scopes_reject_parent_and_caught_failure_does_not_report_outer_failure() {
    let depth = Arc::new(AtomicUsize::new(0));
    let at = depth.clone();
    let parent = Arc::new(AtomicU64::new(0));
    let previous = parent.clone();
    let registry = Registry::with_host(Arc::new(Transport(move |call: &Call| {
        if at.fetch_add(1, Ordering::SeqCst) == 0 {
            previous.store(call.scope.raw(), Ordering::SeqCst);
            let nested = execute_current(call.scope.raw(), Operation::Enter).unwrap_err();
            assert!(matches!(nested, BoundaryError::Model(Error::Extension(_))));
            assert!(execute_current(call.scope.raw(), Operation::Selection).is_ok());
            Ok(true)
        } else {
            assert!(
                execute_current(previous.load(Ordering::SeqCst), Operation::Selection).is_err()
            );
            assert!(execute_current(call.scope.raw(), Operation::Selection).is_ok());
            Err(HostFailure::Thrown)
        }
    })))
    .unwrap();
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    registry
        .insert(1, CommandPriority::Normal, |registration, callback| {
            editor.register_command_listener(registration, callback)
        })
        .unwrap();
    let (handled, _) = registry
        .invoke(doc_sync_core::Access::Edit, || editor.dispatch(&enter()))
        .unwrap()
        .unwrap();
    assert_eq!(handled, Handled::Yes);
    assert!(registry.take_failure().unwrap().is_none());
    assert!(execute_current(parent.load(Ordering::SeqCst), Operation::Selection).is_err());
}
#[test]
fn readonly_scope_keeps_reads_and_selection_but_refuses_nested_document_admission() {
    let registry = Registry::with_host(Arc::new(Transport(|call: &Call| {
        assert!(execute_current(call.scope.raw(), Operation::Selection).is_ok());
        assert!(execute_current(
            call.scope.raw(),
            Operation::SetSelection(wire::SelectionMsg {
                kind: 1,
                ..editor_input::empty_selection()
            })
        )
        .is_ok());
        assert!(execute_current(call.scope.raw(), Operation::Enter).is_err());
        assert!(execute_current(
            call.scope.raw(),
            Operation::Dispatch(wire::EditorInputMsg::EditorSetState { json: "{}".into() })
        )
        .is_err());
        Ok(true)
    })))
    .unwrap();
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    registry
        .insert(1, CommandPriority::Normal, |registration, callback| {
            editor.register_command_listener(registration, callback)
        })
        .unwrap();
    registry
        .invoke(doc_sync_core::Access::Read, || editor.dispatch(&enter()))
        .unwrap()
        .unwrap();
}

#[test]
fn native_bucket_snapshot_keeps_removed_callbacks_and_visits_new_lower_bucket() {
    let order = Arc::new(Mutex::new(Vec::new()));
    let seen = order.clone();
    let second = Arc::new(AtomicU64::new(0));
    let remove = second.clone();
    let registry = Registry::with_host(Arc::new(Transport(move |call: &Call| {
        seen.lock().unwrap().push(call.callback.get());
        if call.callback.get() == 1 {
            execute_current(
                call.scope.raw(),
                Operation::Unregister(remove.load(Ordering::SeqCst)),
            )
            .unwrap();
            execute_current(call.scope.raw(), Operation::Register(3, 2)).unwrap();
            execute_current(call.scope.raw(), Operation::Register(4, 1)).unwrap();
        }
        Ok(false)
    })))
    .unwrap();
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let first = registry
        .insert(1, CommandPriority::Normal, |registration, callback| {
            editor.register_command_listener(registration, callback)
        })
        .unwrap();
    let duplicate = registry
        .insert(1, CommandPriority::Normal, |registration, callback| {
            editor.register_command_listener(registration, callback)
        })
        .unwrap();
    assert_eq!(first, duplicate);
    second.store(
        registry
            .insert(2, CommandPriority::Normal, |registration, callback| {
                editor.register_command_listener(registration, callback)
            })
            .unwrap(),
        Ordering::SeqCst,
    );
    registry
        .invoke(doc_sync_core::Access::Edit, || editor.dispatch(&enter()))
        .unwrap()
        .unwrap();
    assert_eq!(*order.lock().unwrap(), vec![1, 2, 4]);
    order.lock().unwrap().clear();
    registry
        .invoke(doc_sync_core::Access::Edit, || editor.dispatch(&enter()))
        .unwrap()
        .unwrap();
    assert_eq!(*order.lock().unwrap(), vec![1, 3, 4]);
}

#[test]
fn foreign_invocation_is_rejected_before_host_call() {
    let first = Registry::with_host(Arc::new(Transport(|_: &Call| {
        panic!("foreign host must not execute")
    })))
    .unwrap();
    let second = Registry::with_host(Arc::new(Transport(|_: &Call| Ok(true)))).unwrap();
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    first
        .insert(1, CommandPriority::Normal, |registration, callback| {
            editor.register_command_listener(registration, callback)
        })
        .unwrap();
    let error = second
        .invoke(doc_sync_core::Access::Edit, || editor.dispatch(&enter()))
        .unwrap()
        .unwrap_err();
    assert!(matches!(
        error,
        Error::Invariant("foreign view command invocation")
    ));
    assert!(editor.dispatch(&enter()).is_err());
}

#[test]
fn actual_session_seed_rebinds_native_presence_and_original_cleanup_stays_valid() {
    let config = wire::SessionConfigMsg {
        doc: "enter-rebind-fixture".into(),
        session: "00000000-0000-0000-0000-000000000001".into(),
        user: "fixture-user".into(),
        peers: vec![7, 8, 9],
        access: wire::Access::Edit,
        transport: wire::Transport::None,
        durable: false,
        chatter: false,
        headless: false,
        view_engine: 1,
        view_os: 0,
        token: String::new(),
        traceparent: String::new(),
        coalesce: 25,
        snapshot_interval: 0,
        observed: vec![],
    };
    let mut machine = machine::Machine::create(
        generated::ABI_MAJOR,
        &bytes(&config).unwrap(),
        0.0,
        0.0,
        true,
    )
    .unwrap();
    let count = Arc::new(AtomicUsize::new(0));
    let seen = count.clone();
    let registry = Registry::with_host(Arc::new(Transport(move |_: &Call| {
        seen.fetch_add(1, Ordering::SeqCst);
        Ok(true)
    })))
    .unwrap();
    let machine::Session::Editor(session) = &mut machine.session else {
        panic!("editor");
    };
    let handle = registry.register(session, 1, 4).unwrap();
    let old = registry.lock().unwrap().entries[0].actual.clone();
    assert!(session.has_command_listener(&old));
    machine
        .sync(doc_sync_core::SyncInput::Start, 0.0, None)
        .unwrap();
    machine
        .sync(
            doc_sync_core::SyncInput::Seed {
                kind: doc_sync_core::SeedKind::Optimistic,
                snapshot: vec![],
            },
            1.0,
            None,
        )
        .unwrap();
    let machine::Session::Editor(session) = &mut machine.session else {
        panic!("editor");
    };
    assert!(!session.has_command_listener(&old));
    registry.rebind(session).unwrap();
    assert_eq!(registry.lock().unwrap().epoch, 1);
    assert_eq!(registry.register(session, 1, 4).unwrap(), handle);
    registry
        .invoke(doc_sync_core::Access::Edit, || {
            machine.editor(
                Input::Command {
                    command: enter(),
                    selection: ViewSelection::KeepModel,
                },
                2.0,
            )
        })
        .unwrap()
        .unwrap();
    assert_eq!(count.load(Ordering::SeqCst), 1);
    let machine::Session::Editor(session) = &mut machine.session else {
        panic!("editor");
    };
    registry.unregister(session, handle).unwrap();
    registry.unregister(session, handle).unwrap();
    registry.rebind(session).unwrap();
    assert!(registry.lock().unwrap().entries.is_empty());
    registry
        .invoke(doc_sync_core::Access::Edit, || {
            machine.editor(
                Input::Command {
                    command: enter(),
                    selection: ViewSelection::KeepModel,
                },
                3.0,
            )
        })
        .unwrap()
        .unwrap();
    assert_eq!(count.load(Ordering::SeqCst), 1);
}

mod reported_failure;

#[test]
fn actual_key_event_presence_distinguishes_keyboard_from_programmatic_enter() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let observed = calls.clone();
    let registry = Registry::with_host(Arc::new(Transport(move |call: &Call| {
        observed.lock().unwrap().push(call.programmatic);
        Ok(true)
    })))
    .unwrap();
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    registry
        .insert(1, CommandPriority::Normal, |registration, callback| {
            editor.register_command_listener(registration, callback)
        })
        .unwrap();
    registry
        .invoke(doc_sync_core::Access::Edit, || editor.dispatch(&enter()))
        .unwrap()
        .unwrap();
    registry
        .invoke(doc_sync_core::Access::Edit, || {
            editor.dispatch(&Command::Key {
                command: KeyCommand::Enter,
                event: Some(KeyEvent {
                    key: "Enter".into(),
                    code: "Enter".into(),
                    shift: false,
                    alt: false,
                    ctrl: false,
                    meta: false,
                    repeat: false,
                    is_composing: false,
                }),
            })
        })
        .unwrap()
        .unwrap();
    assert_eq!(*calls.lock().unwrap(), vec![true, false]);
}
mod control;
