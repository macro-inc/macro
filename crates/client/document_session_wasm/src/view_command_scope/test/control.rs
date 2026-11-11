use super::*;
use doc_sync_core::{RequestId, SyncInput};
use document_session::{SessionError, ViewEffect};

#[test]
fn two_real_callback_causes_keep_separate_ordinals_and_control_invalidates_taken_and_queued_leases()
{
    let sources = Arc::new(Mutex::new(Vec::new()));
    let observed = sources.clone();
    let registry = Registry::with_host(Arc::new(Transport(move |call: &Call| {
        observed.lock().unwrap().push(CallbackFailure {
            owner: call.owner,
            invocation: call.invocation,
            scope: call.scope,
        });
        Err(HostFailure::Thrown)
    })))
    .unwrap();
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    registry
        .insert(1, CommandPriority::Normal, |registration, callback| {
            editor.register_command_listener(registration, callback)
        })
        .unwrap();
    let first_error = registry
        .invoke(doc_sync_core::Access::Edit, || editor.dispatch(&enter()))
        .unwrap()
        .unwrap_err();
    let second_error = registry
        .invoke(doc_sync_core::Access::Edit, || editor.dispatch(&enter()))
        .unwrap()
        .unwrap_err();
    let causes = sources.lock().unwrap();
    // Encoder/control unit: aggregate two real dispatch errors, without inventing
    // model publication receipts or claiming one Session input produced this pair.
    let view = vec![
        ViewEffect::Error(SessionError::Model(first_error)),
        ViewEffect::Error(SessionError::Model(second_error)),
    ];
    let records = vec![
        failure::Report {
            cause: causes[0],
            view_index: 0,
        },
        failure::Report {
            cause: causes[1],
            view_index: 1,
        },
    ];
    registry.lock().unwrap().failures = failure::encode(&records, &view).unwrap();
    let first = registry.take_failure().unwrap().unwrap();
    assert_eq!(first.scope(), causes[0].scope.raw());
    assert_eq!(first.effect_ordinals(), vec![0]);
    assert!(first.current());
    assert!(registry
        .invoke(doc_sync_core::Access::Edit, || panic!(
            "blocked local must not run"
        ))
        .is_err());
    assert!(first.current());
    registry
        .invoke_control(doc_sync_core::Access::Edit, || {})
        .unwrap();
    assert!(!first.current());
    let second = registry.take_failure().unwrap().unwrap();
    assert_eq!(second.scope(), causes[1].scope.raw());
    assert_eq!(second.effect_ordinals(), vec![1]);
    assert!(!second.current());
    assert!(registry.take_failure().unwrap().is_none());
    assert_eq!(first.effect_ordinals(), vec![0]);
    assert_eq!(second.effect_ordinals(), vec![1]);
}

