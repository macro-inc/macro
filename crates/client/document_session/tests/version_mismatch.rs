#![cfg(feature = "application")]

use doc_sync_core::{Access, Millis, Now, UnixMillis};
use document_session::{
    EditorConfig, EditorSurface, Surface, SurfaceConfig, application_editor_config,
};
use macro_document_model::EditorType;
use serde_json::json;
use std::sync::{Arc, atomic::AtomicI64};

// Source's versioned-state initializer returns an error before startSync/ready,
// independently of the RootNode transform callback (source-version.test.ts).
#[test]
fn newer_document_never_enters_ready_or_projects_local_open_writes()
-> Result<(), Box<dyn std::error::Error>> {
    for access in [Access::Edit, Access::Read, Access::CommentOnly] {
        let state = json!({"root": {
            "type":"root", "version":1,
            "$":{"id":"fixture-root","documentMetadata":{"version":12}},
            "children":[{"type":"paragraph", "version":1,
                "$":{"id":"fixture-block"}, "children":[
                    {"type":"text","version":1,"text":"Before","$":{"id":"fixture-leaf"}}
                ]}]
        }});
        let canonical = macro_document_model::preset_builder_with_mode(
            EditorType::MarkdownSync,
            lexical_model::EditorMode::ViewAttached,
        )
        .initial_state(serde_json::from_value(state)?)
        .build()?;
        let snapshot = lexical_loro::snapshot::raw_state_to_loro_snapshot(
            &serde_json::to_value(canonical.state().to_json()?)?,
            None,
        )?;
        let doc = lexical_loro::new_doc(50)?;
        doc.import(&snapshot)?;
        let before = doc.oplog_vv();
        let now = Now {
            mono: Millis(0),
            wall: UnixMillis(0),
        };
        let mut config = application_editor_config(
            EditorConfig::default(),
            Arc::new(AtomicI64::new(0)),
            EditorType::MarkdownSync,
        );
        // The dev writer must be fenced too; the session row below uses production policy.
        config.policy = &macro_document_model::sync::MACRO_SEARCH_TEXT_SYNC_POLICY;
        let mut surface =
            <EditorSurface as Surface>::construct(SurfaceConfig::Editor(config), 50, now)?;
        let mut effects = Vec::new();
        let result = Surface::init(&mut surface, &doc, now, access, &mut effects);
        assert!(
            result.is_err(),
            "newer document must fail admission for {access:?}"
        );
        assert_eq!(
            result.expect_err("newer version").to_string(),
            "VERSION_MISMATCH_ERROR"
        );
        assert_eq!(
            doc.oplog_vv(),
            before,
            "no open normalization, search text or export-producing write"
        );
        let shown = effects
            .iter()
            .find_map(|effect| match effect {
                document_session::ViewEffect::Initialize(
                    document_session::InitialView::Editor { state, .. },
                ) => Some(state),
                _ => None,
            })
            .expect("a rejected newer document retains its read-only presentation");
        assert_eq!(
            shown.root["children"][0]["children"][0]["text"],
            json!("Before")
        );
        assert!(!surface.history().can_undo);
        assert!(!surface.history().can_redo);
    }
    Ok(())
}

#[test]
fn rejected_newer_seed_never_starts_sync_or_accepts_editor_input()
-> Result<(), Box<dyn std::error::Error>> {
    use doc_sync_core::*;
    use document_session::{
        DocumentSession, SessionConfig, SessionError, SessionInput, ViewEffect,
    };
    use lexical_model::{Command, Input, ViewSelection};
    for access in [Access::Edit, Access::Read, Access::CommentOnly] {
        let canonical = macro_document_model::preset_builder_with_mode(
            EditorType::MarkdownSync,
            lexical_model::EditorMode::ViewAttached,
        )
        .initial_state(serde_json::from_value(json!({"root":{
            "type":"root","version":1,
            "$":{"documentMetadata":{"version":12,"environmentTags":null}},
            "children":[{"type":"paragraph","version":1,"children":[{"type":"text","version":1,"text":"Before"}]}]
        }}))?)
        .build()?;
        let snapshot = lexical_loro::snapshot::raw_state_to_loro_snapshot(
            &serde_json::to_value(canonical.state().to_json()?)?,
            None,
        )?;
        let now = Now {
            mono: Millis(0),
            wall: UnixMillis(0),
        };
        let mut session = DocumentSession::<EditorSurface>::new(
            SessionConfig {
                sync: SyncConfig {
                    doc: "version-admission-fixture".parse()?,
                    session: SessionId(uuid_value::Uuid::from_u128(1)),
                    user: UserKey("fixture-user".into()),
                    transport: TransportKind::None,
                    persistence: Persistence::Memory,
                    access,
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
                peer_ids: vec![50, 51, 52],
                peer_range: PeerRange::User,
                surface: SurfaceConfig::Editor(application_editor_config(
                    EditorConfig::default(),
                    Arc::new(AtomicI64::new(0)),
                    EditorType::MarkdownSync,
                )),
            },
            now,
        )?;
        session.handle(now, SessionInput::Sync(SyncInput::Start));
        let opened = session.handle(
            now,
            SessionInput::Sync(SyncInput::Seed {
                kind: SeedKind::Optimistic,
                snapshot,
            }),
        );
        assert!(
            opened
                .view
                .iter()
                .any(|effect| matches!(effect, ViewEffect::Error(SessionError::VersionMismatch)))
        );
        assert!(
            opened
                .view
                .iter()
                .any(|effect| matches!(effect, ViewEffect::Initialize(_)))
        );
        assert!(
            opened
                .io
                .iter()
                .all(|io| matches!(io, IoEffect::Telemetry(_))),
            "only startup telemetry, no Ready-driven export/send/storage"
        );
        #[cfg(feature = "conformance")]
        assert_ne!(session.conformance_sync().phase(), Phase::Running);
        let before = session.version();
        let selected = session.handle(
            now,
            SessionInput::Editor(Input::Command {
                command: Command::SelectAll(None),
                selection: ViewSelection::KeepModel,
            }),
        );
        assert!(
            selected
                .view
                .iter()
                .all(|effect| !matches!(effect, ViewEffect::Error(_)))
        );
        assert!(
            selected
                .io
                .iter()
                .all(|io| matches!(io, IoEffect::Telemetry(_)))
        );
        assert_eq!(
            session.version(),
            before,
            "read-only selection writes no Loro ops"
        );
        assert!(!session.surface().history().can_undo);
        assert!(!session.surface().history().can_redo);
        let rejected = session.handle(
            now,
            SessionInput::Editor(Input::Command {
                command: Command::InsertText("blocked".into()),
                selection: ViewSelection::KeepModel,
            }),
        );
        assert!(
            rejected
                .view
                .iter()
                .any(|effect| matches!(effect, ViewEffect::Error(SessionError::NotReady)))
        );
        assert!(
            rejected
                .io
                .iter()
                .all(|io| matches!(io, IoEffect::Telemetry(_)))
        );
        assert_eq!(session.version(), before);
    }
    Ok(())
}
