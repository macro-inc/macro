use super::*;
use doc_sync_core::{Reply, RequestId, SyncInput};
use document_session::ViewEffect;

#[test]
fn callback_cleanup_retirement_and_failure_keep_exact_packet_then_drain_real_stop() {
    for throws in [false, true] {
        let config = wire::SessionConfigMsg {
            doc: "enter-view-close-fixture".into(),
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
        let handle = Arc::new(AtomicU64::new(0));
        let cleanup = handle.clone();
        let calls = Arc::new(AtomicUsize::new(0));
        let seen = calls.clone();
        let registry = Registry::with_host(Arc::new(Transport(move |call: &Call| {
            seen.fetch_add(1, Ordering::SeqCst);
            request_retire_current(call.owner.raw(), call.invocation.raw(), call.scope.raw())
                .unwrap();
            execute_current(
                call.scope.raw(),
                Operation::Unregister(cleanup.load(Ordering::SeqCst)),
            )
            .unwrap();
            if throws {
                Err(HostFailure::Thrown)
            } else {
                Ok(true)
            }
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
        machine.take_output().unwrap();
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
        machine.take_output().unwrap();
        let machine::Session::Editor(session) = &mut machine.session else {
            panic!("editor");
        };
        handle.store(registry.register(session, 1, 4).unwrap(), Ordering::SeqCst);
        let flags = machine
            .editor(
                Input::Command {
                    command: enter(),
                    selection: ViewSelection::KeepModel,
                },
                2.0,
            )
            .unwrap();
        assert_eq!(flags & 16 != 0, throws);
        let machine::Session::Editor(session) = &machine.session else {
            panic!("editor");
        };
        let mut diff = session.surface().view_diff().unwrap();
        assert!(
            machine
                .decorator_observer
                .prepare(&mut diff, false)
                .unwrap()
                .is_none(),
            "actual epilogue retired observation before encoding"
        );
        let failure = machine.take_view_command_failure().unwrap();
        assert_eq!(failure.is_some(), throws);
        if let Some(failure) = &failure {
            assert!(failure.current());
            assert_eq!(failure.effect_ordinals().len(), 1);
        }
        let bytes = machine.take_output().unwrap();
        if throws {
            assert!(
                !bytes.is_empty(),
                "typed error packet was not discarded by retirement"
            );
        }
        let machine::Session::Editor(session) = &machine.session else {
            panic!("editor");
        };
        let mut diff = session.surface().view_diff().unwrap();
        assert!(
            machine
                .decorator_observer
                .prepare(&mut diff, false)
                .unwrap()
                .is_none(),
            "transfer cannot remount a retired ordinary packet"
        );
        machine
            .sync(SyncInput::Stop(RequestId(71)), 3.0, Some(3.0))
            .unwrap();
        let machine::Session::Editor(session) = &machine.session else {
            panic!("editor");
        };
        assert!(session.last_output().view.iter().any(|effect| matches!(
            effect,
            ViewEffect::Reply {
                request: RequestId(71),
                reply: Reply::Stopped
            }
        )));
        assert!(!machine.take_output().unwrap().is_empty());
        if let Some(failure) = &failure {
            assert!(!failure.current());
        }
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "scope cleanup prevents later callback invocation"
        );
        let remount = machine.initialize_view().unwrap();
        assert!(!remount.is_empty());
        let machine::Session::Editor(session) = &machine.session else {
            panic!("editor");
        };
        let mut diff = session.surface().view_diff().unwrap();
        assert!(
            machine
                .decorator_observer
                .prepare(&mut diff, false)
                .unwrap()
                .is_some(),
            "actual successful initialization is the remount boundary, not readiness authority"
        );
    }
}
