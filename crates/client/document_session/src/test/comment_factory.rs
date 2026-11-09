use super::*;
use bebop::{Record, SliceWrapper};
use macro_document_model::nodes::CommentNode;

#[test]
fn application_comment_factory_stages_in_its_registry_and_imports_only_after_ack() {
    let (_, snapshot) = editor_seed();
    let mut session = DocumentSession::<EditorSurface>::new(
        SessionConfig {
            sync: sync_config(Access::CommentOnly, TransportKind::Direct),
            peer_ids: vec![50, 51, 52, 53, 54],
            peer_range: PeerRange::User,
            surface: SurfaceConfig::Editor(EditorConfig {
                builder: std::sync::Arc::new(|mode, peer| {
                    default_editor_builder(mode, peer).node::<CommentNode>()
                }),
                comment_node: |tx, ids| {
                    Ok(macro_document_model::nodes::create_comment_node(
                        tx,
                        ids,
                        Default::default(),
                        Some(false),
                    )?
                    .key())
                },
                ..EditorConfig::default()
            }),
        },
        time(0),
    )
    .unwrap();
    session.handle(time(0), SessionInput::Sync(SyncInput::Start));
    session.handle(
        time(0),
        SessionInput::Sync(SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot,
        }),
    );
    connect(&mut session);
    let request = comment_request(&mut session, 171, "a😀b");
    let original = session.surface().state().to_json().unwrap();
    session.handle(time(5), SessionInput::Comment(request.clone()));
    let comments = server_current(&mut session, 6);
    assert_eq!(comments.len(), 1);
    assert_eq!(session.surface().state().to_json().unwrap(), original);
    let (id, _) = &comments[0];
    wire(
        &mut session,
        sync_protocol::FromRemote::RemoteUpdateAck { id },
        7,
    );
    let state = session.surface().state().to_json().unwrap();
    assert_eq!(
        state.root["children"][0]["children"][0]["type"],
        json!("comment-mark")
    );
    assert_eq!(
        state.root["children"][0]["children"][0]["isDraft"],
        json!(false)
    );
    assert!(
        session
            .surface()
            .state()
            .view()
            .descendants(NodeKey::ROOT)
            .any(|(key, _)| session.surface().state().view().is::<CommentNode>(key))
    );
    session.handle(
        time(8),
        SessionInput::Comment(CommentMarkRequest {
            request: RequestId(172),
            ..request
        }),
    );
    let vv = session.version().encode();
    let mut bytes = vec![];
    sync_protocol::FromRemote::RemoteUpdateSince {
        vv: SliceWrapper::from_cooked(&vv),
        update: SliceWrapper::from_cooked(&[]),
    }
    .serialize(&mut bytes)
    .unwrap();
    let mut frames = sync_protocol::framing::into_frames(&bytes, 900_000);
    assert_eq!(frames.len(), 1);
    let out = session.handle(
        time(9),
        SessionInput::Sync(SyncInput::Socket {
            conn: ConnId(1),
            event: SocketEvent::Frame(frames.remove(0)),
        }),
    );
    assert!(out.view.iter().any(|view| matches!(
        view,
        ViewEffect::Reply {
            request: RequestId(172),
            reply: Reply::Comment(CommentReply::Accepted)
        }
    )));
    assert!(!out.io.iter().any(|io| matches!(
        io,
        IoEffect::SocketSend { .. }
            | IoEffect::Storage {
                op: StorageOp::WalAppend { .. },
                ..
            }
    )));
    assert!(!session.surface().history().can_undo);
    #[cfg(feature = "conformance")]
    assert!(session.conformance_sync().wal().entries.is_empty());
}

#[test]
fn a_failed_application_comment_constructor_keeps_live_history_and_never_publishes() {
    let (_, snapshot) = editor_seed();
    let mut session = DocumentSession::<EditorSurface>::new(
        SessionConfig {
            sync: sync_config(Access::CommentOnly, TransportKind::Direct),
            peer_ids: vec![50, 51, 52, 53, 54],
            peer_range: PeerRange::User,
            surface: SurfaceConfig::Editor(EditorConfig {
                comment_node: |_, _| Err(Error::Invariant("fixture annotation refusal")),
                ..EditorConfig::default()
            }),
        },
        time(0),
    )
    .unwrap();
    session.handle(time(0), SessionInput::Sync(SyncInput::Start));
    session.handle(
        time(0),
        SessionInput::Sync(SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot,
        }),
    );
    connect(&mut session);
    let request = comment_request(&mut session, 173, "a😀b");
    let vv_before = session.version();
    let state = session.surface().state().to_json().unwrap();
    session.handle(time(5), SessionInput::Comment(request));
    let vv = session.version().encode();
    let mut bytes = vec![];
    sync_protocol::FromRemote::RemoteUpdateSince {
        vv: SliceWrapper::from_cooked(&vv),
        update: SliceWrapper::from_cooked(&[]),
    }
    .serialize(&mut bytes)
    .unwrap();
    let mut frames = sync_protocol::framing::into_frames(&bytes, 900_000);
    assert_eq!(frames.len(), 1);
    let out = session.handle(
        time(6),
        SessionInput::Sync(SyncInput::Socket {
            conn: ConnId(1),
            event: SocketEvent::Frame(frames.remove(0)),
        }),
    );
    let frames = out
        .io
        .iter()
        .filter_map(|io| match io {
            IoEffect::SocketSend { frame, .. } => Some(frame),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(frames.len(), 1);
    assert_eq!(frames[0][0], 1);
    assert!(matches!(
        sync_protocol::FromPeer::deserialize(&frames[0][1..]).unwrap(),
        sync_protocol::FromPeer::PeerRegisterId { peerid: 51 }
    ));
    assert!(!out.io.iter().any(|io| matches!(
        io,
        IoEffect::Storage {
            op: StorageOp::WalAppend { .. },
            ..
        }
    )));
    assert!(out.view.iter().any(|view| matches!(
        view,
        ViewEffect::Reply {
            request: RequestId(173),
            reply: Reply::Comment(CommentReply::Refused(CommentRefusal::StagingFailed))
        }
    )));
    assert_eq!(session.version(), vv_before);
    assert_eq!(session.surface().state().to_json().unwrap(), state);
    #[cfg(feature = "conformance")]
    assert!(session.conformance_sync().wal().entries.is_empty());
}