#[test]
fn actual_stop_control_survives_sticky_invalid_callback_metadata() {
    let config = wire::SessionConfigMsg {
        doc: "enter-stop-fixture".into(),
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
    let captured = Arc::new(Mutex::new(None));
    let observed = captured.clone();
    let registry = Registry::with_host(Arc::new(Transport(move |call: &Call| {
        *observed.lock().unwrap() = Some(CallbackFailure {
            owner: call.owner,
            invocation: call.invocation,
            scope: call.scope,
        });
        Err(HostFailure::Thrown)
    })))
    .unwrap();
    let mut machine = machine::Machine::create(
        generated::ABI_MAJOR,
        &bytes(&config).unwrap(),
        0.0,
        0.0,
        true,
    )
    .unwrap();
    machine.bind_view_commands(registry.clone()).unwrap();
    machine.sync(SyncInput::Start, 0.0, None).unwrap();
    machine
        .sync(
            SyncInput::Seed {
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
    registry.register(session, 1, 4).unwrap();
    machine
        .editor(
            Input::Command {
                command: enter(),
                selection: ViewSelection::KeepModel,
            },
            2.0,
        )
        .unwrap();
    let lease = machine.take_view_command_failure().unwrap().unwrap();
    let cause = captured.lock().unwrap().unwrap();
    assert_eq!(lease.scope(), cause.scope.raw());
    // Deliberate metadata corruption using an actually issued callback identity;
    // this is not a fabricated native release/retirement acknowledgement.
    registry.lock().unwrap().reports.push(failure::Report {
        cause,
        view_index: usize::MAX,
    });
    let machine::Session::Editor(session) = &machine.session else {
        panic!("editor");
    };
    registry.bind_output(&session.last_output().view);
    assert!(machine
        .editor(
            Input::Command {
                command: enter(),
                selection: ViewSelection::KeepModel
            },
            3.0
        )
        .is_err());
    assert!(lease.current());
    machine
        .sync(SyncInput::Stop(RequestId(41)), 4.0, Some(4.0))
        .unwrap();
    assert!(!lease.current());
    let machine::Session::Editor(session) = &machine.session else {
        panic!("editor");
    };
    assert!(session.last_output().view.iter().any(|effect| matches!(
        effect,
        ViewEffect::Reply {
            request: RequestId(41),
            reply: doc_sync_core::Reply::Stopped
        }
    )));
    assert!(!machine.output.is_empty());
    let retained = machine.take_view_command_failure().unwrap().unwrap();
    assert_eq!(retained.scope(), cause.scope.raw());
    assert!(!retained.current());
    assert!(machine.take_view_command_failure().is_err());
    machine.sync(SyncInput::Reset, 5.0, Some(5.0)).unwrap();
    assert!(machine.take_view_command_failure().is_err());
    assert!(machine
        .editor(
            Input::Command {
                command: enter(),
                selection: ViewSelection::KeepModel
            },
            6.0
        )
        .is_err());
}

#[test]
fn rejected_dom_text_invalidates_taken_lease_but_preserves_pending_packet_and_scope_fifo() {
    let config = wire::SessionConfigMsg {
        doc: "enter-rejected-text-fixture".into(),
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
    let captured = Arc::new(Mutex::new(None));
    let observed = captured.clone();
    let registry = Registry::with_host(Arc::new(Transport(move |call: &Call| {
        *observed.lock().unwrap() = Some(CallbackFailure {
            owner: call.owner,
            invocation: call.invocation,
            scope: call.scope,
        });
        Err(HostFailure::Thrown)
    })))
    .unwrap();
    let mut machine = machine::Machine::create(
        generated::ABI_MAJOR,
        &bytes(&config).unwrap(),
        0.0,
        0.0,
        true,
    )
    .unwrap();
    machine.bind_view_commands(registry.clone()).unwrap();
    machine.sync(SyncInput::Start, 0.0, None).unwrap();
    machine
        .sync(
            SyncInput::Seed {
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
    registry.register(session, 1, 4).unwrap();
    machine
        .editor(
            Input::Command {
                command: enter(),
                selection: ViewSelection::KeepModel,
            },
            2.0,
        )
        .unwrap();
    let lease = machine.take_view_command_failure().unwrap().unwrap();
    let cause = captured.lock().unwrap().unwrap();
    assert_eq!(lease.scope(), cause.scope.raw());

    assert!(lease.current());
    let old_ordinals = lease.effect_ordinals();
    machine.reject_text("invalid DOM text input").unwrap();
    assert!(!lease.current());
    assert_eq!(lease.scope(), cause.scope.raw());
    assert_eq!(lease.effect_ordinals(), old_ordinals);
    assert!(machine.take_view_command_failure().unwrap().is_none());
    machine
        .editor(
            Input::Command {
                command: enter(),
                selection: ViewSelection::KeepModel,
            },
            3.0,
        )
        .unwrap();
    let second_cause = captured.lock().unwrap().unwrap();
    assert_ne!(second_cause.scope, cause.scope);
    let before = machine.output.clone();
    assert!(machine.reject_text("invalid DOM text input").is_err());
    assert_eq!(machine.output, before);
    let pending = machine.take_view_command_failure().unwrap().unwrap();
    assert_eq!(pending.scope(), second_cause.scope.raw());
    assert!(pending.current());
    assert_eq!(lease.scope(), cause.scope.raw());
}

#[test]
fn scoped_retirement_is_metadata_only_and_survives_original_callback_failure() {
    let captured = Arc::new(Mutex::new(None));
    let observed = captured.clone();
    let registry = Registry::with_host(Arc::new(Transport(move |call: &Call| {
        let owner = call.owner.raw();
        let invocation = call.invocation.raw();
        let scope = call.scope.raw();
        assert!(request_retire_current(owner + 1, invocation, scope).is_err());
        assert!(request_retire_current(owner, invocation + 1, scope).is_err());
        assert!(request_retire_current(owner, invocation, scope + 1).is_err());
        request_retire_current(owner, invocation, scope).unwrap();
        *observed.lock().unwrap() = Some((owner, invocation, scope));
        Err(HostFailure::Thrown)
    })))
    .unwrap();
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    registry
        .insert(1, CommandPriority::Normal, |registration, callback| {
            editor.register_command_listener(registration, callback)
        })
        .unwrap();
    let before = editor.state().to_json().unwrap();
    registry
        .invoke(doc_sync_core::Access::Edit, || {
            let error = editor.dispatch(&enter()).unwrap_err();
            assert!(matches!(error, Error::Extension(_)));
            assert!(registry.take_view_retirement());
            assert!(!registry.take_view_retirement());
        })
        .unwrap();
    assert_eq!(editor.state().to_json().unwrap(), before);
    let (owner, invocation, scope) = captured.lock().unwrap().unwrap();
    assert!(request_retire_current(owner, invocation, scope).is_err());
    assert!(!registry.take_view_retirement());
}
