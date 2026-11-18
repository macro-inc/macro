use super::*;

fn escape() -> Command {
    Command::Key {
        command: KeyCommand::Escape,
        event: None,
    }
}

#[test]
fn escape_and_enter_share_host_but_not_logical_registration() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let seen = calls.clone();
    let registry = Registry::with_host(Arc::new(Transport(move |call: &Call| {
        seen.lock().unwrap().push(call.callback.get());
        Ok(false)
    })))
    .unwrap();
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let enter_handle = registry
        .insert(7, CommandPriority::High, |r, l| {
            editor.register_command_listener(r, l)
        })
        .unwrap();
    let escape_handle = registry
        .insert_key(KeyCommand::Escape, 7, CommandPriority::High, |r, l| {
            editor.register_command_listener(r, l)
        })
        .unwrap();
    assert_ne!(enter_handle, escape_handle);
    assert_eq!(
        escape_handle,
        registry
            .insert_key(KeyCommand::Escape, 7, CommandPriority::High, |r, l| editor
                .register_command_listener(r, l))
            .unwrap()
    );
    registry
        .invoke(doc_sync_core::Access::Edit, || editor.dispatch(&escape()))
        .unwrap()
        .unwrap();
    assert_eq!(*calls.lock().unwrap(), vec![7]);
    registry
        .invoke(doc_sync_core::Access::Edit, || editor.dispatch(&enter()))
        .unwrap()
        .unwrap();
    assert_eq!(*calls.lock().unwrap(), vec![7, 7]);
    registry
        .remove(escape_handle, |id| editor.unregister_command_listener(id))
        .unwrap();
    registry
        .invoke(doc_sync_core::Access::Edit, || editor.dispatch(&escape()))
        .unwrap()
        .unwrap();
    assert_eq!(*calls.lock().unwrap(), vec![7, 7]);
    registry
        .invoke(doc_sync_core::Access::Edit, || editor.dispatch(&enter()))
        .unwrap()
        .unwrap();
    assert_eq!(*calls.lock().unwrap(), vec![7, 7, 7]);
}

#[test]
fn escape_visits_native_and_view_high_priority_in_registration_order() {
    let order = Arc::new(Mutex::new(Vec::new()));
    let seen = order.clone();
    let registry = Registry::with_host(Arc::new(Transport(move |call: &Call| {
        seen.lock().unwrap().push(call.callback.get());
        Ok(false)
    })))
    .unwrap();
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    for n in [1, 3] {
        let seen = order.clone();
        editor.register_command_listener(
            CommandRegistration {
                command: CommandKind::Key(KeyCommand::Escape),
                priority: CommandPriority::High,
                placement: Placement::After,
            },
            Arc::new(Native(move |_: &mut Transaction<'_>| {
                seen.lock().unwrap().push(n);
                Ok(Handled::No)
            })),
        );
        if n == 1 {
            registry
                .insert_key(KeyCommand::Escape, 2, CommandPriority::High, |r, l| {
                    editor.register_command_listener(r, l)
                })
                .unwrap();
        }
    }
    registry
        .insert_key(KeyCommand::Escape, 4, CommandPriority::Low, |r, l| {
            editor.register_command_listener(r, l)
        })
        .unwrap();
    registry
        .invoke(doc_sync_core::Access::Edit, || editor.dispatch(&escape()))
        .unwrap()
        .unwrap();
    assert_eq!(*order.lock().unwrap(), vec![1, 2, 3, 4]);
}

#[test]
fn escape_mutations_keep_current_bucket_snapshot_and_visit_new_lower_bucket() {
    let order = Arc::new(Mutex::new(Vec::new()));
    let seen = order.clone();
    let removed = Arc::new(AtomicU64::new(0));
    let handle = removed.clone();
    let registry = Registry::with_host(Arc::new(Transport(move |call: &Call| {
        seen.lock().unwrap().push(call.callback.get());
        if call.callback.get() == 1 {
            execute_current(
                call.scope.raw(),
                Operation::Unregister(handle.load(Ordering::SeqCst)),
            )
            .unwrap();
            execute_current(call.scope.raw(), Operation::RegisterEscape(3, 3)).unwrap();
            execute_current(call.scope.raw(), Operation::RegisterEscape(4, 1)).unwrap();
        }
        Ok(false)
    })))
    .unwrap();
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    registry
        .insert_key(KeyCommand::Escape, 1, CommandPriority::High, |r, l| {
            editor.register_command_listener(r, l)
        })
        .unwrap();
    removed.store(
        registry
            .insert_key(KeyCommand::Escape, 2, CommandPriority::High, |r, l| {
                editor.register_command_listener(r, l)
            })
            .unwrap(),
        Ordering::SeqCst,
    );
    registry
        .invoke(doc_sync_core::Access::Edit, || editor.dispatch(&escape()))
        .unwrap()
        .unwrap();
    assert_eq!(*order.lock().unwrap(), vec![1, 2, 4]);
    order.lock().unwrap().clear();
    registry
        .invoke(doc_sync_core::Access::Edit, || editor.dispatch(&escape()))
        .unwrap()
        .unwrap();
    assert_eq!(*order.lock().unwrap(), vec![1, 3, 4]);
}

