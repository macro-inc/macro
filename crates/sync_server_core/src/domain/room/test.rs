use super::*;
use crate::domain::{
    connection::*,
    models::*,
    permissions::{AccessLevel, AuthToken},
    ports::*,
    test_support::*,
    types::*,
};
use futures::executor::block_on;
use macro_sync_service_jwt::session::SessionKind;
use std::{
    cell::{Cell, RefCell},
    io,
    rc::Rc,
};

#[derive(Default)]
struct Runtime {
    events: Events,
    sent: RefCell<Vec<(crate::domain::socket::WebSocketId, Vec<u8>)>>,
    text: RefCell<Vec<String>>,
    fail_map: Cell<bool>,
    fail_socket: RefCell<Option<crate::domain::socket::WebSocketId>>,
    gate_calls: Cell<usize>,
    gate_verdict: RefCell<Option<io::Result<bool>>>,
    sockets: RefCell<Vec<crate::domain::socket::WebSocketId>>,
    publications: RefCell<Vec<DocumentPublication>>,
    next: Cell<u128>,
    closed: RefCell<Vec<String>>,
}
impl Entropy for Runtime {
    fn socket_uuid(&self) -> uuid_types::Uuid {
        let n = self.next.get() + 1;
        self.next.set(n);
        uuid_types::Uuid::from_u128(n)
    }
}
impl Connections for Runtime {
    type Socket = crate::domain::socket::WebSocketId;
    type Error = io::Error;
    fn all(&self) -> Vec<Self::Socket> {
        self.sockets.borrow().clone()
    }
    fn socket_id(
        &self,
        socket: &Self::Socket,
    ) -> Result<Self::Socket, crate::domain::socket::SocketTagError> {
        Ok(socket.clone())
    }
    fn accept(&self, id: &Self::Socket) -> io::Result<Self::Socket> {
        self.sockets.borrow_mut().push(id.clone());
        Ok(id.clone())
    }
    fn send_binary(&self, socket: &Self::Socket, bytes: &[u8]) -> io::Result<()> {
        self.events.borrow_mut().push("send");
        if self.fail_socket.borrow().as_ref() == Some(socket) {
            return Err(io::Error::other("dead peer"));
        }
        self.sent
            .borrow_mut()
            .push((socket.clone(), bytes.to_vec()));
        Ok(())
    }
    fn send_text(&self, _: &Self::Socket, text: &str) -> io::Result<()> {
        self.text.borrow_mut().push(text.into());
        Ok(())
    }
    fn close(&self, socket: &Self::Socket, _: CloseReason) -> io::Result<()> {
        self.closed.borrow_mut().push(socket.as_str().into());
        Ok(())
    }
}
impl AlarmScheduler for Runtime {
    type Error = io::Error;
    async fn scheduled(&self) -> io::Result<Option<UnixMillis>> {
        Ok(None)
    }
    async fn schedule_in(&self, _: Duration) -> io::Result<()> {
        Ok(())
    }
    async fn cancel(&self) -> io::Result<()> {
        Ok(())
    }
}
impl BackgroundEffects for Runtime {
    fn publish(&self, publication: DocumentPublication) {
        self.publications.borrow_mut().push(publication);
    }
    fn record_blame(&self, _: Vec<BlameEvent>) {
        panic!("unexpected blame flush");
    }
    fn extend_isolate_lifetime(&self, _: Duration) {
        panic!("unexpected lifetime extension");
    }
}
impl CommentGate for Runtime {
    type Error = io::Error;
    async fn is_comment_only_change(
        &self,
        _: &crate::domain::state::RootChange,
    ) -> io::Result<bool> {
        self.gate_calls.set(self.gate_calls.get() + 1);
        self.gate_verdict.borrow_mut().take().unwrap_or(Ok(false))
    }
}
impl PeerDirectory for Runtime {
    type Error = std::io::Error;
    async fn claim_peer(
        &self,
        _document: &SessionKey,
        _user: &str,
        _actor: Option<&str>,
        _peer: PeerId,
    ) -> Result<(), Self::Error> {
        self.events.borrow_mut().push("claim");
        Ok(())
    }
    async fn map_unowned_peers(
        &self,
        _document: &SessionKey,
        _user: &str,
        _actor: Option<&str>,
        _peers: &[PeerId],
    ) -> Result<(), Self::Error> {
        self.events.borrow_mut().push("map");
        if self.fail_map.get() {
            return Err(io::Error::other("directory unavailable"));
        }
        Ok(())
    }
    async fn user_for_peer(
        &self,
        _document: &SessionKey,
        _peer: PeerId,
    ) -> Result<Option<String>, Self::Error> {
        panic!("unexpected peer call: user_for_peer")
    }
    async fn peers(&self, _document: &SessionKey) -> Result<Vec<PeerWithUserId>, Self::Error> {
        panic!("unexpected peer call: peers")
    }
    async fn blame_for_node(
        &self,
        _document: &SessionKey,
        _node: &str,
    ) -> Result<Option<BlameRow>, Self::Error> {
        panic!("unexpected peer call: blame_for_node")
    }
    async fn delete_document(&self, _document: &SessionKey) -> Result<(), Self::Error> {
        panic!("unexpected peer call: delete_document")
    }
}

