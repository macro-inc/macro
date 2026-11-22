#![cfg(feature = "application")]

use doc_sync_core::{Access, Millis, Now, UnixMillis};
use document_session::{
    EditorConfig, EditorSurface, Surface, SurfaceConfig, application_editor_config,
};
use lexical_model::{EditorMode, SerializedEditorState};
use macro_document_model::EditorType;
use serde_json::json;
use std::sync::{Arc, atomic::AtomicI64};

/// A metadata-free document opened for editing is upgraded before input (5cf r003 OFF),
/// so the first edit and later read-only exports write no metadata of their own.
#[test]
fn opening_a_metadata_free_document_upgrades_it_before_input()
-> Result<(), Box<dyn std::error::Error>> {
    use loro_internal::ToJson;
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
    let stored = source.state().to_json()?;
    let snapshot =
        lexical_loro::snapshot::raw_state_to_loro_snapshot(&serde_json::to_value(&stored)?, None)?;
    let doc = lexical_loro::new_doc(50)?;
    doc.import(&snapshot)?;
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
    assert_eq!(
        surface.state().to_json()?.root["$"]["documentMetadata"]["version"],
        json!(11)
    );
    assert_eq!(
        doc.get_deep_value().to_json_value()["root"]["$"]["documentMetadata"]["version"],
        json!(11)
    );
    let opened = doc.oplog_vv();
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
        document_session::LocalInputContext::new(
            Now {
                mono: Millis(1),
                wall: UnixMillis(1),
            },
            Access::Edit,
            true,
        ),
        &mut edit_effects,
        None,
    )?;
    assert!(changed);
    assert_eq!(surface.state().root_text_content().as_ref(), "beforex");
    let edit = op_shapes(&serde_json::to_value(
        doc.export_json_updates(&opened, &doc.oplog_vv())?,
    )?);
    assert!(
        !edit.contains(&(
            "Map".to_owned(),
            "insert".to_owned(),
            "documentMetadata".to_owned()
        )),
        "the first edit rewrote metadata: {edit:?}"
    );
    let edited = surface.state().to_json()?;
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

/// One op as (container kind, op kind, map key or "-").
type OpShape = (String, String, String);

/// Every op of a Loro JSON update export as (container kind, op kind, map key or "-");
/// peer and container ids are excluded and nothing is filtered.
fn op_shapes(updates: &serde_json::Value) -> Vec<OpShape> {
    updates["changes"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|change| change["ops"].as_array().cloned().unwrap_or_default())
        .map(|op| {
            let kind = op["container"]
                .as_str()
                .and_then(|id| id.rsplit(':').next())
                .unwrap_or("?")
                .to_owned();
            let action = op["content"]["type"].as_str().unwrap_or("?").to_owned();
            let key = op["content"]["key"].as_str().unwrap_or("-").to_owned();
            (kind, action, key)
        })
        .collect()
}

/// Handle one input as a host would: acknowledge every storage write, then fire the
/// timers it schedules within five seconds. Collects each WAL row and each sub-update of
/// every sent PeerUpdate frame.
fn drive(
    session: &mut document_session::DocumentSession<EditorSurface>,
    now: Now,
    input: document_session::SessionInput,
    rows: &mut Vec<Vec<u8>>,
    sent: &mut Vec<Vec<u8>>,
) -> Result<(), Box<dyn std::error::Error>> {
    use bebop::Record;
    use doc_sync_core::{IoEffect, StorageEvent, StorageOp, SyncInput};
    use document_session::SessionInput;
    let mut queue = std::collections::VecDeque::from([(now, input)]);
    let mut last = now.mono;
    while let Some((at, input)) = queue.pop_front() {
        let output = session.handle(at, input);
        for effect in &output.io {
            match effect {
                IoEffect::Storage { id, op } => {
                    if let StorageOp::WalAppend { record, .. } = op {
                        rows.push(record.bytes.clone());
                    }
                    if !matches!(op, StorageOp::Load { .. }) {
                        queue.push_back((
                            at,
                            SessionInput::Sync(SyncInput::Storage(StorageEvent::Done {
                                id: *id,
                                result: Ok(()),
                            })),
                        ));
                    }
                }
                IoEffect::SocketSend { frame, .. } => {
                    if frame.first() != Some(&1) {
                        return Err("fragmented frame in a small load control".into());
                    }
                    if let sync_protocol::FromPeer::PeerUpdate { updates, .. } =
                        sync_protocol::FromPeer::deserialize(&frame[1..])?
                    {
                        sent.extend(updates.iter().map(|update| update.to_vec()));
                    }
                }
                _ => {}
            }
        }
        if queue.is_empty()
            && let Some(wake) = output
                .wake_at
                .filter(|wake| wake.0 > last.0 && wake.0 <= now.mono.0 + 5000)
        {
            last = wake;
            queue.push_back((
                Now {
                    mono: wake,
                    wall: UnixMillis(i64::try_from(wake.0)?),
                },
                SessionInput::Sync(SyncInput::Tick),
            ));
        }
    }
    Ok(())
}

