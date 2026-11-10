#![cfg(feature = "application")]

use doc_sync_core::{Access, Millis, Now, UnixMillis};
use document_session::{
    EditorConfig, EditorSurface, Surface, SurfaceConfig, application_editor_config,
};
use lexical_model::{EditorMode, SerializedEditorState};
use macro_document_model::EditorType;
use serde_json::json;
use std::sync::{Arc, atomic::AtomicI64};

#[test]
fn opening_a_metadata_free_document_keeps_the_persisted_state()
-> Result<(), Box<dyn std::error::Error>> {
    let source = macro_document_model::preset_builder_with_mode(
        EditorType::MarkdownSync,
        EditorMode::ViewAttached,
    )
    .initial_state(serde_json::from_value::<SerializedEditorState>(json!({
        "root": { "type": "root", "version": 1, "$": { "id": "metadata-root" }, "children": [
            { "type": "paragraph", "version": 1, "$": { "id": "metadata-block" }, "children": [
                { "type": "text", "version": 1, "text": "before", "$": { "id": "metadata-leaf" } }
            ] }
        ] }
    }))?)
    .build()?;
    let expected = source.state().to_json()?;
    assert!(
        expected
            .root
            .get("$")
            .and_then(|state| state.get("documentMetadata"))
            .is_none()
    );
    let snapshot = lexical_loro::snapshot::raw_state_to_loro_snapshot(
        &serde_json::to_value(&expected)?,
        None,
    )?;
    let doc = lexical_loro::new_doc(50)?;
    doc.import(&snapshot)?;
    let before_version = doc.oplog_vv();
    let before_raw = doc.get_deep_value();
    let now = Now {
        mono: Millis(0),
        wall: UnixMillis(0),
    };
    let config = application_editor_config(
        EditorConfig::default(),
        Arc::new(AtomicI64::new(0)),
        EditorType::MarkdownSync,
    );
    let mut surface =
        <EditorSurface as Surface>::construct(SurfaceConfig::Editor(config), 50, now)?;
    let mut effects = Vec::new();
    Surface::init(&mut surface, &doc, now, Access::Edit, &mut effects)?;
    let actual = surface.state().to_json()?;
    eprintln!(
        "{}",
        json!({
            "oplogChanged": doc.oplog_vv() != before_version,
            "rawDocumentChanged": doc.get_deep_value() != before_raw,
            "metadata": actual.root.get("$").and_then(|state| state.get("documentMetadata")),
            "modelEqual": actual == expected,
        })
    );
    assert_eq!(
        doc.oplog_vv(),
        before_version,
        "hydration wrote Loro operations"
    );
    assert_eq!(
        doc.get_deep_value(),
        before_raw,
        "hydration changed persisted fields"
    );
    assert_eq!(actual, expected, "hydration changed the public model");
    let paragraph = surface
        .state()
        .view()
        .first_child(lexical_model::NodeKey::ROOT)
        .expect("paragraph");
    let text = surface.state().view().first_child(paragraph).expect("text");
    let point = lexical_model::Point::text(text, lexical_model::Utf16Offset(6));
    let mut edit_effects = Vec::new();
    let changed = Surface::local(
        &mut surface,
        &doc,
        document_session::SessionInput::Editor(lexical_model::Input::Command {
            command: lexical_model::Command::InsertText("x".into()),
            selection: lexical_model::ViewSelection::Range {
                anchor: point,
                focus: point,
                resolution_dirty: false,
            },
        }),
        Now {
            mono: Millis(1),
            wall: UnixMillis(1),
        },
        Access::Edit,
        true,
        &mut edit_effects,
    )?;
    assert!(changed);
    let edited = surface.state().to_json()?;
    assert_eq!(edited.root["$"]["documentMetadata"]["version"], json!(10));
    assert_eq!(surface.state().root_text_content().as_ref(), "beforex");
    assert_ne!(doc.oplog_vv(), before_version);
    let edited_version = doc.oplog_vv();
    assert_eq!(
        surface.state().to_json()?,
        edited,
        "read-only export changed metadata"
    );
    assert_eq!(
        doc.oplog_vv(),
        edited_version,
        "read-only export wrote operations"
    );
    Ok(())
}