struct FakePorts {
    store: Rc<Store>,
    snapshots: Rc<Snapshots>,
    runtime: Rc<Runtime>,
    clock: TestClock,
}
impl RoomPorts for FakePorts {
    type Clock = TestClock;
    type Entropy = Runtime;
    type Connections = Runtime;
    type Storage = Store;
    type Snapshots = Snapshots;
    type Alarm = Runtime;
    type Peers = Runtime;
    type CommentGate = Runtime;
    type Background = Runtime;
    fn clock(&self) -> &TestClock {
        &self.clock
    }
    fn entropy(&self) -> &Runtime {
        &self.runtime
    }
    fn connections(&self) -> &Runtime {
        &self.runtime
    }
    fn storage(&self) -> &Store {
        &self.store
    }
    fn snapshots(&self) -> &Snapshots {
        &self.snapshots
    }
    fn alarm(&self) -> &Runtime {
        &self.runtime
    }
    fn peers(&self) -> &Runtime {
        &self.runtime
    }
    fn comment_gate(&self) -> &Runtime {
        &self.runtime
    }
    fn background(&self) -> &Runtime {
        &self.runtime
    }
}
fn config() -> RoomConfig {
    RoomConfig {
        awareness_timeout: WallDuration(5000),
        alarm_delay: Duration::from_secs(5),
        isolate_keepalive: Duration::from_secs(60),
        create_default_state: true,
        oversized_message_warning: 1_000_000,
    }
}
fn room() -> Room<FakePorts> {
    let store = Rc::new(Store::default());
    let snapshots = Rc::new(Snapshots {
        events: store.events.clone(),
        bytes: RefCell::new(None),
    });
    Room::new(
        FakePorts {
            clock: TestClock(store.events.clone()),
            runtime: Rc::new(Runtime {
                events: store.events.clone(),
                ..Runtime::default()
            }),
            store,
            snapshots,
        },
        config(),
    )
}
fn grant(key: &str, kind: SessionKind) -> AuthToken {
    AuthToken::new(
        key.into(),
        AccessLevel::Edit,
        kind,
        Some("user".into()),
        None,
        None,
        Some(0),
    )
}
#[test]
fn first_join_only_on_zero_to_one() {
    block_on(async {
        let mut room = room();
        room.connect(
            grant("document", SessionKind::Document),
            SessionKey::new("document".into()),
        )
        .await
        .unwrap();
        room.connect(
            grant("document", SessionKind::Document),
            SessionKey::new("document".into()),
        )
        .await
        .unwrap();
        let publications = room.ports.runtime.publications.borrow();
        assert_eq!(publications.len(), 1);
        assert!(matches!(
            publications[0],
            DocumentPublication::Interaction {
                reason: InteractionReason::FirstJoin,
                ..
            }
        ));
    });
}
#[test]
fn last_leave_while_closing_socket_is_listed() {
    block_on(async {
        let mut room = room();
        let ConnectOutcome::Accepted { socket } = room
            .connect(
                grant("document", SessionKind::Document),
                SessionKey::new("document".into()),
            )
            .await
            .unwrap()
        else {
            panic!("not accepted")
        };
        room.on_close(&socket).await.unwrap();
        assert_eq!(room.ports.runtime.sockets.borrow().len(), 1);
        let publications = room.ports.runtime.publications.borrow();
        assert!(matches!(
            publications[1],
            DocumentPublication::Snapshot {
                interaction: Some(InteractionReason::LastLeave),
                ..
            }
        ));
    });
}
#[test]
fn metadata_restored_after_new_object() {
    block_on(async {
        let mut room = room();
        let ConnectOutcome::Accepted { socket } = room
            .connect(
                grant("document", SessionKind::Document),
                SessionKey::new("document".into()),
            )
            .await
            .unwrap()
        else {
            panic!("not accepted")
        };
        room.ports
            .store
            .metadata
            .borrow_mut()
            .get_mut(&socket)
            .unwrap()
            .peer_ids
            .insert(42);
        let mut cold = Room::new(room.ports, config());
        assert!(cold.memory.connections.is_empty());
        assert_eq!(cold.connection_peers(&socket, true).await.unwrap(), [42]);
        assert_eq!(cold.session_key().await.unwrap().as_str(), "document");
    });
}
#[test]
fn forbidden_surface_socket_stays_accepted() {
    block_on(async {
        let mut room = room();
        room.ports
            .store
            .lifecycle
            .set(Some(SurfaceLifecycle::Ready));
        assert!(matches!(
            room.connect(
                grant("surface:id", SessionKind::Surface),
                SessionKey::new("surface:id".into())
            )
            .await
            .unwrap(),
            ConnectOutcome::Forbidden
        ));
        assert_eq!(room.ports.runtime.sockets.borrow().len(), 1);
        assert_eq!(room.ports.runtime.closed.borrow().len(), 1);
        assert_eq!(room.ports.store.metadata.borrow().len(), 1);
    });
}