/// Source writes paragraph searchText, then root documentMetadata, in their own local
/// updates after the initial sync; undoing the first edit keeps both.
fn load_normalisation_survives_first_edit_undo(
    socket_delay: u32,
) -> Result<(), Box<dyn std::error::Error>> {
    use bebop::Record;
    use doc_sync_core::*;
    use document_session::{DocumentSession, SessionConfig, SessionInput};
    use lexical_model::*;
    use loro_internal::ToJson;
    let stored = json!({ "root": {
        "type":"root", "version":1, "format":"", "indent":0, "direction":null,
        "$":{"id":"root"}, "children":[
            {"type":"paragraph","version":1,"format":"","indent":0,"direction":null,
             "textFormat":0,"textStyle":"","$":{"id":"Ts1gplV5"},"children":[]}
        ]
    }});
    let snapshot = lexical_loro::snapshot::raw_state_to_loro_snapshot(&stored, None)?;
    let baseline = lexical_loro::new_doc(80)?;
    baseline.import(&snapshot)?;
    let opened = baseline.oplog_vv();
    let mut config = application_editor_config(
        EditorConfig::default(),
        Arc::new(AtomicI64::new(0)),
        EditorType::MarkdownSync,
    );
    config.policy = &macro_document_model::sync::MACRO_SEARCH_TEXT_SYNC_POLICY;
    let mut session = DocumentSession::<EditorSurface>::new(
        SessionConfig {
            sync: SyncConfig {
                doc: "load-normalisation".parse()?,
                session: SessionId(uuid_value::Uuid::from_u128(2)),
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
    let at = |ms: u32| Now {
        mono: Millis(u64::from(ms)),
        wall: UnixMillis(i64::from(ms)),
    };
    let mut rows = Vec::new();
    let mut sent = Vec::new();
    let output = session.handle(at(1), SessionInput::Sync(SyncInput::Start));
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
    drive(
        &mut session,
        at(1),
        SessionInput::Sync(SyncInput::Storage(StorageEvent::Loaded {
            id: load,
            result: Ok(LocalState {
                snapshot: None,
                orphans: vec![],
                assist: vec![],
            }),
        })),
        &mut rows,
        &mut sent,
    )?;
    drive(
        &mut session,
        at(1 + socket_delay),
        SessionInput::Sync(SyncInput::Socket {
            conn,
            event: SocketEvent::Opened,
        }),
        &mut rows,
        &mut sent,
    )?;
    let synced = 2 + socket_delay;
    let mut bytes = Vec::new();
    sync_protocol::FromRemote::RemoteInitialSync {
        snapshot: bebop::SliceWrapper::from_cooked(&snapshot),
        awareness: bebop::SliceWrapper::from_cooked(&[]),
    }
    .serialize(&mut bytes)?;
    for frame in sync_protocol::framing::into_frames(&bytes, 900000) {
        drive(
            &mut session,
            at(synced),
            SessionInput::Sync(SyncInput::Socket {
                conn,
                event: SocketEvent::Frame(frame),
            }),
            &mut rows,
            &mut sent,
        )?;
    }
    let mut bytes = Vec::new();
    let version = opened.encode();
    sync_protocol::FromRemote::RemoteUpdateSince {
        vv: bebop::SliceWrapper::from_cooked(&version),
        update: bebop::SliceWrapper::from_cooked(&[]),
    }
    .serialize(&mut bytes)?;
    for frame in sync_protocol::framing::into_frames(&bytes, 900000) {
        drive(
            &mut session,
            at(synced + 67),
            SessionInput::Sync(SyncInput::Socket {
                conn,
                event: SocketEvent::Frame(frame),
            }),
            &mut rows,
            &mut sent,
        )?;
    }

    // Before any input: the sent updates carry exactly the load-time normalisation, in
    // Source order (5cf r003 OFF frame 288 B: 105 B searchText, then 126 B
    // documentMetadata). The per-commit boundary is pinned at the surface by
    // load_normalisation_is_two_local_commits_in_source_order. Sub-update and WAL row
    // counts are recorded, not asserted: native coalesces local commits within 25 ms into
    // one WAL row and one sub-update, a named transport-granularity difference (t1yg ruling).
    eprintln!(
        "load sub-updates: native {}, Source 2; WAL rows: native {}, Source 2",
        sent.len(),
        rows.len()
    );
    let loaded = lexical_loro::new_doc(81)?;
    loaded.import(&snapshot)?;
    for update in &sent {
        loaded.import(update)?;
    }
    assert_eq!(
        op_shapes(&serde_json::to_value(
            loaded.export_json_updates(&opened, &loaded.oplog_vv())?
        )?),
        [
            (
                "Map".to_owned(),
                "insert".to_owned(),
                "searchText".to_owned()
            ),
            (
                "Map".to_owned(),
                "insert".to_owned(),
                "documentMetadata".to_owned()
            ),
            ("Map".to_owned(), "insert".to_owned(), "version".to_owned()),
        ],
        "load-time normalisation sent before input"
    );
    let raw = loaded.get_deep_value().to_json_value();
    assert_eq!(raw["root"]["children"][0]["$"]["searchText"], json!(""));
    assert_eq!(raw["root"]["$"]["documentMetadata"]["version"], json!(11));
    // write-path-3 (decode 5f5e1b4e): the load group is a Source undo item.
    assert!(
        session.surface().history().can_undo,
        "load group is undoable"
    );
    assert!(!session.surface().history().can_redo);

    // Enter, then undo it, as the fuzzer tape does.
    let paragraph = session
        .surface()
        .state()
        .view()
        .first_child(NodeKey::ROOT)
        .expect("paragraph");
    let point = Point::element(paragraph, ChildIndex(0));
    let entered = synced + 1060;
    drive(
        &mut session,
        at(entered),
        SessionInput::Editor(Input::Command {
            command: Command::InsertParagraph,
            selection: ViewSelection::Range {
                anchor: point,
                focus: point,
                resolution_dirty: false,
            },
        }),
        &mut rows,
        &mut sent,
    )?;
    assert_eq!(
        session
            .surface()
            .state()
            .view()
            .children(NodeKey::ROOT)
            .count(),
        2
    );
    drive(
        &mut session,
        at(entered + 160),
        SessionInput::Editor(Input::Command {
            command: Command::Undo,
            selection: ViewSelection::KeepModel,
        }),
        &mut rows,
        &mut sent,
    )?;

    // Reopen from the server base plus every WAL row.
    let reopened = lexical_loro::new_doc(82)?;
    reopened.import(&snapshot)?;
    for row in &rows {
        reopened.import(row)?;
    }
    let raw = reopened.get_deep_value().to_json_value();
    assert_eq!(raw["root"]["children"].as_array().map(Vec::len), Some(1));
    assert_eq!(
        raw["root"]["children"][0]["$"]["searchText"],
        json!(""),
        "undoing the first edit removed searchText"
    );
    assert_eq!(
        raw["root"]["$"]["documentMetadata"]["version"],
        json!(11),
        "undoing the first edit removed documentMetadata"
    );
    Ok(())
}

#[test]
fn load_normalisation_is_its_own_update_on_a_fast_socket() -> Result<(), Box<dyn std::error::Error>>
{
    load_normalisation_survives_first_edit_undo(26)
}

#[test]
fn load_normalisation_is_its_own_update_on_a_delayed_socket()
-> Result<(), Box<dyn std::error::Error>> {
    load_normalisation_survives_first_edit_undo(5000)
}

/// A writable surface over the 5cf tape's stale document (root id plus one empty
/// paragraph, no metadata or searchText), opened with the search-text policy.
fn open_stale_document() -> Result<(EditorSurface, loro::LoroDoc), Box<dyn std::error::Error>> {
    let stored = json!({ "root": {
        "type":"root", "version":1, "format":"", "indent":0, "direction":null,
        "$":{"id":"root"}, "children":[
            {"type":"paragraph","version":1,"format":"","indent":0,"direction":null,
             "textFormat":0,"textStyle":"","$":{"id":"Ts1gplV5"},"children":[]}
        ]
    }});
    let snapshot = lexical_loro::snapshot::raw_state_to_loro_snapshot(&stored, None)?;
    let doc = lexical_loro::new_doc(50)?;
    doc.import(&snapshot)?;
    let mut config = application_editor_config(
        EditorConfig::default(),
        Arc::new(AtomicI64::new(0)),
        EditorType::MarkdownSync,
    );
    config.policy = &macro_document_model::sync::MACRO_SEARCH_TEXT_SYNC_POLICY;
    let now = Now {
        mono: Millis(0),
        wall: UnixMillis(0),
    };
    let mut surface =
        <EditorSurface as Surface>::construct(SurfaceConfig::Editor(config), 50, now)?;
    Surface::init(&mut surface, &doc, now, Access::Edit, &mut Vec::new())?;
    Ok((surface, doc))
}

/// Apply one local input at `ms` and return the op shapes it exported.
fn local_input(
    surface: &mut EditorSurface,
    doc: &loro::LoroDoc,
    input: lexical_model::Input,
    ms: u32,
) -> Result<Vec<OpShape>, Box<dyn std::error::Error>> {
    let before = doc.oplog_vv();
    Surface::local(
        surface,
        doc,
        document_session::SessionInput::Editor(input),
        document_session::LocalInputContext::new(
            Now {
                mono: Millis(u64::from(ms)),
                wall: UnixMillis(i64::from(ms)),
            },
            Access::Edit,
            true,
        ),
        &mut Vec::new(),
        None,
    )?;
    Ok(op_shapes(&serde_json::to_value(
        doc.export_json_updates(&before, &doc.oplog_vv())?,
    )?))
}

fn map_op(action: &str, key: &str) -> OpShape {
    ("Map".to_owned(), action.to_owned(), key.to_owned())
}

fn stored_root(doc: &loro::LoroDoc) -> serde_json::Value {
    use loro_internal::ToJson;
    doc.get_deep_value().to_json_value()["root"].clone()
}

/// write-path-3 [Enter, Undo, Undo] (forensics 414abf76): Enter is its own group; the
/// first Undo reverts only Enter, the second reverts both load commits in one step, and
/// the live model keeps version 11.
#[test]
fn enter_undo_undo_reverts_enter_then_the_load_group() -> Result<(), Box<dyn std::error::Error>> {
    use lexical_model::*;
    let (mut surface, doc) = open_stale_document()?;
    let paragraph = surface
        .state()
        .view()
        .first_child(NodeKey::ROOT)
        .expect("paragraph");
    let point = Point::element(paragraph, ChildIndex(0));
    local_input(
        &mut surface,
        &doc,
        Input::Command {
            command: Command::InsertParagraph,
            selection: ViewSelection::Range {
                anchor: point,
                focus: point,
                resolution_dirty: false,
            },
        },
        1060,
    )?;
    assert!(surface.history().can_undo);
    let undo = || Input::Command {
        command: Command::Undo,
        selection: ViewSelection::KeepModel,
    };
    local_input(&mut surface, &doc, undo(), 1220)?;
    let root = stored_root(&doc);
    assert_eq!(root["children"].as_array().map(Vec::len), Some(1));
    assert_eq!(root["$"]["documentMetadata"]["version"], json!(11));
    assert_eq!(root["children"][0]["$"]["searchText"], json!(""));
    assert!(surface.history().can_undo);
    assert!(surface.history().can_redo);
    let second = local_input(&mut surface, &doc, undo(), 2470)?;
    assert_eq!(
        second,
        [
            map_op("delete", "documentMetadata"),
            map_op("delete", "searchText")
        ],
        "the second Undo reverts both load commits in one step"
    );
    assert!(!surface.history().can_undo);
    assert!(surface.history().can_redo);
    assert_eq!(
        surface.state().to_json()?.root["$"]["documentMetadata"]["version"],
        json!(11),
        "the live model retains the metadata"
    );
    Ok(())
}

/// write-path-3 Undo-first (forensics fe4c58ed), then Redo (Ctrl+Shift+Z a816121a and
/// Ctrl+Y e0562d33 both): Undo deletes both in one step; Redo re-adds both in one step.
#[test]
fn undo_first_then_redo_reverts_and_restores_the_load_group()
-> Result<(), Box<dyn std::error::Error>> {
    use lexical_model::*;
    let (mut surface, doc) = open_stale_document()?;
    let undone = local_input(
        &mut surface,
        &doc,
        Input::Command {
            command: Command::Undo,
            selection: ViewSelection::KeepModel,
        },
        1000,
    )?;
    assert_eq!(
        undone,
        [
            map_op("delete", "documentMetadata"),
            map_op("delete", "searchText")
        ]
    );
    assert!(!surface.history().can_undo);
    assert!(surface.history().can_redo);
    let redone = local_input(
        &mut surface,
        &doc,
        Input::Command {
            command: Command::Redo,
            selection: ViewSelection::KeepModel,
        },
        2000,
    )?;
    assert_eq!(
        redone,
        [
            map_op("insert", "documentMetadata"),
            map_op("insert", "version"),
            map_op("insert", "searchText"),
        ]
    );
    assert!(surface.history().can_undo);
    assert!(!surface.history().can_redo);
    let root = stored_root(&doc);
    assert_eq!(root["$"]["documentMetadata"], json!({"version": 11}));
    assert_eq!(root["children"][0]["$"]["searchText"], json!(""));
    Ok(())
}

/// write-path-3 [Undo-first, type 'a'] (forensics 981022b7; 4ddec tail7 7827c38f): the
/// edit's own single update carries its text ops, the paragraph searchText with its new
/// derived value, and the retained documentMetadata in a new map.
#[test]
fn an_edit_after_undo_first_re_emits_metadata_and_search_text_inside_its_own_update()
-> Result<(), Box<dyn std::error::Error>> {
    use lexical_model::*;
    let (mut surface, doc) = open_stale_document()?;
    assert_eq!(
        stored_root(&doc)["$"]["documentMetadata"],
        json!({"version": 11}),
        "the open wrote the load metadata"
    );
    local_input(
        &mut surface,
        &doc,
        Input::Command {
            command: Command::Undo,
            selection: ViewSelection::KeepModel,
        },
        1000,
    )?;
    assert!(stored_root(&doc)["$"].get("documentMetadata").is_none());
    let paragraph = surface
        .state()
        .view()
        .first_child(NodeKey::ROOT)
        .expect("paragraph");
    let point = Point::element(paragraph, ChildIndex(0));
    let before = doc.oplog_vv();
    let edit = local_input(
        &mut surface,
        &doc,
        Input::Command {
            command: Command::InsertText("a".into()),
            selection: ViewSelection::Range {
                anchor: point,
                focus: point,
                resolution_dirty: false,
            },
        },
        2000,
    )?;
    let changes = serde_json::to_value(doc.export_json_updates(&before, &doc.oplog_vv())?)?;
    assert_eq!(
        changes["changes"].as_array().map(Vec::len),
        Some(1),
        "one update"
    );
    for expected in [
        map_op("insert", "searchText"),
        map_op("insert", "documentMetadata"),
    ] {
        assert!(edit.contains(&expected), "missing {expected:?} in {edit:?}");
    }
    let root = stored_root(&doc);
    assert_eq!(root["$"]["documentMetadata"], json!({"version": 11}));
    assert_eq!(root["children"][0]["$"]["searchText"], json!("a"));
    Ok(())
}

/// write-path-4 [Ctrl+Z, type 'a', Ctrl+Z] (decode e9061543): the next Undo is one
/// step reverting the edit together with its re-emitted metadata and searchText.
#[test]
fn undo_after_the_re_emitting_edit_reverts_it_with_its_re_emit()
-> Result<(), Box<dyn std::error::Error>> {
    use lexical_model::*;
    let (mut surface, doc) = open_stale_document()?;
    assert_eq!(
        stored_root(&doc)["$"]["documentMetadata"],
        json!({"version": 11}),
        "the open wrote the load metadata"
    );
    let undo = || Input::Command {
        command: Command::Undo,
        selection: ViewSelection::KeepModel,
    };
    local_input(&mut surface, &doc, undo(), 1000)?;
    assert!(
        stored_root(&doc)["$"].get("documentMetadata").is_none(),
        "Undo-first removed the load metadata"
    );
    let paragraph = surface
        .state()
        .view()
        .first_child(NodeKey::ROOT)
        .expect("paragraph");
    let point = Point::element(paragraph, ChildIndex(0));
    local_input(
        &mut surface,
        &doc,
        Input::Command {
            command: Command::InsertText("a".into()),
            selection: ViewSelection::Range {
                anchor: point,
                focus: point,
                resolution_dirty: false,
            },
        },
        2000,
    )?;
    let undone = local_input(&mut surface, &doc, undo(), 4000)?;
    for expected in [
        (
            "MovableList".to_owned(),
            "delete".to_owned(),
            "-".to_owned(),
        ),
        map_op("delete", "documentMetadata"),
        map_op("delete", "searchText"),
    ] {
        assert!(
            undone.contains(&expected),
            "missing {expected:?} in {undone:?}"
        );
    }
    let root = stored_root(&doc);
    assert!(root["$"].get("documentMetadata").is_none());
    assert_eq!(root["children"][0]["children"], json!([]));
    Ok(())
}

/// write-path-4 [Ctrl+Z, type 'a', Ctrl+Shift+Z] (decode e9061543): the edit clears the
/// redo stack, so Redo sends nothing and changes nothing.
#[test]
fn redo_after_a_fresh_edit_is_a_no_op() -> Result<(), Box<dyn std::error::Error>> {
    use lexical_model::*;
    let (mut surface, doc) = open_stale_document()?;
    assert_eq!(
        stored_root(&doc)["$"]["documentMetadata"],
        json!({"version": 11}),
        "the open wrote the load metadata"
    );
    local_input(
        &mut surface,
        &doc,
        Input::Command {
            command: Command::Undo,
            selection: ViewSelection::KeepModel,
        },
        1000,
    )?;
    assert!(
        stored_root(&doc)["$"].get("documentMetadata").is_none(),
        "Undo-first removed the load metadata"
    );
    let paragraph = surface
        .state()
        .view()
        .first_child(NodeKey::ROOT)
        .expect("paragraph");
    let point = Point::element(paragraph, ChildIndex(0));
    local_input(
        &mut surface,
        &doc,
        Input::Command {
            command: Command::InsertText("a".into()),
            selection: ViewSelection::Range {
                anchor: point,
                focus: point,
                resolution_dirty: false,
            },
        },
        2000,
    )?;
    let model = surface.state().to_json()?;
    let stored = stored_root(&doc);
    let redone = local_input(
        &mut surface,
        &doc,
        Input::Command {
            command: Command::Redo,
            selection: ViewSelection::KeepModel,
        },
        4000,
    )?;
    assert_eq!(
        redone,
        Vec::new(),
        "redo after a fresh edit wrote {redone:?}"
    );
    assert_eq!(surface.state().to_json()?, model);
    assert_eq!(stored_root(&doc), stored);
    Ok(())
}

/// Reopen (forensics 5486fba0) and first open by another peer (final-receipt 605dfc47):
/// metadata stored bare by a load write gains environmentTags:null from the next open's
/// load follow-up, as ONE op into the existing map.
#[test]
fn reopening_bare_stored_metadata_writes_the_parsed_null_slot()
-> Result<(), Box<dyn std::error::Error>> {
    use loro::ContainerTrait;
    use std::sync::Mutex;
    let stored = json!({ "root": {
        "type":"root", "version":1, "format":"", "indent":0, "direction":null,
        "$":{"id":"root"}, "children":[
            {"type":"paragraph","version":1,"format":"","indent":0,"direction":null,
             "textFormat":0,"textStyle":"","$":{"id":"Ts1gplV5","searchText":""},"children":[]}
        ]
    }});
    let snapshot = lexical_loro::snapshot::raw_state_to_loro_snapshot(&stored, None)?;
    // A Source peer's load write: documentMetadata as a Map container holding version 11.
    let writer = lexical_loro::new_doc(60)?;
    writer.import(&snapshot)?;
    let root_state = match writer.get_map("root").get("$") {
        Some(loro::ValueOrContainer::Container(loro::Container::Map(map))) => map,
        _ => return Err("root state map".into()),
    };
    let metadata = root_state.insert_container("documentMetadata", loro::LoroMap::new())?;
    metadata.insert("version", 11)?;
    writer.commit();
    assert_eq!(
        stored_root(&writer)["$"]["documentMetadata"],
        json!({"version": 11})
    );
    assert!(metadata.id().is_normal());
    let doc = lexical_loro::new_doc(51)?;
    doc.import(&writer.export(loro::ExportMode::Snapshot)?)?;
    let opened = doc.oplog_vv();
    let commits = Arc::new(Mutex::new(0_usize));
    let counted = commits.clone();
    let _subscription = doc.subscribe_local_update(Box::new(move |_| {
        if let Ok(mut commits) = counted.lock() {
            *commits += 1;
        }
        true
    }));
    let mut config = application_editor_config(
        EditorConfig::default(),
        Arc::new(AtomicI64::new(0)),
        EditorType::MarkdownSync,
    );
    config.policy = &macro_document_model::sync::MACRO_SEARCH_TEXT_SYNC_POLICY;
    let now = Now {
        mono: Millis(0),
        wall: UnixMillis(0),
    };
    let mut surface =
        <EditorSurface as Surface>::construct(SurfaceConfig::Editor(config), 51, now)?;
    Surface::init(&mut surface, &doc, now, Access::Edit, &mut Vec::new())?;
    assert_eq!(*commits.lock().map_err(|_| "commit count lock")?, 1);
    assert_eq!(
        op_shapes(&serde_json::to_value(
            doc.export_json_updates(&opened, &doc.oplog_vv())?
        )?),
        [map_op("insert", "environmentTags")]
    );
    assert_eq!(
        stored_root(&doc)["$"]["documentMetadata"],
        json!({"version": 11, "environmentTags": null})
    );
    Ok(())
}

/// Type `text` at the caret, collecting the view effects the session publishes.
fn type_text(
    surface: &mut EditorSurface,
    doc: &loro::LoroDoc,
    text: &str,
    ms: u32,
) -> Result<Vec<document_session::ViewEffect>, Box<dyn std::error::Error>> {
    use lexical_model::*;
    let selection = match surface.state().view().last_descendant(NodeKey::ROOT) {
        Some(key) if surface.state().view().is_text(key) => {
            let end = Point::text(
                key,
                Utf16Offset(u32::try_from(
                    surface
                        .state()
                        .view()
                        .text_content(key)
                        .encode_utf16()
                        .count(),
                )?),
            );
            ViewSelection::Range {
                anchor: end,
                focus: end,
                resolution_dirty: false,
            }
        }
        _ => {
            let paragraph = surface
                .state()
                .view()
                .first_child(NodeKey::ROOT)
                .expect("paragraph");
            let point = Point::element(paragraph, ChildIndex(0));
            ViewSelection::Range {
                anchor: point,
                focus: point,
                resolution_dirty: false,
            }
        }
    };
    let mut effects = Vec::new();
    Surface::local(
        surface,
        doc,
        document_session::SessionInput::Editor(Input::Command {
            command: Command::InsertText(text.into()),
            selection,
        }),
        document_session::LocalInputContext::new(
            Now {
                mono: Millis(u64::from(ms)),
                wall: UnixMillis(i64::from(ms)),
            },
            Access::Edit,
            true,
        ),
        &mut effects,
        None,
    )?;
    Ok(effects)
}

fn effect_kinds(effects: &[document_session::ViewEffect]) -> Vec<String> {
    use document_session::ViewEffect;
    effects
        .iter()
        .map(|effect| match effect {
            ViewEffect::ChecklistPlans(_) => "ChecklistPlans".to_owned(),
            ViewEffect::Initialize(_) => "Initialize".to_owned(),
            ViewEffect::Diff(_) => "Diff".to_owned(),
            ViewEffect::Editor(editor) => {
                let debug = format!("{editor:?}");
                let end = debug.find(['(', '{', ' ']).unwrap_or(debug.len());
                format!("Editor:{}", &debug[..end])
            }
            ViewEffect::HistoryAwarenessSelection { .. } => "HistoryAwarenessSelection".to_owned(),
            ViewEffect::DocChanged(_) => "DocChanged".to_owned(),
            ViewEffect::Presence(_) => "Presence".to_owned(),
            ViewEffect::CommitTags(tags) => format!("CommitTags:{tags:?}"),
            ViewEffect::Cursors(_) => "Cursors".to_owned(),
            ViewEffect::Status(_) => "Status".to_owned(),
            ViewEffect::Reply { .. } => "Reply".to_owned(),
            ViewEffect::EndComposition => "EndComposition".to_owned(),
            ViewEffect::Error(_) => "Error".to_owned(),
        })
        .collect()
}

/// The stored-slot supersede rides the edit's own publication: the view receives the
/// same commit tags and one diff, exactly as for an edit without it.
#[test]
fn the_re_emitting_edit_publishes_like_an_ordinary_edit() -> Result<(), Box<dyn std::error::Error>>
{
    use lexical_model::*;
    // Baseline with the same undo transitions but no supersede: stored metadata is already
    // the parsed live form, so the load group writes only searchText.
    let stored = json!({ "root": {
        "type":"root", "version":1, "format":"", "indent":0, "direction":null,
        "$":{"id":"root"}, "children":[
            {"type":"paragraph","version":1,"format":"","indent":0,"direction":null,
             "textFormat":0,"textStyle":"","$":{"id":"Ts1gplV5"},"children":[]}
        ]
    }});
    let snapshot = lexical_loro::snapshot::raw_state_to_loro_snapshot(&stored, None)?;
    let writer = lexical_loro::new_doc(60)?;
    writer.import(&snapshot)?;
    let root_state = match writer.get_map("root").get("$") {
        Some(loro::ValueOrContainer::Container(loro::Container::Map(map))) => map,
        _ => return Err("root state map".into()),
    };
    let metadata = root_state.insert_container("documentMetadata", loro::LoroMap::new())?;
    metadata.insert("version", 11)?;
    metadata.insert("environmentTags", loro::LoroValue::Null)?;
    writer.commit();
    let ordinary_doc = lexical_loro::new_doc(50)?;
    ordinary_doc.import(&writer.export(loro::ExportMode::Snapshot)?)?;
    let mut config = application_editor_config(
        EditorConfig::default(),
        Arc::new(AtomicI64::new(0)),
        EditorType::MarkdownSync,
    );
    config.policy = &macro_document_model::sync::MACRO_SEARCH_TEXT_SYNC_POLICY;
    let opened = Now {
        mono: Millis(0),
        wall: UnixMillis(0),
    };
    let mut ordinary =
        <EditorSurface as Surface>::construct(SurfaceConfig::Editor(config), 50, opened)?;
    Surface::init(
        &mut ordinary,
        &ordinary_doc,
        opened,
        Access::Edit,
        &mut Vec::new(),
    )?;
    local_input(
        &mut ordinary,
        &ordinary_doc,
        Input::Command {
            command: Command::Undo,
            selection: ViewSelection::KeepModel,
        },
        1000,
    )?;
    assert!(
        stored_root(&ordinary_doc)["children"][0]["$"]
            .get("searchText")
            .is_none()
    );
    let plain = type_text(&mut ordinary, &ordinary_doc, "a", 2000)?;
    let (mut re_emitting, doc) = open_stale_document()?;
    local_input(
        &mut re_emitting,
        &doc,
        Input::Command {
            command: Command::Undo,
            selection: ViewSelection::KeepModel,
        },
        1000,
    )?;
    assert!(stored_root(&doc)["$"].get("documentMetadata").is_none());
    let flagged = type_text(&mut re_emitting, &doc, "a", 2000)?;
    assert_eq!(
        stored_root(&doc)["$"]["documentMetadata"],
        json!({"version": 11})
    );
    assert_eq!(effect_kinds(&flagged), effect_kinds(&plain));
    Ok(())
}

/// Guard: after the re-emitting edit, an edit 399 ms later still merges and one 401 ms
/// later starts a new entry. Loro's 400 ms merge interval decides this grouping; the test
/// cannot detect a MergeTracker effect.
#[test]
fn guard_the_supersede_keeps_loro_merge_interval_grouping() -> Result<(), Box<dyn std::error::Error>>
{
    use lexical_model::*;
    let (mut surface, doc) = open_stale_document()?;
    let undo = || Input::Command {
        command: Command::Undo,
        selection: ViewSelection::KeepModel,
    };
    local_input(&mut surface, &doc, undo(), 1000)?;
    type_text(&mut surface, &doc, "a", 2000)?;
    type_text(&mut surface, &doc, "b", 2399)?;
    type_text(&mut surface, &doc, "c", 2800)?;
    assert_eq!(surface.state().root_text_content().as_ref(), "abc");
    local_input(&mut surface, &doc, undo(), 4000)?;
    assert_eq!(
        surface.state().root_text_content().as_ref(),
        "ab",
        "401 ms split"
    );
    local_input(&mut surface, &doc, undo(), 5000)?;
    assert_eq!(
        surface.state().root_text_content().as_ref(),
        "",
        "399 ms merge"
    );
    assert!(stored_root(&doc)["$"].get("documentMetadata").is_none());
    Ok(())
}

/// Live OFF profile (live-profile.json 2a10869b): a stale document whose last block is a
/// table gains its trailing empty paragraph in the load follow-up, with the metadata, after
/// the search text. Fixture: that create-route document's shape (table keys stored as null)
/// without the trailing paragraph and metadata.
#[test]
fn the_load_follow_up_runs_root_transforms_after_a_final_table()
-> Result<(), Box<dyn std::error::Error>> {
    use std::sync::Mutex;
    let stored: serde_json::Value =
        serde_json::from_str(include_str!("testdata/table-last-stale.json"))?;
    let snapshot = lexical_loro::snapshot::raw_state_to_loro_snapshot(&stored, None)?;
    let doc = lexical_loro::new_doc(50)?;
    doc.import(&snapshot)?;
    let commits = Arc::new(Mutex::new(Vec::<Vec<u8>>::new()));
    let captured = commits.clone();
    let _subscription = doc.subscribe_local_update(Box::new(move |bytes| {
        if let Ok(mut commits) = captured.lock() {
            commits.push(bytes.clone());
        }
        true
    }));
    let mut config = application_editor_config(
        EditorConfig::default(),
        Arc::new(AtomicI64::new(0)),
        EditorType::MarkdownSync,
    );
    config.policy = &macro_document_model::sync::MACRO_SEARCH_TEXT_SYNC_POLICY;
    let now = Now {
        mono: Millis(0),
        wall: UnixMillis(0),
    };
    let mut surface =
        <EditorSurface as Surface>::construct(SurfaceConfig::Editor(config), 50, now)?;
    Surface::init(&mut surface, &doc, now, Access::Edit, &mut Vec::new())?;
    let root = stored_root(&doc);
    let types: Vec<_> = root["children"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|child| child["type"].clone())
        .collect();
    assert_eq!(
        types,
        [json!("paragraph"), json!("table"), json!("paragraph")]
    );
    assert_eq!(root["$"]["documentMetadata"], json!({"version": 11}));
    let replay = lexical_loro::new_doc(81)?;
    replay.import(&snapshot)?;
    let mut per_commit = Vec::new();
    for commit in commits.lock().map_err(|_| "commit capture lock")?.iter() {
        let before = replay.oplog_vv();
        replay.import(commit)?;
        per_commit.push(op_shapes(&serde_json::to_value(
            replay.export_json_updates(&before, &replay.oplog_vv())?,
        )?));
    }
    assert_eq!(per_commit.len(), 2, "{per_commit:?}");
    let trailing = (
        "MovableList".to_owned(),
        "insert".to_owned(),
        "-".to_owned(),
    );
    assert!(per_commit[0].contains(&map_op("insert", "searchText")));
    assert!(
        !per_commit[0].contains(&trailing)
            && !per_commit[0].contains(&map_op("insert", "documentMetadata")),
        "the search-text commit carries neither the paragraph nor the metadata: {:?}",
        per_commit[0]
    );
    for expected in [
        map_op("insert", "documentMetadata"),
        (
            "MovableList".to_owned(),
            "insert".to_owned(),
            "-".to_owned(),
        ),
    ] {
        assert!(
            per_commit[1].contains(&expected),
            "the metadata follow-up appends the trailing paragraph: missing {expected:?} in {:?}",
            per_commit[1]
        );
    }
    Ok(())
}

/// An already-normalized document (current version, environmentTags present, searchText
/// present) opens with no Loro commit and no undo item.
#[test]
fn opening_a_normalized_document_writes_nothing() -> Result<(), Box<dyn std::error::Error>> {
    use std::sync::Mutex;
    let stored = json!({ "root": {
        "type":"root", "version":1, "format":"", "indent":0, "direction":null,
        "$":{"id":"root"}, "children":[
            {"type":"paragraph","version":1,"format":"","indent":0,"direction":null,
             "textFormat":0,"textStyle":"","$":{"id":"Ts1gplV5","searchText":""},"children":[]}
        ]
    }});
    let snapshot = lexical_loro::snapshot::raw_state_to_loro_snapshot(&stored, None)?;
    let writer = lexical_loro::new_doc(60)?;
    writer.import(&snapshot)?;
    let root_state = match writer.get_map("root").get("$") {
        Some(loro::ValueOrContainer::Container(loro::Container::Map(map))) => map,
        _ => return Err("root state map".into()),
    };
    let metadata = root_state.insert_container("documentMetadata", loro::LoroMap::new())?;
    metadata.insert("version", 11)?;
    metadata.insert("environmentTags", loro::LoroValue::Null)?;
    writer.commit();
    let doc = lexical_loro::new_doc(50)?;
    doc.import(&writer.export(loro::ExportMode::Snapshot)?)?;
    let opened = doc.oplog_vv();
    let commits = Arc::new(Mutex::new(0_usize));
    let counted = commits.clone();
    let _subscription = doc.subscribe_local_update(Box::new(move |_| {
        if let Ok(mut commits) = counted.lock() {
            *commits += 1;
        }
        true
    }));
    let mut config = application_editor_config(
        EditorConfig::default(),
        Arc::new(AtomicI64::new(0)),
        EditorType::MarkdownSync,
    );
    config.policy = &macro_document_model::sync::MACRO_SEARCH_TEXT_SYNC_POLICY;
    let now = Now {
        mono: Millis(0),
        wall: UnixMillis(0),
    };
    let mut surface =
        <EditorSurface as Surface>::construct(SurfaceConfig::Editor(config), 50, now)?;
    Surface::init(&mut surface, &doc, now, Access::Edit, &mut Vec::new())?;
    assert_eq!(*commits.lock().map_err(|_| "commit count lock")?, 0);
    assert_eq!(doc.oplog_vv(), opened);
    assert!(
        !surface.history().can_undo,
        "an empty load group is no undo item"
    );
    assert!(!surface.history().can_redo);
    Ok(())
}

/// Guard, NAMED DIFFERENCE (unreachable): native SetState replaces the live model, so a
/// payload without root documentMetadata deletes it at once, while Source's setEditorState
/// reports no mutated nodes and syncs nothing. No app module sends a native EditorSetState
/// with an external state (R003 freeze grep: only the generated ABI and the empty
/// envelope placeholder; Source's setEditorState sites are initial loads, separate
/// composer/headless editors and comment staging). ast-grep ts/tsx-no-editor-set-state
/// keeps it that way; this pins the native behaviour.
#[test]
fn guard_set_state_without_root_metadata_deletes_it_unreachable_from_the_app()
-> Result<(), Box<dyn std::error::Error>> {
    use lexical_model::*;
    let stored = json!({ "root": {
        "type":"root", "version":1, "format":"", "indent":0, "direction":null,
        "$":{"id":"root"}, "children":[
            {"type":"paragraph","version":1,"format":"","indent":0,"direction":null,
             "textFormat":0,"textStyle":"","$":{"id":"Ts1gplV5","searchText":""},"children":[]}
        ]
    }});
    let snapshot = lexical_loro::snapshot::raw_state_to_loro_snapshot(&stored, None)?;
    let writer = lexical_loro::new_doc(60)?;
    writer.import(&snapshot)?;
    let root_state = match writer.get_map("root").get("$") {
        Some(loro::ValueOrContainer::Container(loro::Container::Map(map))) => map,
        _ => return Err("root state map".into()),
    };
    let metadata = root_state.insert_container("documentMetadata", loro::LoroMap::new())?;
    metadata.insert("version", 11)?;
    metadata.insert("environmentTags", loro::LoroValue::Null)?;
    writer.commit();
    let doc = lexical_loro::new_doc(50)?;
    doc.import(&writer.export(loro::ExportMode::Snapshot)?)?;
    let mut config = application_editor_config(
        EditorConfig::default(),
        Arc::new(AtomicI64::new(0)),
        EditorType::MarkdownSync,
    );
    config.policy = &macro_document_model::sync::MACRO_SEARCH_TEXT_SYNC_POLICY;
    let now = Now {
        mono: Millis(0),
        wall: UnixMillis(0),
    };
    let mut surface =
        <EditorSurface as Surface>::construct(SurfaceConfig::Editor(config), 50, now)?;
    Surface::init(&mut surface, &doc, now, Access::Edit, &mut Vec::new())?;
    let mut state = surface.state().to_json()?;
    if let Some(serde_json::Value::Object(root_state)) = state.root.get_mut("$") {
        root_state.shift_remove("documentMetadata");
    }
    state.root["children"][0]["children"] =
        json!([{"type":"text","version":1,"text":"set","$":{"id":"set-leaf"}}]);
    let set = local_input(
        &mut surface,
        &doc,
        Input::SetState {
            state,
            tags: TagSet::default(),
        },
        1000,
    )?;
    assert_eq!(
        set.last(),
        Some(&map_op("delete", "documentMetadata")),
        "SetState deletes the stored metadata: {set:?}"
    );
    assert!(
        !set.contains(&map_op("insert", "documentMetadata")),
        "{set:?}"
    );
    assert!(stored_root(&doc)["$"].get("documentMetadata").is_none());
    Ok(())
}

/// Table-field capture (C) (table-fields-C.json 61b52218, G turn 20261113T184801Z): the
/// first OFF load of a create-route table, whose four table keys and cell widths are stored
/// as null, sends U1 (search text, then deletes of the null keys the editor leaves
/// undefined) and U2 (trailing paragraph, resizer colWidths, documentMetadata). Fixture:
/// Source's received snapshot bytes.
#[test]
fn first_load_of_a_null_shaped_table_matches_source_load_ops()
-> Result<(), Box<dyn std::error::Error>> {
    // RemoteInitialSync snapshot from table-fields-C.json (frame 76a3b836), SHA-256
    // 068385486dcf504fa2b211ea5d9b04ac3d1bf779ca2925e5e0c9df771e68ee97.
    let (surface, doc, per_commit) =
        open_stored(include_bytes!("testdata/table-null-shape-received.loro"))?;
    let u1 = vec![
        map_op("insert", "searchText"),
        map_op("delete", "width"),
        map_op("delete", "width"),
        map_op("delete", "width"),
        map_op("delete", "width"),
        map_op("insert", "searchText"),
        map_op("delete", "frozenColumnCount"),
        map_op("delete", "frozenRowCount"),
        map_op("delete", "rowStriping"),
    ];
    let u2 = vec![
        (
            "MovableList".to_owned(),
            "insert".to_owned(),
            "-".to_owned(),
        ),
        map_op("insert", "children"),
        map_op("insert", "direction"),
        map_op("insert", "format"),
        map_op("insert", "indent"),
        map_op("insert", "type"),
        map_op("insert", "version"),
        map_op("insert", "$"),
        map_op("insert", "id"),
        map_op("insert", "searchText"),
        map_op("insert", "textFormat"),
        map_op("insert", "textStyle"),
        map_op("insert", "colWidths"),
        ("List".to_owned(), "insert".to_owned(), "-".to_owned()),
        map_op("insert", "documentMetadata"),
        map_op("insert", "version"),
    ];
    // Pins the commit split and each commit's op multiset; op order inside an update is a
    // named difference (new-container field order), the stored state is identical.
    let sorted = |mut ops: Vec<OpShape>| {
        ops.sort();
        ops
    };
    let native: Vec<_> = per_commit.into_iter().map(sorted).collect();
    assert_eq!(
        native,
        [sorted(u1), sorted(u2)],
        "load commits vs Source U1, U2"
    );
    let root = stored_root(&doc);
    let table = &root["children"][1];
    assert_eq!(table["colWidths"], json!([120, 120]));
    for key in ["frozenColumnCount", "frozenRowCount", "rowStriping"] {
        assert!(table.get(key).is_none(), "{key} stays stored after load");
    }
    let cell = &table["children"][0]["children"][0];
    assert!(
        cell.get("width").is_none(),
        "cell width stays stored after load"
    );
    assert_eq!(cell["backgroundColor"], serde_json::Value::Null);
    assert_eq!(root["children"].as_array().map(Vec::len), Some(3));
    assert!(surface.history().can_undo);
    Ok(())
}

/// A writable surface, its document and the op shapes of each local commit its open made.
type Opened = (EditorSurface, loro::LoroDoc, Vec<Vec<OpShape>>);

/// Open the captured received snapshot `snapshot` for editing with the search-text policy
/// and return the surface, the document and the op shapes of each local commit the open made.
fn open_stored(snapshot: &[u8]) -> Result<Opened, Box<dyn std::error::Error>> {
    open_stored_in(snapshot, EditorConfig::default())
}

/// Open `snapshot` as the browser does: a view-attached editor with browser history
/// awareness (application_editor_config enables it for a non-native view host).
fn open_stored_in_browser(snapshot: &[u8]) -> Result<Opened, Box<dyn std::error::Error>> {
    open_stored_in(
        snapshot,
        EditorConfig {
            mode: lexical_model::EditorMode::ViewAttached,
            ..EditorConfig::default()
        },
    )
}

fn open_stored_in(
    snapshot: &[u8],
    editor: EditorConfig,
) -> Result<Opened, Box<dyn std::error::Error>> {
    use std::sync::Mutex;
    let doc = lexical_loro::new_doc(50)?;
    doc.import(snapshot)?;
    let base = snapshot.to_vec();
    let commits = Arc::new(Mutex::new(Vec::<Vec<u8>>::new()));
    let captured = commits.clone();
    let subscription = doc.subscribe_local_update(Box::new(move |bytes| {
        if let Ok(mut commits) = captured.lock() {
            commits.push(bytes.clone());
        }
        true
    }));
    let mut config = application_editor_config(
        editor,
        Arc::new(AtomicI64::new(0)),
        EditorType::MarkdownSync,
    );
    config.policy = &macro_document_model::sync::MACRO_SEARCH_TEXT_SYNC_POLICY;
    let now = Now {
        mono: Millis(0),
        wall: UnixMillis(0),
    };
    let mut surface =
        <EditorSurface as Surface>::construct(SurfaceConfig::Editor(config), 50, now)?;
    Surface::init(&mut surface, &doc, now, Access::Edit, &mut Vec::new())?;
    drop(subscription);
    let replay = lexical_loro::new_doc(81)?;
    replay.import(&base)?;
    let mut per_commit = Vec::new();
    for commit in commits.lock().map_err(|_| "commit capture lock")?.iter() {
        let before = replay.oplog_vv();
        replay.import(commit)?;
        per_commit.push(op_shapes(&serde_json::to_value(
            replay.export_json_updates(&before, &replay.oplog_vv())?,
        )?));
    }
    Ok((surface, doc, per_commit))
}

#[path = "metadata_hydration/table_reopen.rs"]
mod table_reopen;

/// Undo of the first load restores the stored nulls in Loro; Source's Mirror holds them
/// again, so the next local edit deletes them again (t1yn condition 2).
#[test]
fn an_edit_after_undoing_the_first_table_load_deletes_the_restored_nulls()
-> Result<(), Box<dyn std::error::Error>> {
    use lexical_model::*;
    let (mut surface, doc, _) =
        open_stored(include_bytes!("testdata/table-null-shape-received.loro"))?;
    local_input(
        &mut surface,
        &doc,
        Input::Command {
            command: Command::Undo,
            selection: ViewSelection::KeepModel,
        },
        1000,
    )?;
    let restored = stored_root(&doc);
    assert_eq!(
        restored["children"][1]["frozenRowCount"],
        serde_json::Value::Null
    );
    assert!(
        restored["children"][1].get("frozenRowCount").is_some(),
        "undo restored the null"
    );
    let paragraph = surface
        .state()
        .view()
        .first_child(NodeKey::ROOT)
        .expect("paragraph");
    let text = surface.state().view().first_child(paragraph).expect("text");
    let point = Point::text(text, Utf16Offset(5));
    let edit = local_input(
        &mut surface,
        &doc,
        Input::Command {
            command: Command::InsertText("!".into()),
            selection: ViewSelection::Range {
                anchor: point,
                focus: point,
                resolution_dirty: false,
            },
        },
        2000,
    )?;
    for key in [
        "frozenColumnCount",
        "frozenRowCount",
        "rowStriping",
        "width",
    ] {
        assert!(
            edit.contains(&map_op("delete", key)),
            "missing delete {key}: {edit:?}"
        );
    }
    let table = &stored_root(&doc)["children"][1];
    assert!(table.get("frozenRowCount").is_none());
    Ok(())
}

/// Source stored-field control (apps/web .../collaboration/storedFieldSync.test.ts, real
/// Lexical nodes and loro-mirror): each snapshot stores one field on every node of a type;
/// Source loads it and types once. Native must write the same ops for that field by its
/// first local edit (Source has no load write here, native folds its load refresh in).
#[test]
fn stored_fields_are_rewritten_like_source_at_the_first_local_sync()
-> Result<(), Box<dyn std::error::Error>> {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/testdata/source-stored-field-sync");
    let cases: Vec<serde_json::Value> =
        serde_json::from_slice(&std::fs::read(dir.join("cases.json"))?)?;
    assert_eq!(cases.len(), 32);
    let mut mismatches = Vec::new();
    for case in &cases {
        let name = case["name"].as_str().ok_or("case name")?;
        let field = case["field"].as_str().ok_or("case field")?;
        let file = case["file"].as_str().ok_or("case file")?;
        let source = case["source"].as_str().ok_or("case verdict")?;
        let snapshot = std::fs::read(dir.join(file))?;
        let stored = lexical_loro::new_doc(82)?;
        stored.import(&snapshot)?;
        let (mut surface, doc, _) = match open_stored(&snapshot) {
            Ok(opened) => opened,
            Err(error) => {
                mismatches.push(format!(
                    "{name}: source {source}, native open failed: {error}"
                ));
                continue;
            }
        };
        if let Err(error) = type_text(&mut surface, &doc, "!", 1000) {
            mismatches.push(format!(
                "{name}: source {source}, native edit failed: {error}"
            ));
            continue;
        }
        let updates =
            serde_json::to_value(doc.export_json_updates(&stored.oplog_vv(), &doc.oplog_vv())?)?;
        let mut actions: Vec<String> = updates["changes"]
            .as_array()
            .into_iter()
            .flatten()
            .flat_map(|change| change["ops"].as_array().cloned().unwrap_or_default())
            .filter(|op| op["content"]["key"] == field)
            .map(|op| match op["content"]["type"].as_str() {
                Some("delete") => "delete".to_owned(),
                _ => format!("write {}", op["content"]["value"]),
            })
            .collect();
        actions.sort();
        actions.dedup();
        let native = if actions.is_empty() {
            "keep".to_owned()
        } else {
            actions.join(", ")
        };
        if native != source {
            mismatches.push(format!("{name}: source {source}, native {native}"));
        }
    }
    assert!(mismatches.is_empty(), "{mismatches:#?}");
    Ok(())
}

/// G counted h-undo-typed-run (q-counted-20261113T203337Z, first diff eeabbec4): in a
/// UI-created document (current metadata), typing a run and undoing it restores the first
/// paragraph from Loro, and Source's reconcile carries the stored `$.searchText` ('' from the
/// load group) into the live model.
#[test]
fn undo_restores_the_stored_search_text_into_the_live_model_like_source()
-> Result<(), Box<dyn std::error::Error>> {
    use lexical_model::*;
    let stored = json!({ "root": {
        "type":"root", "version":1, "format":"", "indent":0, "direction":null,
        "$":{"id":"root","documentMetadata":{"version":11}}, "children":[
            {"type":"paragraph","version":1,"format":"","indent":0,"direction":null,
             "textFormat":0,"textStyle":"","$":{"id":"Ts1gplV5"},"children":[]}
        ]
    }});
    let snapshot = lexical_loro::snapshot::raw_state_to_loro_snapshot(&stored, None)?;
    let (mut surface, doc, _) = open_stored_in_browser(&snapshot)?;
    assert_eq!(
        stored_root(&doc)["children"][0]["$"]["searchText"],
        json!("")
    );
    // One input per keystroke, as the browser sends them.
    for (index, character) in "hello".chars().enumerate() {
        type_text(
            &mut surface,
            &doc,
            &character.to_string(),
            2000 + 8 * u32::try_from(index)?,
        )?;
    }
    assert_eq!(
        stored_root(&doc)["children"][0]["$"]["searchText"],
        json!("hello")
    );
    local_input(
        &mut surface,
        &doc,
        Input::Command {
            command: Command::Undo,
            selection: ViewSelection::KeepModel,
        },
        3000,
    )?;
    assert_eq!(
        stored_root(&doc)["children"][0]["$"]["searchText"],
        json!("")
    );
    let live = serde_json::to_value(surface.state().to_json()?)?;
    assert_eq!(live["root"]["children"][0]["children"], json!([]));
    assert_eq!(
        live["root"]["children"][0]["$"],
        json!({"id": "Ts1gplV5", "searchText": ""}),
        "the restored paragraph keeps the stored searchText, as Source's reconcile does"
    );
    // The browser's serializedState uses the streaming writer.
    let streamed: serde_json::Value = serde_json::from_str(&surface.state().to_json_string()?)?;
    assert_eq!(
        streamed["root"]["children"][0]["$"],
        live["root"]["children"][0]["$"]
    );
    Ok(())
}

/// G counted h-undo-stops-at-enter (q-counted-20261113T203337Z, first diff 032573d4): after
/// 'ab', Enter, 'cd' and one undo, Source's reconcile walks the whole stored state, so the
/// untouched first paragraph's stored `$.searchText` ('ab') also reaches the live model.
#[test]
fn undo_brings_stored_search_text_into_untouched_blocks_like_source()
-> Result<(), Box<dyn std::error::Error>> {
    use lexical_model::*;
    let stored = json!({ "root": {
        "type":"root", "version":1, "format":"", "indent":0, "direction":null,
        "$":{"id":"root","documentMetadata":{"version":11}}, "children":[
            {"type":"paragraph","version":1,"format":"","indent":0,"direction":null,
             "textFormat":0,"textStyle":"","$":{"id":"Ts1gplV5"},"children":[]}
        ]
    }});
    let snapshot = lexical_loro::snapshot::raw_state_to_loro_snapshot(&stored, None)?;
    let (mut surface, doc, _) = open_stored_in_browser(&snapshot)?;
    type_text(&mut surface, &doc, "ab", 2000)?;
    let first = surface
        .state()
        .view()
        .first_child(NodeKey::ROOT)
        .expect("paragraph");
    let end = Point::text(
        surface.state().view().first_child(first).expect("text"),
        Utf16Offset(2),
    );
    local_input(
        &mut surface,
        &doc,
        Input::Command {
            command: Command::InsertParagraph,
            selection: ViewSelection::Range {
                anchor: end,
                focus: end,
                resolution_dirty: false,
            },
        },
        3000,
    )?;
    type_text(&mut surface, &doc, "cd", 4000)?;
    local_input(
        &mut surface,
        &doc,
        Input::Command {
            command: Command::Undo,
            selection: ViewSelection::KeepModel,
        },
        5000,
    )?;
    let live = serde_json::to_value(surface.state().to_json()?)?;
    assert_eq!(live["root"]["children"][1]["children"], json!([]));
    assert_eq!(
        live["root"]["children"][0]["$"]["searchText"],
        json!("ab"),
        "the untouched first paragraph carries its stored searchText, as Source's reconcile does: {}",
        live["root"]["children"][0]["$"]
    );
    // owner-40 forensics: Source's reconcile gives every block its stored searchText,
    // the emptied second paragraph included.
    assert_eq!(
        live["root"]["children"][1]["$"]["searchText"],
        json!(""),
        "the emptied paragraph carries its stored searchText too: {}",
        live["root"]["children"][1]["$"]
    );
    let streamed: serde_json::Value = serde_json::from_str(&surface.state().to_json_string()?)?;
    assert_eq!(streamed["root"]["children"], live["root"]["children"]);
    Ok(())
}

/// Source's collab reconcile (reconcile.ts 2bae81a4 :48-62, :130-148) runs on every
/// Loro-driven update and copies each block's stored own JSON, `$.searchText` included, into
/// the live model when it differs. So a remote edit in one block also brings this peer's own
/// stored searchText into the other block's model.
#[test]
fn a_remote_update_brings_stored_search_text_into_the_live_model_like_source()
-> Result<(), Box<dyn std::error::Error>> {
    use lexical_model::*;
    let stored = json!({ "root": {
        "type":"root", "version":1, "format":"", "indent":0, "direction":null,
        "$":{"id":"root","documentMetadata":{"version":11}}, "children":[
            {"type":"paragraph","version":1,"format":"","indent":0,"direction":null,
             "textFormat":0,"textStyle":"","$":{"id":"Ts1gplV5"},"children":[]},
            {"type":"paragraph","version":1,"format":"","indent":0,"direction":null,
             "textFormat":0,"textStyle":"","$":{"id":"Pb2remot"},"children":[]}
        ]
    }});
    let snapshot = lexical_loro::snapshot::raw_state_to_loro_snapshot(&stored, None)?;
    let (mut a, a_doc, _) = open_stored_in_browser(&snapshot)?;
    let first = a
        .state()
        .view()
        .first_child(NodeKey::ROOT)
        .expect("paragraph");
    let point = Point::element(first, ChildIndex(0));
    local_input(
        &mut a,
        &a_doc,
        Input::Command {
            command: Command::InsertText("ab".into()),
            selection: ViewSelection::Range {
                anchor: point,
                focus: point,
                resolution_dirty: false,
            },
        },
        2000,
    )?;
    assert_eq!(
        stored_root(&a_doc)["children"][0]["$"]["searchText"],
        json!("ab")
    );
    // A local commit runs no reconcile, so the live model still lacks it.
    let typed = serde_json::to_value(a.state().to_json()?)?;
    assert!(
        typed["root"]["children"][0]["$"]
            .get("searchText")
            .is_none(),
        "{}",
        typed["root"]["children"][0]["$"]
    );
    // A peer changes only the second paragraph's own map, and adds an ordinary state key
    // to it: other `$` keys already track Loro on import.
    let b_doc = lexical_loro::new_doc(60)?;
    b_doc.import(&a_doc.export(loro::ExportMode::Snapshot)?)?;
    let before = b_doc.oplog_vv();
    let second = match b_doc.get_map("root").get("children") {
        Some(loro::ValueOrContainer::Container(loro::Container::MovableList(children))) => {
            match children.get(1) {
                Some(loro::ValueOrContainer::Container(loro::Container::Map(map))) => map,
                _ => return Err("second paragraph map".into()),
            }
        }
        _ => return Err("root children".into()),
    };
    second.insert("textStyle", "color: red")?;
    match second.get("$") {
        Some(loro::ValueOrContainer::Container(loro::Container::Map(state))) => {
            state.insert("peerNote", "kept")?;
        }
        _ => return Err("second paragraph state map".into()),
    }
    b_doc.commit();
    a_doc.import(&b_doc.export(loro::ExportMode::updates(&before))?)?;
    Surface::remote(
        &mut a,
        &a_doc,
        Now {
            mono: Millis(3000),
            wall: UnixMillis(3000),
        },
        Access::Edit,
        &mut Vec::new(),
    )?;
    let live = serde_json::to_value(a.state().to_json()?)?;
    assert_eq!(
        live["root"]["children"][1]["textStyle"],
        json!("color: red")
    );
    assert_eq!(live["root"]["children"][1]["$"]["peerNote"], json!("kept"));
    assert_eq!(
        live["root"]["children"][0]["$"]["searchText"],
        json!("ab"),
        "the untouched block carries its stored searchText after the remote update: {}",
        live["root"]["children"][0]["$"]
    );
    Ok(())
}

/// Remote-table capture (table-remote.redecoded.json 40ec3d83): peer B's open writes the
/// parsed environmentTags:null slot; peer A, whose live metadata lacks it, deletes it at its
/// next keystroke; B, whose live metadata holds it, re-inserts it at its next keystroke.
#[test]
fn environment_tags_null_round_trips_across_two_peers_like_source()
-> Result<(), Box<dyn std::error::Error>> {
    let (mut a, a_doc) = open_stale_document()?;
    assert_eq!(
        stored_root(&a_doc)["$"]["documentMetadata"],
        json!({"version": 11})
    );
    let b_doc = lexical_loro::new_doc(60)?;
    b_doc.import(&a_doc.export(loro::ExportMode::Snapshot)?)?;
    let mut config = application_editor_config(
        EditorConfig::default(),
        Arc::new(AtomicI64::new(0)),
        EditorType::MarkdownSync,
    );
    config.policy = &macro_document_model::sync::MACRO_SEARCH_TEXT_SYNC_POLICY;
    let at = |ms: u32| Now {
        mono: Millis(u64::from(ms)),
        wall: UnixMillis(i64::from(ms)),
    };
    let mut b = <EditorSurface as Surface>::construct(SurfaceConfig::Editor(config), 60, at(0))?;
    let b_opened = b_doc.oplog_vv();
    Surface::init(&mut b, &b_doc, at(0), Access::Edit, &mut Vec::new())?;
    let b_open = op_shapes(&serde_json::to_value(
        b_doc.export_json_updates(&b_opened, &b_doc.oplog_vv())?,
    )?);
    assert_eq!(b_open, [map_op("insert", "environmentTags")], "B's open");

    let a_before = a_doc.oplog_vv();
    a_doc.import(&b_doc.export(loro::ExportMode::updates(&a_before))?)?;
    Surface::remote(&mut a, &a_doc, at(1000), Access::Edit, &mut Vec::new())?;
    type_text(&mut a, &a_doc, "a", 2000)?;
    let a_typed = a_doc.oplog_vv();
    let a_ops = {
        let after_remote = {
            let mut vv = a_before.clone();
            vv.merge(&b_doc.oplog_vv());
            vv
        };
        op_shapes(&serde_json::to_value(
            a_doc.export_json_updates(&after_remote, &a_typed)?,
        )?)
    };
    assert!(
        a_ops.contains(&map_op("delete", "environmentTags")),
        "A's keystroke deletes B's null slot: {a_ops:?}"
    );

    let b_before = b_doc.oplog_vv();
    b_doc.import(&a_doc.export(loro::ExportMode::updates(&b_before))?)?;
    Surface::remote(&mut b, &b_doc, at(3000), Access::Edit, &mut Vec::new())?;
    let b_synced = b_doc.oplog_vv();
    type_text(&mut b, &b_doc, "b", 4000)?;
    let b_ops = op_shapes(&serde_json::to_value(
        b_doc.export_json_updates(&b_synced, &b_doc.oplog_vv())?,
    )?);
    assert!(
        b_ops.contains(&map_op("insert", "environmentTags")),
        "B's keystroke re-inserts its null slot: {b_ops:?}"
    );
    Ok(())
}

/// Source's writeStateToLoro skips read-only editors; load normalisation never reaches Loro.
#[test]
fn read_and_comment_only_opens_write_no_load_normalisation()
-> Result<(), Box<dyn std::error::Error>> {
    let stored = json!({ "root": {
        "type":"root", "version":1, "format":"", "indent":0, "direction":null,
        "$":{"id":"root"}, "children":[
            {"type":"paragraph","version":1,"format":"","indent":0,"direction":null,
             "textFormat":0,"textStyle":"","$":{"id":"Ts1gplV5"},"children":[]}
        ]
    }});
    let snapshot = lexical_loro::snapshot::raw_state_to_loro_snapshot(&stored, None)?;
    for access in [Access::Read, Access::CommentOnly] {
        let doc = lexical_loro::new_doc(50)?;
        doc.import(&snapshot)?;
        let before = doc.oplog_vv();
        let mut config = application_editor_config(
            EditorConfig::default(),
            Arc::new(AtomicI64::new(0)),
            EditorType::MarkdownSync,
        );
        config.policy = &macro_document_model::sync::MACRO_SEARCH_TEXT_SYNC_POLICY;
        let now = Now {
            mono: Millis(0),
            wall: UnixMillis(0),
        };
        let mut surface =
            <EditorSurface as Surface>::construct(SurfaceConfig::Editor(config), 50, now)?;
        let mut effects = Vec::new();
        Surface::init(&mut surface, &doc, now, access, &mut effects)?;
        assert_eq!(
            doc.oplog_vv(),
            before,
            "{access:?} open wrote Loro operations"
        );
    }
    Ok(())
}

/// Source commits load-time normalisation as two local updates after the initial content:
/// paragraph searchText first (105 B), then root documentMetadata (126 B). Each local
/// commit is captured separately; peer and container ids are excluded.
#[test]
fn load_normalisation_is_two_local_commits_in_source_order()
-> Result<(), Box<dyn std::error::Error>> {
    use std::sync::Mutex;
    let stored = json!({ "root": {
        "type":"root", "version":1, "format":"", "indent":0, "direction":null,
        "$":{"id":"root"}, "children":[
            {"type":"paragraph","version":1,"format":"","indent":0,"direction":null,
             "textFormat":0,"textStyle":"","$":{"id":"Ts1gplV5"},"children":[]}
        ]
    }});
    let snapshot = lexical_loro::snapshot::raw_state_to_loro_snapshot(&stored, None)?;
    let doc = lexical_loro::new_doc(50)?;
    doc.import(&snapshot)?;
    let commits = Arc::new(Mutex::new(Vec::<Vec<u8>>::new()));
    let captured = commits.clone();
    let _subscription = doc.subscribe_local_update(Box::new(move |bytes| {
        if let Ok(mut commits) = captured.lock() {
            commits.push(bytes.clone());
        }
        true
    }));
    let mut config = application_editor_config(
        EditorConfig::default(),
        Arc::new(AtomicI64::new(0)),
        EditorType::MarkdownSync,
    );
    config.policy = &macro_document_model::sync::MACRO_SEARCH_TEXT_SYNC_POLICY;
    let now = Now {
        mono: Millis(0),
        wall: UnixMillis(0),
    };
    let mut surface =
        <EditorSurface as Surface>::construct(SurfaceConfig::Editor(config), 50, now)?;
    let mut effects = Vec::new();
    Surface::init(&mut surface, &doc, now, Access::Edit, &mut effects)?;
    // write-path-3 (decode 5f5e1b4e): the load group is a Source undo item.
    assert!(surface.history().can_undo, "load group is undoable");
    assert!(!surface.history().can_redo);
    let replay = lexical_loro::new_doc(81)?;
    replay.import(&snapshot)?;
    let mut per_commit = Vec::new();
    for commit in commits.lock().map_err(|_| "commit capture lock")?.iter() {
        let before = replay.oplog_vv();
        replay.import(commit)?;
        per_commit.push(op_shapes(&serde_json::to_value(
            replay.export_json_updates(&before, &replay.oplog_vv())?,
        )?));
    }
    assert_eq!(
        per_commit,
        [
            vec![(
                "Map".to_owned(),
                "insert".to_owned(),
                "searchText".to_owned()
            )],
            vec![
                (
                    "Map".to_owned(),
                    "insert".to_owned(),
                    "documentMetadata".to_owned()
                ),
                ("Map".to_owned(), "insert".to_owned(), "version".to_owned()),
            ],
        ],
        "load-time normalisation local commits"
    );
    Ok(())
}

/// Open `snapshot` as a browser peer with its own peer id, as each Source tab does.
fn open_peer(
    snapshot: &[u8],
    peer: u64,
) -> Result<(EditorSurface, loro::LoroDoc), Box<dyn std::error::Error>> {
    let doc = lexical_loro::new_doc(peer)?;
    doc.import(snapshot)?;
    let mut config = application_editor_config(
        EditorConfig {
            mode: lexical_model::EditorMode::ViewAttached,
            ..EditorConfig::default()
        },
        Arc::new(AtomicI64::new(0)),
        EditorType::MarkdownSync,
    );
    config.policy = &macro_document_model::sync::MACRO_SEARCH_TEXT_SYNC_POLICY;
    let now = Now {
        mono: Millis(0),
        wall: UnixMillis(0),
    };
    let mut surface =
        <EditorSurface as Surface>::construct(SurfaceConfig::Editor(config), peer, now)?;
    Surface::init(&mut surface, &doc, now, Access::Edit, &mut Vec::new())?;
    Ok((surface, doc))
}

/// Every inline-search node's `$` in document order, recursively.
fn chip_states(root: &serde_json::Value) -> Vec<serde_json::Value> {
    fn walk(node: &serde_json::Value, into: &mut Vec<serde_json::Value>) {
        if node["type"] == "inline-search" {
            into.push(node["$"].clone());
        }
        for child in node["children"].as_array().into_iter().flatten() {
            walk(child, into);
        }
    }
    let mut into = Vec::new();
    walk(root, &mut into);
    into
}

fn live_root(surface: &EditorSurface) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    Ok(serde_json::to_value(surface.state().to_json()?)?["root"].clone())
}

/// Insert an inline-search chip ('/') at the end of the first paragraph as the browser
/// does: a selection change commits the caret, then the host sends group-a.search-trigger.
/// The trigger's eligibility reads the COMMITTED selection (macro_document_model
/// plugins_group_a/menu/search.rs eligible :163 via handle :272-277), which is why
/// menu/search/test.rs sets the selection in an earlier update before triggering.
fn insert_chip(
    surface: &mut EditorSurface,
    doc: &loro::LoroDoc,
    ms: u32,
) -> Result<(), Box<dyn std::error::Error>> {
    use lexical_model::*;
    let paragraph = surface
        .state()
        .view()
        .first_child(NodeKey::ROOT)
        .expect("paragraph");
    let point = Point::element(
        paragraph,
        ChildIndex(u32::try_from(
            surface.state().view().children(paragraph).count(),
        )?),
    );
    local_input(
        surface,
        doc,
        Input::SelectionFromView {
            selection: ViewSelection::Range {
                anchor: point,
                focus: point,
                resolution_dirty: false,
            },
            change: None,
        },
        ms,
    )?;
    let command = macro_document_model::surface::decode_command(
        "group-a.search-trigger",
        r#"{"kind":"actions"}"#,
        surface.state().max_key().generation(),
        None,
    )?
    .ok_or("search trigger")?;
    local_input(
        surface,
        doc,
        Input::Command {
            command,
            selection: ViewSelection::KeepModel,
        },
        ms + 1,
    )?;
    let chips = chip_states(&live_root(surface)?);
    assert_eq!(
        chips.len(),
        1,
        "setup: the trigger inserted one chip: {chips:?}"
    );
    Ok(())
}

/// One unrelated keystroke at the start of the first paragraph.
fn type_at_start(
    surface: &mut EditorSurface,
    doc: &loro::LoroDoc,
    text: &str,
    ms: u32,
) -> Result<(), Box<dyn std::error::Error>> {
    use lexical_model::*;
    let paragraph = surface
        .state()
        .view()
        .first_child(NodeKey::ROOT)
        .expect("paragraph");
    let point = Point::element(paragraph, ChildIndex(0));
    local_input(
        surface,
        doc,
        Input::Command {
            command: Command::InsertText(text.into()),
            selection: ViewSelection::Range {
                anchor: point,
                focus: point,
                resolution_dirty: false,
            },
        },
        ms,
    )?;
    Ok(())
}

fn empty_document() -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let stored = json!({ "root": {
        "type":"root", "version":1, "format":"", "indent":0, "direction":null,
        "$":{"id":"root","documentMetadata":{"version":11}}, "children":[
            {"type":"paragraph","version":1,"format":"","indent":0,"direction":null,
             "textFormat":0,"textStyle":"","$":{"id":"Ts1gplV5"},"children":[]}
        ]
    }});
    Ok(lexical_loro::snapshot::raw_state_to_loro_snapshot(
        &stored, None,
    )?)
}

/// Source control peerLocalState f8449ed5 (row 0622ab39): a peer-class node's `$.local` is
/// set in a LOCAL_STATUS update Source does not sync, so the chip's creating sync stores its
/// peerId without local, and the next ordinary sync stores local: true.
#[test]
fn a_chip_stores_its_local_bit_at_the_next_ordinary_sync_like_source()
-> Result<(), Box<dyn std::error::Error>> {
    let (mut a, a_doc) = open_peer(&empty_document()?, 50)?;
    insert_chip(&mut a, &a_doc, 2000)?;
    let live = chip_states(&live_root(&a)?);
    assert_eq!(live[0]["local"], json!(true));
    let stored = chip_states(&stored_root(&a_doc));
    assert_eq!(stored[0]["peerId"], json!("50"));
    assert!(
        stored[0].get("local").is_none(),
        "creating sync: {}",
        stored[0]
    );
    type_at_start(&mut a, &a_doc, "x", 3000)?;
    let stored = chip_states(&stored_root(&a_doc));
    assert_eq!(
        stored[0]["local"],
        json!(true),
        "next ordinary sync: {}",
        stored[0]
    );
    Ok(())
}

/// Two-peer control peerLocalTwoPeer 044a12cc (row 749db337): Source's receiver keeps the
/// writer's local:true on a remote-created chip and writes it back. RULED NAMED DIFFERENCE
/// C-PEER-LOCAL-REMOTE-CREATE-01 (t1yg (b)): native derives the receiver's own bit on remote
/// create (peerId == me), so B's model and stored local are false.
#[test]
fn a_receiver_stores_its_own_derived_local_bit_for_a_remote_chip()
-> Result<(), Box<dyn std::error::Error>> {
    let (mut a, a_doc) = open_peer(&empty_document()?, 50)?;
    // A word boundary, so the Actions trigger is eligible after it (search.rs trigger_boundaries).
    type_at_start(&mut a, &a_doc, "a ", 1000)?;
    let (mut b, b_doc) = open_peer(&a_doc.export(loro::ExportMode::Snapshot)?, 60)?;
    insert_chip(&mut a, &a_doc, 2000)?;
    type_at_start(&mut a, &a_doc, "b", 3000)?;
    assert_eq!(chip_states(&stored_root(&a_doc))[0]["local"], json!(true));
    let before = b_doc.oplog_vv();
    b_doc.import(&a_doc.export(loro::ExportMode::updates(&before))?)?;
    Surface::remote(
        &mut b,
        &b_doc,
        Now {
            mono: Millis(4000),
            wall: UnixMillis(4000),
        },
        Access::Edit,
        &mut Vec::new(),
    )?;
    let live = chip_states(&live_root(&b)?);
    assert_eq!(live.len(), 1, "setup: B imported the chip: {live:?}");
    assert_eq!(live[0]["peerId"], json!("50"));
    assert_eq!(
        live[0]["local"],
        json!(false),
        "B's derived bit (Source keeps true)"
    );
    type_at_start(&mut b, &b_doc, "c", 5000)?;
    assert_eq!(
        chip_states(&stored_root(&b_doc))[0]["local"],
        json!(false),
        "B's next ordinary sync stores its own bit (Source stores A's true)"
    );
    Ok(())
}

/// Reads and comparisons mask `local`: a remote update of an existing chip carrying a
/// stored local the receiver's model disagrees with neither trips the strict checks nor
/// replaces the receiver's derived bit.
#[test]
fn a_stored_local_bit_is_never_imported_on_update_or_compared()
-> Result<(), Box<dyn std::error::Error>> {
    let (mut a, a_doc) = open_peer(&empty_document()?, 50)?;
    insert_chip(&mut a, &a_doc, 2000)?;
    type_at_start(&mut a, &a_doc, "x", 3000)?;
    let (mut b, b_doc) = open_peer(&a_doc.export(loro::ExportMode::Snapshot)?, 60)?;
    let opened = chip_states(&live_root(&b)?);
    assert_eq!(opened.len(), 1, "setup: B opened the chip: {opened:?}");
    assert_eq!(opened[0]["local"], json!(false));
    // A edits the chip's own text; its stored local stays A's true.
    let before = b_doc.oplog_vv();
    type_text(&mut a, &a_doc, "q", 4000)?;
    b_doc.import(&a_doc.export(loro::ExportMode::updates(&before))?)?;
    Surface::remote(
        &mut b,
        &b_doc,
        Now {
            mono: Millis(5000),
            wall: UnixMillis(5000),
        },
        Access::Edit,
        &mut Vec::new(),
    )?;
    assert_eq!(chip_states(&live_root(&b)?)[0]["local"], json!(false));
    Ok(())
}

/// A pending-local node no commit touches is written by the next ordinary local projection
/// at `$.local` ONLY: Await's slot-absent own `text` must not ride along (the bypass write).
/// A peer adds an Await {peerId 7, local true} (native await_ownership_test.rs stored_await()'s
/// node); reader 8 derives false on the import and stores it at its next ordinary keystroke
/// in another block. The pending bit comes from an import, not the open, so this row does not
/// depend on the open-time question.
#[test]
fn a_pending_local_node_writes_only_its_local_state() -> Result<(), Box<dyn std::error::Error>> {
    let (mut b, b_doc) = open_peer(&empty_document()?, 8)?;
    let peer = lexical_loro::new_doc(7)?;
    peer.import(&b_doc.export(loro::ExportMode::Snapshot)?)?;
    let since = peer.oplog_vv();
    let mut state = lexical_loro::reconstruct_state(&peer, &lexical_loro::PlainPolicy)?.root;
    state["children"]
        .as_array_mut()
        .ok_or("root children")?
        .push(json!({
            "type":"paragraph", "version":1, "direction":null, "format":"", "indent":0,
            "textFormat":0, "textStyle":"", "$":{"id":"para0002"}, "children":[{
                "type":"await", "version":1, "awaitId":"owned-await", "inline":true,
                "$":{"id":"node0001", "peerId":"7", "local":true}
            }]
        }));
    lexical_loro::mirror::set_state(&peer, &serde_json::Value::Object(state))?;
    b_doc.import(&peer.export(loro::ExportMode::updates(&since))?)?;
    Surface::remote(
        &mut b,
        &b_doc,
        Now {
            mono: Millis(1000),
            wall: UnixMillis(1000),
        },
        Access::Edit,
        &mut Vec::new(),
    )?;
    let awaited = |doc: &loro::LoroDoc| stored_root(doc)["children"][1]["children"][0].clone();
    let imported = awaited(&b_doc);
    assert_eq!(
        imported["$"]["local"],
        json!(true),
        "setup: stored as the writer's bit"
    );
    type_at_start(&mut b, &b_doc, "x", 2000)?;
    let mut expected = imported.clone();
    expected["$"]["local"] = json!(false);
    assert_eq!(
        awaited(&b_doc),
        expected,
        "only $.local changes on the untouched Await"
    );
    Ok(())
}
