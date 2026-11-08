//! Run the tracing subscriber in its own process, independent of parallel unit callsites.
use doc_sync_core::*;
use document_session::*;
use lexical_model::*;
fn time(ms: u64) -> Now {
    Now {
        mono: Millis(ms),
        wall: UnixMillis(ms as i64),
    }
}
#[test]
fn cold_flow_spans_exist_and_keystrokes_create_no_projection_or_editor_span() {
    use std::sync::{Arc, Mutex};
    struct Capture(Arc<Mutex<Vec<&'static str>>>);
    impl tracing::Subscriber for Capture {
        fn register_callsite(
            &self,
            _: &'static tracing::Metadata<'static>,
        ) -> tracing::subscriber::Interest {
            tracing::subscriber::Interest::sometimes()
        }
        fn max_level_hint(&self) -> Option<tracing::level_filters::LevelFilter> {
            Some(tracing::level_filters::LevelFilter::INFO)
        }
        fn enabled(&self, metadata: &tracing::Metadata<'_>) -> bool {
            *metadata.level() <= tracing::Level::INFO
                && (metadata.target().starts_with("document_session")
                    || metadata.target().starts_with("lexical_loro"))
        }
        fn new_span(&self, attrs: &tracing::span::Attributes<'_>) -> tracing::span::Id {
            let mut names = self.0.lock().unwrap();
            names.push(attrs.metadata().name());
            tracing::span::Id::from_u64(names.len() as u64 + 1)
        }
        fn record(&self, _: &tracing::span::Id, _: &tracing::span::Record<'_>) {}
        fn record_follows_from(&self, _: &tracing::span::Id, _: &tracing::span::Id) {}
        fn event(&self, _: &tracing::Event<'_>) {}
        fn enter(&self, _: &tracing::span::Id) {}
        fn exit(&self, _: &tracing::span::Id) {}
    }
    let names = Arc::new(Mutex::new(Vec::new()));
    tracing::subscriber::with_default(Capture(Arc::clone(&names)), || {
        let config = SessionConfig {
            sync: SyncConfig {
                doc: "telemetry-fixture".parse().unwrap(),
                session: serde_json::from_str("\"00000000-0000-0000-0000-000000000001\"").unwrap(),
                user: UserKey("fixture-user".into()),
                transport: TransportKind::None,
                persistence: Persistence::Memory,
                access: Access::Edit,
                initial_token: None,
                traceparent: None,
                timeouts: Timeouts::default(),
                heartbeat: HeartbeatPolicy::default(),
                backoff: BackoffPolicy::default(),
                converge: ConvergePolicy::default(),
                wal: WalPolicy::default(),
                snapshot_interval: None,
                presence: PresencePolicy {
                    timeout: WallDuration(10000),
                    refresh: None,
                    user: PresenceUser {
                        user_id: None,
                        color: PaletteColor::Blue,
                    },
                    key: PresenceKeyMode::Peer,
                },
                chatter: false,
                reset_budget: ResetBudget::default(),
            },
            peer_ids: vec![10, 11, 12],
            peer_range: PeerRange::User,
            surface: SurfaceConfig::Editor(EditorConfig::default()),
        };
        let mut session = DocumentSession::<EditorSurface>::new(config, time(0)).unwrap();
        session.handle(time(0), SessionInput::Sync(SyncInput::Start));
        session.handle(
            time(0),
            SessionInput::Sync(SyncInput::Seed {
                kind: SeedKind::Optimistic,
                snapshot: vec![],
            }),
        );
        for expected in [
            "session.create",
            "editor.open",
            "state.load",
            "view.initialize",
        ] {
            assert!(
                names.lock().unwrap().contains(&expected),
                "missing {expected}: {:?}",
                names.lock().unwrap().as_slice()
            );
        }
        names.lock().unwrap().clear();
        session.handle(
            time(1),
            SessionInput::Editor(Input::Command {
                command: Command::InsertText("x".into()),
                selection: ViewSelection::Range {
                    anchor: Point::element(NodeKey::ROOT, ChildIndex(0)),
                    focus: Point::element(NodeKey::ROOT, ChildIndex(0)),
                    resolution_dirty: false,
                },
            }),
        );
        assert!(names.lock().unwrap().is_empty(), "no keystroke spans");
        session.handle(
            time(2),
            SessionInput::Editor(Input::Command {
                command: Command::InsertText("y".repeat(150)),
                selection: ViewSelection::KeepModel,
            }),
        );
        session.handle(time(3), SessionInput::Editor(Input::Undo));
        for expected in ["editor.undo", "editor.history.loro", "editor.history.apply"] {
            assert!(
                names.lock().unwrap().contains(&expected),
                "missing {expected}: {:?}",
                names.lock().unwrap().as_slice()
            );
        }
        names.lock().unwrap().clear();
        let state = session.surface().state().to_json().unwrap();
        session.handle(
            time(4),
            SessionInput::Editor(Input::SetState {
                state,
                tags: TagSet::default(),
            }),
        );
        assert!(names.lock().unwrap().contains(&"editor.set_state"));
        let mut payload = ClipboardPayload::default();
        payload.data.insert("text/plain".into(), "fixture".into());
        session.handle(
            time(5),
            SessionInput::Editor(Input::Command {
                command: Command::Paste(payload),
                selection: ViewSelection::KeepModel,
            }),
        );
        assert!(names.lock().unwrap().contains(&"editor.paste"));
    });
}