#[test]
fn escape_nested_scope_uses_explicit_programmatic_payload_and_expires() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let seen = calls.clone();
    let outer = Arc::new(AtomicU64::new(0));
    let scope = outer.clone();
    let registry = Registry::with_host(Arc::new(Transport(move |call: &Call| {
        seen.lock().unwrap().push(call.programmatic);
        if !call.programmatic {
            scope.store(call.scope.raw(), Ordering::SeqCst);
            assert!(matches!(
                execute_current(call.scope.raw(), Operation::Escape).unwrap(),
                Value::Handled(true)
            ));
        } else {
            assert!(execute_current(scope.load(Ordering::SeqCst), Operation::Selection).is_err());
        }
        Ok(true)
    })))
    .unwrap();
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    registry
        .insert_key(KeyCommand::Escape, 1, CommandPriority::High, |r, l| {
            editor.register_command_listener(r, l)
        })
        .unwrap();
    registry
        .invoke(doc_sync_core::Access::Edit, || {
            editor.dispatch(&Command::Key {
                command: KeyCommand::Escape,
                event: Some(KeyEvent {
                    key: "Escape".into(),
                    code: "Escape".into(),
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
    assert_eq!(*calls.lock().unwrap(), vec![false, true]);
    assert!(execute_current(outer.load(Ordering::SeqCst), Operation::Escape).is_err());
}

#[test]
fn escape_session_seed_rebinds_native_presence_and_original_cleanup_stays_valid() {
    let config = wire::SessionConfigMsg {
        doc: "escape-rebind-fixture".into(),
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
    let handle = registry
        .register_key(session, KeyCommand::Escape, 1, 4)
        .unwrap();
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
    assert_eq!(
        registry
            .register_key(session, KeyCommand::Escape, 1, 4)
            .unwrap(),
        handle
    );
    registry
        .invoke(doc_sync_core::Access::Edit, || {
            machine.editor(
                Input::Command {
                    command: escape(),
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
                    command: escape(),
                    selection: ViewSelection::KeepModel,
                },
                3.0,
            )
        })
        .unwrap()
        .unwrap();
    assert_eq!(count.load(Ordering::SeqCst), 1);
}

#[test]
fn escape_listener_rejects_wrong_command_before_host() {
    let registry = Registry::with_host(Arc::new(Transport(|_: &Call| {
        panic!("wrong command reached host")
    })))
    .unwrap();
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    registry
        .insert_key(KeyCommand::Escape, 1, CommandPriority::High, |r, l| {
            editor.register_command_listener(r, l)
        })
        .unwrap();
    let listener = registry.lock().unwrap().entries[0].listener.clone();
    let error = editor
        .update(|tx| listener.handle(tx, &enter()))
        .unwrap_err();
    assert!(matches!(
        error,
        Error::Invariant("view listener received another command")
    ));
}

#[test]
fn readonly_escape_scope_preserves_existing_document_admission_guard() {
    let registry = Registry::with_host(Arc::new(Transport(|call: &Call| {
        assert!(execute_current(call.scope.raw(), Operation::Selection).is_ok());
        assert!(execute_current(call.scope.raw(), Operation::Escape).is_err());
        Ok(true)
    })))
    .unwrap();
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    registry
        .insert_key(KeyCommand::Escape, 1, CommandPriority::High, |r, l| {
            editor.register_command_listener(r, l)
        })
        .unwrap();
    registry
        .invoke(doc_sync_core::Access::Read, || editor.dispatch(&escape()))
        .unwrap()
        .unwrap();
}
