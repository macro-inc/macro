use super::*;

#[derive(Default)]
struct PresenceState {
    values: BTreeMap<String, loro::LoroValue>,
    writes: Vec<(String, UnixMillis)>,
    applied: Vec<Vec<u8>>,
    all: usize,
}
struct Presence(Rc<RefCell<PresenceState>>);
impl PresenceBackend for Presence {
    fn set(
        &mut self,
        key: &str,
        value: loro::LoroValue,
        at: UnixMillis,
    ) -> Result<(), PresenceError> {
        let mut s = self.0.borrow_mut();
        s.values.insert(key.into(), value);
        s.writes.push((key.into(), at));
        Ok(())
    }
    fn apply(&mut self, bytes: &[u8], _: UnixMillis) -> Result<(), PresenceError> {
        self.0.borrow_mut().applied.push(bytes.into());
        Ok(())
    }
    fn encode(&self, key: &str, _: UnixMillis) -> Result<Vec<u8>, PresenceError> {
        Ok(key.as_bytes().to_vec())
    }
    fn encode_all(&self, _: UnixMillis) -> Result<Vec<u8>, PresenceError> {
        self.0.borrow_mut().all += 1;
        Ok(vec![1])
    }
    fn remove_outdated(&mut self, at: UnixMillis) -> bool {
        let mut s = self.0.borrow_mut();
        if s.writes.last().is_some_and(|(_, t)| at.0 - t.0 > 10000) {
            s.values.clear();
            true
        } else {
            false
        }
    }
    fn peers(&self, key: &str) -> Vec<PeerPresence> {
        self.0
            .borrow()
            .values
            .iter()
            .filter(|(k, v)| k.as_str() != key && **v != loro::LoroValue::Null)
            .map(|(k, v)| PeerPresence {
                key: k.clone(),
                value: v.clone(),
            })
            .collect()
    }
    fn next_expiry(&self) -> Option<UnixMillis> {
        None
    }
}
fn install(h: &mut Harness) -> Rc<RefCell<PresenceState>> {
    let state = Rc::new(RefCell::new(PresenceState::default()));
    h.core
        .set_presence_backend(Box::new(Presence(state.clone())));
    state
}
#[test]
fn s7_004_chatter_imports_updates_and_awareness() {
    let mut h = Harness::running(TransportKind::None, Persistence::Durable);
    h.core.config.chatter = true;
    let state = install(&mut h);
    h.send(SyncInput::Chatter(ChatterMessage::Awareness(vec![4])));
    assert_eq!(state.borrow().applied, vec![vec![4]]);
    h.send(SyncInput::Chatter(ChatterMessage::Update(
        row(1).record.bytes,
    )));
    assert_eq!(
        h.doc.calls.borrow().imports.last(),
        Some(&ImportOrigin::Chatter)
    );
}
#[test]
fn s7_010_presence_changes_coalesce_for_25ms() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    let state = install(&mut h);
    h.core.presence_dirty = false;
    h.core.presence_due = None;
    h.send(SyncInput::SetPresence(Some(1.into())));
    h.at(10, SyncInput::SetPresence(Some(2.into())));
    assert!(state.borrow().writes.is_empty());
    h.at(25, SyncInput::Tick);
    assert_eq!(state.borrow().writes.len(), 1);
}
#[test]
fn s7_056_presence_sends_only_when_open() {
    let mut h = Harness::running(TransportKind::None, Persistence::Memory);
    install(&mut h);
    h.send(SyncInput::SetPresence(Some(1.into())));
    h.at(25, SyncInput::Tick);
    assert!(
        !h.out
            .io
            .iter()
            .any(|e| matches!(e, IoEffect::SocketSend { .. }))
    );
}
#[test]
fn s7_090_presence_expiry_uses_supplied_wall_time() {
    let mut h = Harness::running(TransportKind::None, Persistence::Memory);
    h.core.config.presence.refresh = None;
    let state = install(&mut h);
    h.send(SyncInput::SetPresence(Some(1.into())));
    h.at(25, SyncInput::Tick);
    assert!(!state.borrow().values.is_empty());
    h.at(11000, SyncInput::Tick);
    assert!(state.borrow().values.is_empty());
}
#[test]
fn s7_091_presence_contains_user_and_selection() {
    let mut h = Harness::running(TransportKind::None, Persistence::Memory);
    let state = install(&mut h);
    h.send(SyncInput::SetPresence(Some(42.into())));
    h.at(25, SyncInput::Tick);
    let state = state.borrow();
    let loro::LoroValue::Map(value) = state.values.get("1").unwrap() else {
        panic!()
    };
    assert_eq!(value.get("selection"), Some(&42.into()));
    let loro::LoroValue::Map(user) = value.get("user").unwrap() else {
        panic!()
    };
    assert_eq!(user.get("peerId"), Some(&"1".into()));
    assert_eq!(user.get("userId"), Some(&loro::LoroValue::Null));
}
#[test]
fn s7_092_remote_presence_excludes_self_and_cleared_values() {
    let mut h = Harness::running(TransportKind::None, Persistence::Memory);
    let state = install(&mut h);
    state.borrow_mut().values = BTreeMap::from([
        ("1".into(), 1.into()),
        ("2".into(), 2.into()),
        ("3".into(), loro::LoroValue::Null),
    ]);
    h.core.apply_presence(&[1], now(0), &mut h.out);
    let Some(SyncEvent::Presence(peers)) = h.out.events.last() else {
        panic!()
    };
    assert_eq!(peers.len(), 1);
    assert_eq!(peers[0].key, "2");
}
#[test]
fn s7_093_palette_color_comes_from_configuration() {
    let mut h = Harness::running(TransportKind::None, Persistence::Memory);
    h.core.config.presence.user.color = PaletteColor::Pink;
    let state = install(&mut h);
    h.send(SyncInput::SetPresence(Some(1.into())));
    h.at(25, SyncInput::Tick);
    let s = state.borrow();
    let loro::LoroValue::Map(v) = s.values.get("1").unwrap() else {
        panic!()
    };
    let loro::LoroValue::Map(u) = v.get("user").unwrap() else {
        panic!()
    };
    assert_eq!(u.get("color"), Some(&"pink".into()));
}
#[test]
fn s7_104_presence_refreshes_after_three_seconds() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    let state = install(&mut h);
    h.send(SyncInput::SetPresence(Some(1.into())));
    h.at(25, SyncInput::Tick);
    let n = state.borrow().writes.len();
    h.at(3025, SyncInput::Tick);
    assert_eq!(state.borrow().writes.len(), n + 1);
}
#[test]
fn s7_110_initial_sync_imports_awareness() {
    let mut h = Harness::new(TransportKind::Direct, Persistence::Memory);
    let state = install(&mut h);
    h.start();
    h.send(SyncInput::Socket {
        conn: ConnId(1),
        event: SocketEvent::Opened,
    });
    h.remote(sync_protocol::FromRemote::RemoteInitialSync {
        snapshot: SliceWrapper::from_cooked(&[]),
        awareness: SliceWrapper::from_cooked(&[8]),
    });
    assert_eq!(state.borrow().applied, vec![vec![8]]);
}
#[test]
fn s7_113_ai_range_fixed_presence_key_encodes_all() {
    let mut supply = PeerSupply::new(PeerRange::Ai);
    assert_eq!(supply.extend([1]), Err(SyncError::PeerOutOfRange));
    supply.extend([AI_PEER_BASE]).unwrap();
    let mut h = Harness::running(TransportKind::None, Persistence::Memory);
    h.core.config.presence.key = PresenceKeyMode::Fixed("worker-test".into());
    let state = install(&mut h);
    h.send(SyncInput::SetPresence(Some(1.into())));
    h.at(25, SyncInput::Tick);
    assert!(state.borrow().values.contains_key("worker-test"));
    assert_eq!(state.borrow().all, 1);
}

