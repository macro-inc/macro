//! Deterministic native executor oracle; the JS host replays these same external events.
use bebop::{Record, SliceWrapper};
use document_session_wasm::{
    DocSession,
    generated::{self, owned as w},
};
use loro::{ExportMode, LoroDoc, VersionVector};
use serde_json::{Value, json};
use std::collections::VecDeque;
fn bytes<'a, T: Record<'a>>(value: &T) -> Vec<u8> {
    let mut b = vec![];
    value.serialize(&mut b).unwrap();
    b
}
fn input(kind: u8) -> w::SessionInputMsg {
    w::SessionInputMsg {
        kind,
        request: 0,
        code: 0,
        flag: false,
        bytes: vec![],
        peers: vec![],
        editor: w::EditorInputMsg::EditorSetState {
            json: String::new(),
        },
        operations: vec![],
        mark_id: String::new(),
        anchor: vec![],
        focus: vec![],
        expected_text: String::new(),
    }
}
struct Driver {
    session: DocSession,
    at: f64,
    log: Vec<Value>,
    actions: Vec<Value>,
    pending: VecDeque<(u32, u32, u32, Vec<u8>)>,
    server: LoroDoc,
    conn: u32,
}
impl Driver {
    fn capture(&mut self, flags: u32) {
        if flags & 27 == 0 {
            return;
        }
        let b = self.session.take_output();
        let word = |i: usize| u32::from_le_bytes(b[i..i + 4].try_into().unwrap());
        let mut at = (24 + word(12) as usize * 4 + word(16) as usize + 3) & !3;
        for _ in 0..word(20) {
            let tag = word(at);
            let a = word(at + 4);
            let c = word(at + 8);
            let len = word(at + 12) as usize;
            let data = b[at + 16..at + 16 + len].to_vec();
            at = (at + 16 + len + 3) & !3;
            if tag == 16 {
                let view = w::ViewEffectMsg::deserialize(&data).unwrap();
                assert_ne!(view.kind, 2, "{}", view.text);
            } else {
                self.pending.push_back((tag, a, c, data));
            }
        }
    }
    fn record(&mut self, name: &str, args: Value, flags: u32) {
        self.log.push(json!({"name":name,"args":args}));
        self.capture(flags);
    }
    fn packet(&mut self, data: Vec<u8>) {
        let flags = self
            .session
            .input(&data, self.at, 1_000_000.0 + self.at)
            .unwrap();
        self.record(
            "input",
            json!([data, self.at, 1_000_000.0 + self.at]),
            flags,
        );
    }
    fn frame(&mut self, data: Vec<u8>) {
        let flags = self
            .session
            .socket_frame(self.conn, data.clone(), self.at)
            .unwrap();
        self.record("socketFrame", json!([self.conn, data, self.at]), flags);
    }
    fn remote(&mut self, msg: sync_protocol::FromRemote<'_>) {
        for frame in sync_protocol::framing::into_frames(&bytes(&msg), 900000) {
            self.frame(frame);
        }
    }
    fn settle(&mut self) {
        let mut budget = 1000;
        while !self.pending.is_empty() {
            budget -= 1;
            assert!(budget > 0);
            let index = self.pending.iter().position(|e| e.0 == 1).unwrap_or(0);
            let (tag, a, _, data) = self.pending.remove(index).unwrap();
            match tag {
                1 => {
                    let flags = self
                        .session
                        .token_fetched(
                            a,
                            Some("fixture-token".into()),
                            2,
                            self.at,
                            1_000_000.0 + self.at,
                        )
                        .unwrap();
                    self.record(
                        "tokenFetched",
                        json!([a, "fixture-token", 2, self.at, 1_000_000.0 + self.at]),
                        flags,
                    );
                }
                2 => self.conn = a,
                3 => match sync_protocol::FromPeer::deserialize(&data[1..]).unwrap() {
                    sync_protocol::FromPeer::PeerRequestSince { vv } => {
                        let vv = VersionVector::decode(&vv.iter().collect::<Vec<_>>()).unwrap();
                        let update = self.server.export(ExportMode::updates(&vv)).unwrap();
                        let current = self.server.oplog_vv().encode();
                        self.remote(sync_protocol::FromRemote::RemoteUpdateSince {
                            update: SliceWrapper::from_cooked(&update),
                            vv: SliceWrapper::from_cooked(&current),
                        });
                    }
                    sync_protocol::FromPeer::PeerUpdate { updates, id } => {
                        for update in updates {
                            self.server
                                .import(&update.iter().collect::<Vec<_>>())
                                .unwrap();
                        }
                        self.remote(sync_protocol::FromRemote::RemoteUpdateAck { id });
                    }
                    sync_protocol::FromPeer::PeerRequestSnapshot {} => {
                        let snapshot = self.server.export(ExportMode::Snapshot).unwrap();
                        self.remote(sync_protocol::FromRemote::RemoteSnapshot {
                            snapshot: SliceWrapper::from_cooked(&snapshot),
                        });
                    }
                    _ => {}
                },
                4 => {
                    let flags = self.session.socket_text(a, "pong".into(), self.at).unwrap();
                    self.record("socketText", json!([a, "pong", self.at]), flags);
                }
                5 => {
                    let flags = self
                        .session
                        .socket_closed(a, 1000, true, self.at, 1_000_000.0 + self.at)
                        .unwrap();
                    self.record(
                        "socketClosed",
                        json!([a, 1000, true, self.at, 1_000_000.0 + self.at]),
                        flags,
                    );
                }
                6 => {
                    let op = w::StorageOpMsg::deserialize(&data).unwrap();
                    if op.kind == 0 || op.kind == 1 {
                        let data = bytes(&w::LocalStateMsg {
                            snapshot: vec![],
                            covers_owner: String::new(),
                            covers_seq: 0,
                            orphans: vec![],
                            assist: vec![],
                        });
                        let flags = self
                            .session
                            .storage_loaded(
                                a,
                                Some(data.clone()),
                                0,
                                self.at,
                                1_000_000.0 + self.at,
                            )
                            .unwrap();
                        self.record(
                            "storageLoaded",
                            json!([a, data, 0, self.at, 1_000_000.0 + self.at]),
                            flags,
                        );
                    } else {
                        let flags = self
                            .session
                            .storage_done(a, true, 0, self.at, 1_000_000.0 + self.at)
                            .unwrap();
                        self.record(
                            "storageDone",
                            json!([a, true, 0, self.at, 1_000_000.0 + self.at]),
                            flags,
                        );
                    }
                }
                8 => {}
                _ => panic!("unexpected I/O {tag}"),
            }
        }
    }
    fn advance(&mut self, target: f64) {
        let mut budget = 1000;
        while self.session.wake_at() >= 0.0 && self.session.wake_at() <= target {
            budget -= 1;
            assert!(budget > 0);
            self.at = self.session.wake_at();
            let flags = self.session.tick(self.at, 1_000_000.0 + self.at).unwrap();
            self.record("tick", json!([self.at, 1_000_000.0 + self.at]), flags);
            self.settle();
        }
        self.at = target;
    }
}
fn main() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/collaboration/tests/executor-traces");
    std::fs::create_dir_all(&root).unwrap();
    for seed in 1..=20u64 {
        let config = w::SessionConfigMsg {
            doc: format!("executor-fixture-{seed}"),
            session: format!("00000000-0000-0000-0000-{seed:012}"),
            user: "fixture-user".into(),
            peers: vec![100 + seed, 1000 + seed, 2000 + seed],
            access: w::Access::Edit,
            transport: w::Transport::Direct,
            durable: true,
            chatter: false,
            headless: false,
            view_engine: 0,
            view_os: 0,
            token: String::new(),
            traceparent: String::new(),
            coalesce: 25,
            snapshot_interval: 5000,
            observed: vec![],
        };
        let config = bytes(&config);
        let session = DocSession::create(generated::ABI_MAJOR, &config, 0.0, 1_000_000.0).unwrap();
        let server = lexical_loro::new_doc(90000).unwrap();
        let mut d = Driver {
            session,
            at: 0.0,
            log: vec![],
            actions: vec![],
            pending: VecDeque::new(),
            server,
            conn: 0,
        };
        let data = bytes(&input(0));
        d.actions.push(json!({"kind":"input","at":0,"bytes":data}));
        d.packet(data);
        d.settle();
        d.advance(1.0);
        d.actions.push(json!({"kind":"open","at":1}));
        let flags = d.session.socket_opened(d.conn, 1.0, 1_000_001.0).unwrap();
        d.record("socketOpened", json!([d.conn, 1.0, 1_000_001.0]), flags);
        d.settle();
        d.advance(2.0);
        let snapshot = d.server.export(ExportMode::Snapshot).unwrap();
        let frames = sync_protocol::framing::into_frames(
            &bytes(&sync_protocol::FromRemote::RemoteInitialSync {
                snapshot: SliceWrapper::from_cooked(&snapshot),
                awareness: SliceWrapper::from_cooked(&[]),
            }),
            900000,
        );
        for frame in frames {
            d.actions.push(json!({"kind":"frame","at":2,"bytes":frame}));
            d.frame(frame);
        }
        d.settle();
        for i in 0..5u32 {
            let at = 10.0 + f64::from(i) * f64::from(30 + seed as u32);
            d.advance(at);
            let mut data = input(3);
            data.operations.push(w::DocOpMsg {
                kind: 0,
                path: w::ContainerPathMsg {
                    root: "fixture".into(),
                    steps: vec![],
                },
                key: format!("field-{i}"),
                index: 0,
                len: 0,
                value: vec![w::DocValueNode {
                    kind: 3,
                    key: String::new(),
                    num: 0.0,
                    int: (seed * 100 + u64::from(i)) as i64,
                    str: String::new(),
                    bytes: vec![],
                    children: 0,
                }],
            });
            let data = bytes(&data);
            d.actions.push(json!({"kind":"input","at":at,"bytes":data}));
            d.packet(data);
            d.settle();
        }
        d.advance(5001.0);
        d.actions.push(json!({"kind":"advance","at":5001}));
        let mut stop = input(5);
        stop.request = u32::MAX;
        let data = bytes(&stop);
        d.actions.push(json!({"kind":"close","at":5002}));
        d.advance(5002.0);
        d.packet(data);
        d.settle();
        let fixture = json!({"seed":seed,"config":config,"actions":d.actions,"calls":d.log});
        let path = root.join(format!("{seed:02}.json"));
        let recorded = serde_json::to_string_pretty(&fixture).unwrap() + "\n";
        if std::env::var_os("CHECK_SESSION_TRACES").is_some() {
            assert_eq!(
                serde_json::to_string(
                    &serde_json::from_str::<serde_json::Value>(
                        &std::fs::read_to_string(&path).unwrap(),
                    )
                    .expect("valid trace JSON"),
                )
                .expect("canonical trace JSON"),
                serde_json::to_string(&fixture).expect("canonical recorded trace"),
                "stale trace: {}",
                path.display()
            );
        } else {
            std::fs::write(path, recorded).unwrap();
        }
    }
}