fn assert_no_document_writes(
    output: &document_session::SessionOutput,
) -> Result<(), Box<dyn std::error::Error>> {
    use bebop::Record;
    use doc_sync_core::{IoEffect, StorageOp};
    for effect in &output.io {
        match effect {
            IoEffect::Storage {
                op: StorageOp::WalAppend { .. },
                ..
            } => {
                panic!("opening emitted a WAL append");
            }
            IoEffect::SocketSend { frame, .. } => {
                assert_eq!(
                    frame.first(),
                    Some(&1),
                    "small open control unexpectedly fragmented"
                );
                let message = sync_protocol::FromPeer::deserialize(&frame[1..])?;
                assert!(
                    !matches!(
                        message,
                        sync_protocol::FromPeer::PeerUpdate { .. }
                            | sync_protocol::FromPeer::PeerCommentUpdate { .. }
                    ),
                    "opening emitted a document update"
                );
            }
            _ => {}
        }
    }
    assert!(
        !output
            .view
            .iter()
            .any(|effect| matches!(effect, document_session::ViewEffect::Error(_))),
        "opening returned a view error"
    );
    Ok(())
}

#[test]
fn cold_remote_open_has_no_wal_or_document_frame_before_the_first_edit()
-> Result<(), Box<dyn std::error::Error>> {
    use bebop::Record;
    use doc_sync_core::*;
    use document_session::{DocumentSession, SessionConfig, SessionInput};
    use lexical_model::*;
    let source = macro_document_model::preset_builder_with_mode(
        EditorType::MarkdownSync,
        EditorMode::ViewAttached,
    )
    .initial_state(serde_json::from_value(json!({ "root": {
        "type":"root", "version":1, "$":{"id":"cold-root"}, "children":[
            {"type":"paragraph","version":1,"$":{"id":"cold-block"},"children":[
                {"type":"text","version":1,"text":"before","$":{"id":"cold-leaf"}}
            ]}
        ]
    }}))?)
    .build()?;
    let expected = source.state().to_json()?;
    let snapshot = lexical_loro::snapshot::raw_state_to_loro_snapshot(
        &serde_json::to_value(&expected)?,
        None,
    )?;
    let baseline = lexical_loro::new_doc(80)?;
    baseline.import(&snapshot)?;
    let config = application_editor_config(
        EditorConfig::default(),
        Arc::new(AtomicI64::new(0)),
        EditorType::MarkdownSync,
    );
    let mut session = DocumentSession::<EditorSurface>::new(
        SessionConfig {
            sync: SyncConfig {
                doc: "metadata-open-control".parse()?,
                session: SessionId(uuid_value::Uuid::from_u128(1)),
                user: UserKey("fixture-user".into()),
                transport: TransportKind::Direct,
                persistence: Persistence::Durable,
                access: Access::Edit,
                initial_token: Some(SyncToken::new("fixture-token".into())),
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
            surface: SurfaceConfig::Editor(config),
        },
        Now {
            mono: Millis(0),
            wall: UnixMillis(0),
        },
    )?;
    let now = Now {
        mono: Millis(1),
        wall: UnixMillis(1),
    };
    let output = session.handle(now, SessionInput::Sync(SyncInput::Start));
    assert_no_document_writes(output)?;
    let load = output
        .io
        .iter()
        .find_map(|effect| match effect {
            IoEffect::Storage {
                id,
                op: StorageOp::Load { .. },
            } => Some(*id),
            _ => None,
        })
        .expect("real storage load");
    let conn = output
        .io
        .iter()
        .find_map(|effect| match effect {
            IoEffect::SocketConnect { conn, .. } => Some(*conn),
            _ => None,
        })
        .expect("real socket connect");
    let output = session.handle(
        now,
        SessionInput::Sync(SyncInput::Storage(StorageEvent::Loaded {
            id: load,
            result: Ok(LocalState {
                snapshot: None,
                orphans: vec![],
                assist: vec![],
            }),
        })),
    );
    assert_no_document_writes(output)?;
    assert_no_document_writes(session.handle(
        now,
        SessionInput::Sync(SyncInput::Socket {
            conn,
            event: SocketEvent::Opened,
        }),
    ))?;
    let mut bytes = Vec::new();
    sync_protocol::FromRemote::RemoteInitialSync {
        snapshot: bebop::SliceWrapper::from_cooked(&snapshot),
        awareness: bebop::SliceWrapper::from_cooked(&[]),
    }
    .serialize(&mut bytes)?;
    for frame in sync_protocol::framing::into_frames(&bytes, 900000) {
        assert_no_document_writes(session.handle(
            now,
            SessionInput::Sync(SyncInput::Socket {
                conn,
                event: SocketEvent::Frame(frame),
            }),
        ))?;
    }
    let mut bytes = Vec::new();
    let version = baseline.oplog_vv().encode();
    sync_protocol::FromRemote::RemoteUpdateSince {
        vv: bebop::SliceWrapper::from_cooked(&version),
        update: bebop::SliceWrapper::from_cooked(&[]),
    }
    .serialize(&mut bytes)?;
    for frame in sync_protocol::framing::into_frames(&bytes, 900000) {
        assert_no_document_writes(session.handle(
            now,
            SessionInput::Sync(SyncInput::Socket {
                conn,
                event: SocketEvent::Frame(frame),
            }),
        ))?;
    }
    assert_eq!(
        session.version(),
        baseline.oplog_vv(),
        "cold OPEN wrote local operations"
    );
    assert_eq!(session.surface().state().to_json()?, expected);
    let paragraph = session
        .surface()
        .state()
        .view()
        .first_child(NodeKey::ROOT)
        .expect("paragraph");
    let text = session
        .surface()
        .state()
        .view()
        .first_child(paragraph)
        .expect("text");
    let point = Point::text(text, Utf16Offset(6));
    let output = session.handle(
        Now {
            mono: Millis(2),
            wall: UnixMillis(2),
        },
        SessionInput::Editor(Input::Command {
            command: Command::InsertText("x".into()),
            selection: ViewSelection::Range {
                anchor: point,
                focus: point,
                resolution_dirty: false,
            },
        }),
    );
    let wake = output.wake_at;
    let row = output.io.iter().find_map(|effect| match effect {
        IoEffect::Storage {
            op: StorageOp::WalAppend { record, .. },
            ..
        } => Some(record.bytes.clone()),
        _ => None,
    });
    let edited = session.surface().state().to_json()?;
    assert_eq!(edited.root["$"]["documentMetadata"]["version"], json!(10));
    assert_eq!(
        session.surface().state().root_text_content().as_ref(),
        "beforex"
    );
    let version = session.version();
    assert_eq!(session.surface().state().to_json()?, edited);
    assert_eq!(
        session.version(),
        version,
        "read-only export changed version"
    );
    let row = match row {
        Some(row) => row,
        None => {
            let wake = wake.expect("actual first-edit append deadline");
            let output = session.handle(
                Now {
                    mono: wake,
                    wall: UnixMillis(i64::try_from(wake.0)?),
                },
                SessionInput::Sync(SyncInput::Tick),
            );
            output
                .io
                .iter()
                .find_map(|effect| match effect {
                    IoEffect::Storage {
                        op: StorageOp::WalAppend { record, .. },
                        ..
                    } => Some(record.bytes.clone()),
                    _ => None,
                })
                .expect("actual first-edit coalesced WAL")
        }
    };
    baseline.import(&row)?;
    let persisted = lexical_loro::reconstruct_initial_state(
        &baseline,
        &macro_document_model::sync::MACRO_SYNC_POLICY,
    )?;
    assert_eq!(
        persisted.state.root["$"]["documentMetadata"]["version"],
        json!(10),
        "same first edit WAL lacks metadata"
    );
    Ok(())
}