#[test]
fn default_backend_sends_real_awareness_and_expires_imported_peers() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.core.config.presence.refresh = None;
    h.send(SyncInput::SetPresence(Some(42.into())));
    h.at(25, SyncInput::Tick);
    let wire = h
        .out
        .io
        .iter()
        .find_map(|effect| {
            let IoEffect::SocketSend { frame, .. } = effect else {
                return None;
            };
            match sync_protocol::FromPeer::deserialize(&frame[1..]).unwrap() {
                sync_protocol::FromPeer::PeerAwareness { awareness } => Some(awareness.to_vec()),
                _ => None,
            }
        })
        .unwrap();
    let shared = sync_protocol::presence::EphemeralStore::new(10_000);
    shared.apply(&wire, UnixMillis(25)).unwrap();
    let loro::LoroValue::Map(value) = shared.get("1").unwrap() else {
        panic!()
    };
    assert_eq!(value.get("selection"), Some(&42.into()));
    shared.set("2", 7, UnixMillis(100));
    h.at(100, SyncInput::Tick);
    h.remote(sync_protocol::FromRemote::RemoteAwareness {
        awareness: SliceWrapper::from_cooked(&shared.encode_all(UnixMillis(100))),
    });
    let peers = h
        .out
        .events
        .iter()
        .find_map(|event| match event {
            SyncEvent::Presence(peers) => Some(peers),
            _ => None,
        })
        .unwrap();
    assert_eq!(peers.len(), 1);
    assert_eq!(peers[0].key, "2");
    h.at(10_100, SyncInput::Tick);
    assert!(
        !h.out
            .events
            .iter()
            .any(|event| matches!(event, SyncEvent::Presence(peers) if peers.is_empty()))
    );
    h.at(10_101, SyncInput::Tick);
    assert!(
        h.out
            .events
            .iter()
            .any(|event| matches!(event, SyncEvent::Presence(peers) if peers.is_empty()))
    );
}
