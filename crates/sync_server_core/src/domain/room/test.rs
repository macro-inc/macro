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
    alarms: Cell<usize>,
    kept_alive: RefCell<Vec<Duration>>,
    blame: RefCell<Vec<Vec<BlameEvent>>>,
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
        self.alarms.set(self.alarms.get() + 1);
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
    fn record_blame(&self, events: Vec<BlameEvent>) {
        self.blame.borrow_mut().push(events);
    }
    fn extend_isolate_lifetime(&self, ttl: Duration) {
        self.kept_alive.borrow_mut().push(ttl);
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

mod alarm;
mod connection;
mod frame;
