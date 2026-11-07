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
    fn send_binary(&self, _: &Self::Socket, _: &[u8]) -> io::Result<()> {
        Ok(())
    }
    fn send_text(&self, _: &Self::Socket, _: &str) -> io::Result<()> {
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
        panic!("unexpected comment check");
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
        panic!("unexpected peer call: claim_peer")
    }
    async fn map_unowned_peers(
        &self,
        _document: &SessionKey,
        _user: &str,
        _actor: Option<&str>,
        _peers: &[PeerId],
    ) -> Result<(), Self::Error> {
        panic!("unexpected peer call: map_unowned_peers")
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
            store,
            snapshots,
            runtime: Rc::new(Runtime::default()),
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