fn binary(message: sync_protocol::FromPeer<'_>) -> InboundFrame {
    use bebop::Record;
    let mut bytes = vec![1];
    message.serialize(&mut bytes).unwrap();
    InboundFrame::Binary(bytes)
}
async fn connect_access(
    room: &mut Room<FakePorts>,
    access: AccessLevel,
) -> crate::domain::socket::WebSocketId {
    let mut claims = grant("document", SessionKind::Document);
    claims.access_level = access;
    let ConnectOutcome::Accepted { socket } = room
        .connect(claims, SessionKey::new("document".into()))
        .await
        .unwrap()
    else {
        panic!("connection rejected")
    };
    room.ports.runtime.sent.borrow_mut().clear();
    room.ports.store.events.borrow_mut().clear();
    socket
}
fn update(peer: u64) -> Vec<u8> {
    let writer = loro::LoroDoc::new();
    writer.set_peer_id(peer).unwrap();
    writer.get_text("content").push_str("edit").unwrap();
    writer.export(loro::ExportMode::all_updates()).unwrap()
}
#[test]
fn ack_follows_pending_put_archive_and_directory_map_and_stops_on_failures() {
    block_on(async {
        use bebop::{Record, SliceWrapper};
        use sync_protocol::{FromPeer, FromRemote};
        for failure in ["none", "archive", "directory"] {
            let mut room = room();
            let socket = connect_access(&mut room, AccessLevel::Edit).await;
            room.ports.store.fail_archive.set(failure == "archive");
            room.ports.runtime.fail_map.set(failure == "directory");
            let update = update(7);
            let result = room
                .on_frame(
                    &socket,
                    binary(FromPeer::PeerUpdate {
                        updates: vec![SliceWrapper::Raw(&update)],
                        id: "operation",
                    }),
                )
                .await;
            if failure == "none" {
                result.unwrap();
                assert_eq!(
                    *room.ports.store.events.borrow(),
                    ["nanos", "monotonic", "pending", "archive", "map", "send"]
                );
                let sent = room.ports.runtime.sent.borrow();
                assert!(matches!(
                    FromRemote::deserialize(&sent[0].1[1..]).unwrap(),
                    FromRemote::RemoteUpdateAck { id: "operation" }
                ));
            } else {
                assert!(result.is_err());
                assert!(room.ports.runtime.sent.borrow().is_empty());
            }
        }
    });
}
#[test]
fn viewer_receives_no_ack_and_does_not_persist_updates() {
    block_on(async {
        use bebop::SliceWrapper;
        let mut room = room();
        let socket = connect_access(&mut room, AccessLevel::View).await;
        let update = update(7);
        room.on_frame(
            &socket,
            binary(sync_protocol::FromPeer::PeerUpdate {
                updates: vec![SliceWrapper::Raw(&update)],
                id: "view",
            }),
        )
        .await
        .unwrap();
        assert!(room.ports.runtime.sent.borrow().is_empty());
        assert!(room.ports.store.pending.borrow().is_empty());
    });
}
#[test]
fn commenter_and_editor_comment_frames_fail_closed_on_gate_error_or_missing_root() {
    block_on(async {
        use bebop::SliceWrapper;
        use sync_protocol::FromPeer;
        for access in [AccessLevel::Comment, AccessLevel::Edit] {
            for has_root in [false, true] {
                let mut room = room();
                let writer = loro::LoroDoc::new();
                writer.set_peer_id(17).unwrap();
                if has_root {
                    writer.get_map("root").insert("type", "root").unwrap();
                    writer.commit();
                    *room.ports.snapshots.bytes.borrow_mut() =
                        Some(writer.export(loro::ExportMode::Snapshot).unwrap());
                }
                let seen = writer.oplog_vv();
                let socket = connect_access(&mut room, access.clone()).await;
                writer.get_map("root").insert("indent", 1).unwrap();
                let update = writer.export(loro::ExportMode::updates(&seen)).unwrap();
                *room.ports.runtime.gate_verdict.borrow_mut() =
                    Some(Err(io::Error::other("gate unavailable")));
                let updates = vec![SliceWrapper::Raw(&update)];
                let message = if access == AccessLevel::Edit {
                    FromPeer::PeerCommentUpdate {
                        updates,
                        id: "comment",
                    }
                } else {
                    FromPeer::PeerUpdate {
                        updates,
                        id: "comment",
                    }
                };
                room.on_frame(&socket, binary(message)).await.unwrap();
                assert_eq!(room.ports.runtime.gate_calls.get(), usize::from(has_root));
                assert!(room.ports.runtime.sent.borrow().is_empty());
                assert!(room.ports.store.pending.borrow().is_empty());
            }
        }
    });
}
#[test]
fn request_since_echoes_original_vector_bytes() {
    block_on(async {
        use bebop::{Record, SliceWrapper};
        use sync_protocol::{FromPeer, FromRemote};
        let mut room = room();
        let socket = connect_access(&mut room, AccessLevel::View).await;
        let mut vv = loro::VersionVector::default();
        vv.set_end(loro::ID::new(91, 2));
        vv.set_end(loro::ID::new(12, 3));
        let encoded = vv.encode();
        room.on_frame(
            &socket,
            binary(FromPeer::PeerRequestSince {
                vv: SliceWrapper::Raw(&encoded),
            }),
        )
        .await
        .unwrap();
        let sent = room.ports.runtime.sent.borrow();
        let FromRemote::RemoteUpdateSince { vv, .. } =
            FromRemote::deserialize(&sent[0].1[1..]).unwrap()
        else {
            panic!("wrong response")
        };
        assert_eq!(*vv, encoded);
    });
}
#[test]
fn broadcast_skips_sender_and_survives_a_failing_peer() {
    block_on(async {
        use bebop::{Record, SliceWrapper};
        use sync_protocol::{FromPeer, FromRemote};
        let mut room = room();
        let sender = connect_access(&mut room, AccessLevel::Edit).await;
        let failed = connect_access(&mut room, AccessLevel::View).await;
        let receiver = connect_access(&mut room, AccessLevel::View).await;
        *room.ports.runtime.fail_socket.borrow_mut() = Some(failed);
        let update = update(3);
        room.on_frame(
            &sender,
            binary(FromPeer::PeerUpdate {
                updates: vec![SliceWrapper::Raw(&update)],
                id: "broadcast",
            }),
        )
        .await
        .unwrap();
        let sent = room.ports.runtime.sent.borrow();
        assert_eq!(sent.len(), 2);
        assert_eq!(sent[0].0, sender);
        assert_eq!(sent[1].0, receiver);
        assert!(
            matches!(FromRemote::deserialize(&sent[1].1[1..]).unwrap(), FromRemote::RemoteUpdate { update: bytes } if *bytes == update)
        );
    });
}
#[test]
fn ping_needs_identity_but_never_loads_document_state() {
    block_on(async {
        let mut room = room();
        let socket = crate::domain::socket::WebSocketId::new(uuid_types::Uuid::from_u128(1));
        assert!(matches!(
            room.on_frame(&socket, InboundFrame::Text("ping".into()))
                .await,
            Err(RoomError::NoSession)
        ));
        room.ports
            .store
            .identity
            .replace(Some(SessionKey::new("document".into())));
        room.on_frame(&socket, InboundFrame::Text("ping".into()))
            .await
            .unwrap();
        assert_eq!(*room.ports.runtime.text.borrow(), ["pong"]);
        assert!(room.memory.document.is_none());
    });
}
