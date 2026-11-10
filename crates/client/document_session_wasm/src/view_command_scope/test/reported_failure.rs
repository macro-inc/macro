use super::*;
use std::sync::atomic::AtomicBool;
struct Prefix;
impl Plugin for Prefix {
    fn name(&self) -> &'static str {
        "enter-prefix-fixture"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[CommandRegistration {
            command: CommandKind::Key(KeyCommand::Enter),
            priority: CommandPriority::Critical,
            placement: Placement::After,
        }]
    }
    fn handle(&self, tx: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("accepted prefix")?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.append(p.key(), &[text.key()])?;
        tx.select_end(text.key())?;
        Ok(Handled::No)
    }
}
struct FollowUp(Arc<AtomicBool>);
impl Plugin for FollowUp {
    fn name(&self) -> &'static str {
        "enter-follow-up-fixture"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[]
    }
    fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        Ok(Handled::No)
    }
    fn after_commit(&self, tx: &mut Transaction<'_>, _: &Commit) -> Result<(), Error> {
        if self.0.load(Ordering::SeqCst) {
            tx.dispatch(&enter())?;
        }
        Ok(())
    }
}
#[test]
fn real_reported_follow_up_error_binds_actual_view_effect_and_keeps_accepted_diff() {
    let config = wire::SessionConfigMsg {
        doc: "enter-failure-fixture".into(),
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
    let (mut config, _, _) = codec::config(config).unwrap();
    let enabled = Arc::new(AtomicBool::new(false));
    let after = enabled.clone();
    config.surface = document_session::SurfaceConfig::Editor(document_session::EditorConfig {
        builder: Arc::new(move |mode, peer| {
            document_session::default_editor_builder(mode, peer)
                .plugin(Prefix)
                .plugin(FollowUp(after.clone()))
        }),
        ..document_session::EditorConfig::default()
    });
    let now = doc_sync_core::Now {
        mono: doc_sync_core::Millis(0),
        wall: doc_sync_core::UnixMillis(0),
    };
    let mut session =
        document_session::DocumentSession::<document_session::EditorSurface>::new(config, now)
            .unwrap();
    let count = Arc::new(AtomicUsize::new(0));
    let seen = count.clone();
    let failed_scope = Arc::new(AtomicU64::new(0));
    let captured = failed_scope.clone();
    let registry = Registry::with_host(Arc::new(Transport(move |call: &Call| {
        if seen.fetch_add(1, Ordering::SeqCst) == 0 {
            Ok(true)
        } else {
            captured.store(call.scope.raw(), Ordering::SeqCst);
            Err(HostFailure::Thrown)
        }
    })))
    .unwrap();
    session.observe_reported_model_errors(registry.clone());
    session.handle(
        now,
        document_session::SessionInput::Sync(doc_sync_core::SyncInput::Start),
    );
    session.handle(
        now,
        document_session::SessionInput::Sync(doc_sync_core::SyncInput::Seed {
            kind: doc_sync_core::SeedKind::Optimistic,
            snapshot: vec![],
        }),
    );
    registry.register(&mut session, 1, 4).unwrap();
    enabled.store(true, Ordering::SeqCst);
    registry
        .invoke(doc_sync_core::Access::Edit, || {
            session.handle(
                now,
                document_session::SessionInput::Editor(Input::Command {
                    command: enter(),
                    selection: ViewSelection::KeepModel,
                }),
            )
        })
        .unwrap();
    assert_eq!(count.load(Ordering::SeqCst), 2);
    assert_eq!(
        session.surface().state().view().text_content(NodeKey::ROOT),
        "accepted prefix"
    );
    let out = session.last_output();
    assert!(out.view.iter().any(
        |effect| matches!(effect, document_session::ViewEffect::Diff(diff) if !diff.ops.is_empty())
    ));
    assert!(out.view.iter().any(|effect| matches!(
        effect,
        document_session::ViewEffect::Editor(Effect::FollowUpFailed { .. })
    )));
    let mut encoded = Vec::new();
    output::encode(out, false, &mut encoded, None, None).unwrap();
    assert!(!encoded.is_empty());
    registry.bind_output(&out.view);
    let lease = registry
        .take_failure()
        .unwrap()
        .expect("actual reported failure");
    assert_eq!(lease.scope(), failed_scope.load(Ordering::SeqCst));
    assert_eq!(lease.effect_ordinals().len(), 1);
    assert!(registry.take_failure().unwrap().is_none());
}

#[test]
fn exact_error_ordinal_includes_cursor_expansion_and_initialize_but_not_flat_diff() {
    use document_session::{EditorPeerSelection, InitialView, SessionError, ViewEffect};
    let owner = Id::issue().unwrap();
    let invocation = Id::issue().unwrap();
    let scope = Id::issue().unwrap();
    let cause = CallbackFailure {
        owner,
        invocation,
        scope,
    };
    let editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let diff = Diff {
        generation: 0,
        full_reconcile: false,
        view_text_matches: None,
        decorator_renders: vec![],
        ops: vec![],
    };
    let output = document_session::SessionOutput {
        view: vec![
            ViewEffect::Initialize(InitialView::Editor {
                diff: diff.clone(),
                state: editor.state().to_json().unwrap(),
            }),
            ViewEffect::Diff(diff),
            ViewEffect::Cursors(vec![
                EditorPeerSelection {
                    key: "cursor-one".into(),
                    color: "blue".into(),
                    selection: ViewSelection::None,
                },
                EditorPeerSelection {
                    key: "cursor-two".into(),
                    color: "green".into(),
                    selection: ViewSelection::None,
                },
            ]),
            ViewEffect::Error(SessionError::Model(Error::Invariant(
                "ordinary view command callback failed",
            ))),
            ViewEffect::Error(SessionError::Model(Error::Extension(Box::new(cause)))),
        ],
        ..Default::default()
    };
    let lease = failure::encode(
        &[failure::Report {
            cause,
            view_index: 4,
        }],
        &output.view,
    )
    .unwrap()
    .pop_front()
    .unwrap();
    assert_eq!(lease.effect_ordinals(), vec![5]);
    let mut encoded = Vec::new();
    output::encode(&output, false, &mut encoded, None, None).unwrap();
    let word = |offset| u32::from_le_bytes(encoded[offset..offset + 4].try_into().unwrap());
    let mut at = 24 + word(12) as usize * 4;
    at = (at + word(16) as usize + 3) & !3;
    let mut view = Vec::new();
    for _ in 0..word(20) {
        let tag = word(at);
        let length = word(at + 12) as usize;
        if tag == 16 {
            view.push(
                wire::ViewEffectMsg::deserialize(&encoded[at + 16..at + 16 + length]).unwrap(),
            );
        }
        at = (at + 16 + length + 3) & !3;
    }
    assert_eq!(view.len(), 6);
    assert_eq!(view[0].kind, 8);
    assert_eq!(view[1].kind, 10);
    assert_eq!(view[4].kind, 2);
    assert_eq!(view[5].kind, 2);
    assert_eq!(view[4].text, view[5].text);
    assert!(failure::encode(
        &[failure::Report {
            cause,
            view_index: 9
        }],
        &output.view
    )
    .is_err());
    assert!(failure::encode(
        &[failure::Report {
            cause,
            view_index: 2
        }],
        &output.view
    )
    .is_err());
}

struct UnrelatedFollowUp(Arc<AtomicBool>);
impl Plugin for UnrelatedFollowUp {
    fn name(&self) -> &'static str {
        "unrelated-follow-up-fixture"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[]
    }
    fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        Ok(Handled::No)
    }
    fn after_commit(&self, _: &mut Transaction<'_>, _: &Commit) -> Result<(), Error> {
        if self.0.load(Ordering::SeqCst) {
            return Err(Error::Invariant("unrelated native failure"));
        }
        Ok(())
    }
}
#[test]
fn caught_nested_callback_failure_cannot_poison_unrelated_reported_native_failure() {
    let config = wire::SessionConfigMsg {
        doc: "enter-caught-fixture".into(),
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
    let (mut config, _, _) = codec::config(config).unwrap();
    let enabled = Arc::new(AtomicBool::new(false));
    let after = enabled.clone();
    config.surface = document_session::SurfaceConfig::Editor(document_session::EditorConfig {
        builder: Arc::new(move |mode, peer| {
            document_session::default_editor_builder(mode, peer)
                .plugin(Prefix)
                .plugin(UnrelatedFollowUp(after.clone()))
        }),
        ..document_session::EditorConfig::default()
    });
    let now = doc_sync_core::Now {
        mono: doc_sync_core::Millis(0),
        wall: doc_sync_core::UnixMillis(0),
    };
    let mut session =
        document_session::DocumentSession::<document_session::EditorSurface>::new(config, now)
            .unwrap();
    let count = Arc::new(AtomicUsize::new(0));
    let seen = count.clone();
    let registry = Registry::with_host(Arc::new(Transport(move |call: &Call| {
        if seen.fetch_add(1, Ordering::SeqCst) == 0 {
            assert!(matches!(
                execute_current(call.scope.raw(), Operation::Enter),
                Err(BoundaryError::Model(Error::Extension(_)))
            ));
            Ok(true)
        } else {
            Err(HostFailure::Thrown)
        }
    })))
    .unwrap();
    session.observe_reported_model_errors(registry.clone());
    session.handle(
        now,
        document_session::SessionInput::Sync(doc_sync_core::SyncInput::Start),
    );
    session.handle(
        now,
        document_session::SessionInput::Sync(doc_sync_core::SyncInput::Seed {
            kind: doc_sync_core::SeedKind::Optimistic,
            snapshot: vec![],
        }),
    );
    registry.register(&mut session, 1, 4).unwrap();
    enabled.store(true, Ordering::SeqCst);
    registry
        .invoke(doc_sync_core::Access::Edit, || {
            session.handle(
                now,
                document_session::SessionInput::Editor(Input::Command {
                    command: enter(),
                    selection: ViewSelection::KeepModel,
                }),
            )
        })
        .unwrap();
    assert_eq!(count.load(Ordering::SeqCst), 2);
    let out = session.last_output();
    assert!(out.view.iter().any(|effect| matches!(effect,
        document_session::ViewEffect::Editor(Effect::FollowUpFailed { message, .. }) if message.as_ref() == "unrelated native failure")));
    registry.bind_output(&out.view);
    assert!(registry.take_failure().unwrap().is_none());
}
