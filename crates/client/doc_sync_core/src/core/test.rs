use super::*;
use std::cell::RefCell;

mod assistance;
mod comments;
mod lifecycle;
mod presence;
mod recovery;
mod recovery_history;
mod replay_fixups;
mod seed_adoption;
mod stop;
mod wal;

fn now(ms: u64) -> Now {
    Now {
        mono: Millis(ms),
        wall: UnixMillis(i64::try_from(ms).unwrap()),
    }
}
fn config(transport: TransportKind, persistence: Persistence) -> SyncConfig {
    SyncConfig {
        doc: "document-test".parse().unwrap(),
        session: SessionId(uuid_value::Uuid::from_u128(1)),
        user: UserKey("user-test".into()),
        transport,
        persistence,
        access: Access::Edit,
        initial_token: Some(SyncToken::new("test-only-token".into())),
        traceparent: Some("trace-test".into()),
        timeouts: Timeouts::default(),
        heartbeat: HeartbeatPolicy::default(),
        backoff: BackoffPolicy::default(),
        converge: ConvergePolicy::default(),
        wal: WalPolicy::default(),
        snapshot_interval: Some(Millis(5000)),
        presence: PresencePolicy {
            timeout: WallDuration(10000),
            refresh: Some(Millis(3000)),
            user: PresenceUser {
                user_id: None,
                color: PaletteColor::Blue,
            },
            key: PresenceKeyMode::Peer,
        },
        chatter: false,
        reset_budget: ResetBudget::default(),
    }
}
#[derive(Default)]
struct Calls {
    imports: Vec<ImportOrigin>,
    exports: Vec<loro::VersionVector>,
    snapshots: Vec<loro::Frontiers>,
}
struct Doc {
    loro: loro::LoroDoc,
    calls: RefCell<Calls>,
    faults: VecDeque<Result<Imported, ImportFailure>>,
    replace_fails: bool,
    probe_result: Option<Result<Imported, ImportFailure>>,
    replay_edit: Option<ReplayEdit>,
    export_fails: bool,
}
enum ReplayEdit {
    Before(&'static str),
    After(&'static str),
    AfterThenError(&'static str),
}
impl Doc {
    fn new(peer: u64) -> Self {
        let loro = loro::LoroDoc::new();
        loro.set_peer_id(peer).unwrap();
        Self {
            loro,
            calls: RefCell::new(Calls::default()),
            faults: VecDeque::new(),
            replace_fails: false,
            probe_result: None,
            replay_edit: None,
            export_fails: false,
        }
    }
    fn edit(&self, s: &str) {
        let text = self.loro.get_text("text");
        text.insert(text.len_unicode(), s).unwrap();
        self.loro
            .commit_with(loro::CommitOptions::default().timestamp(0));
    }
    fn snapshot(&self) -> Vec<u8> {
        self.loro.export(loro::ExportMode::snapshot()).unwrap()
    }
}
fn corrupt() -> ImportFailure {
    ImportFailure::Loro(loro::LoroError::DecodeDataCorruptionError)
}
impl SyncDoc for Doc {
    fn peer_id(&self) -> u64 {
        self.loro.peer_id()
    }
    fn oplog_vv(&self) -> loro::VersionVector {
        self.loro.oplog_vv()
    }
    fn oplog_frontiers(&self) -> loro::Frontiers {
        self.loro.oplog_frontiers()
    }
    fn import_remote(
        &mut self,
        bytes: &[u8],
        origin: ImportOrigin,
    ) -> Result<Imported, ImportFailure> {
        self.calls.borrow_mut().imports.push(origin);
        if let Some(result) = self.faults.pop_front() {
            return result;
        }
        let old = self.oplog_vv();
        let edit = if origin == ImportOrigin::WalReplay {
            self.replay_edit.take()
        } else {
            None
        };
        if let Some(ReplayEdit::Before(text)) = edit {
            self.edit(text);
        }
        let status = self.loro.import(bytes).map_err(ImportFailure::Loro)?;
        if let Some(ReplayEdit::After(text) | ReplayEdit::AfterThenError(text)) = edit {
            self.edit(text);
        }
        if matches!(edit, Some(ReplayEdit::AfterThenError(_))) {
            return Err(corrupt());
        }
        Ok(Imported {
            changed: old != self.oplog_vv(),
            new_ops: old != self.oplog_vv(),
            pending: status.pending.is_some(),
        })
    }
    fn export_local(&self, since: &loro::VersionVector) -> Result<Option<Vec<u8>>, ExportFailure> {
        self.calls.borrow_mut().exports.push(since.clone());
        if self.export_fails {
            return Err(ExportFailure::Loro(
                loro::LoroError::DecodeDataCorruptionError,
            ));
        }
        let peer = self.peer_id();
        let end = self.oplog_vv().get(&peer).copied().unwrap_or(0);
        let start = since.get(&peer).copied().unwrap_or(0);
        if start == end {
            return Ok(None);
        }
        self.loro
            .export(loro::ExportMode::updates_in_range(vec![loro::IdSpan::new(
                peer, start, end,
            )]))
            .map(Some)
            .map_err(|e| ExportFailure::Loro(loro::LoroError::DecodeError(e.to_string().into())))
    }
    fn export_shallow_snapshot(&self, at: &loro::Frontiers) -> Result<Vec<u8>, ExportFailure> {
        self.calls.borrow_mut().snapshots.push(at.clone());
        self.loro
            .export(loro::ExportMode::shallow_snapshot(at))
            .map_err(|e| ExportFailure::Loro(loro::LoroError::DecodeError(e.to_string().into())))
    }
    fn snapshot_stats(&self, at: &loro::Frontiers) -> SnapshotStats {
        SnapshotStats::from_doc(&self.loro, at)
    }
    fn probe_import(
        &mut self,
        snapshot: &[u8],
        bytes: &[u8],
        new_peer: loro::PeerID,
    ) -> Result<Imported, ImportFailure> {
        if let Some(result) = self.probe_result.take() {
            return result;
        }
        let mut doc = Self::new(new_peer);
        doc.seed(snapshot, SeedKind::Remote)?;
        doc.import_remote(bytes, ImportOrigin::WalReplay)
    }
    fn seed(&mut self, snapshot: &[u8], _: SeedKind) -> Result<(), ImportFailure> {
        if !snapshot.is_empty() {
            self.loro.import(snapshot).map_err(ImportFailure::Loro)?;
        }
        Ok(())
    }
    fn replace(&mut self, snapshot: &[u8], peer: u64) -> Result<(), ImportFailure> {
        if self.replace_fails {
            return Err(corrupt());
        }
        let mut new = Self::new(peer);
        new.seed(snapshot, SeedKind::Remote)?;
        self.loro = new.loro;
        Ok(())
    }
}
struct Harness {
    core: SyncCore,
    doc: Doc,
    out: SyncOutput,
    time: u64,
}
impl Harness {
    fn new(transport: TransportKind, persistence: Persistence) -> Self {
        Self {
            core: SyncCore::new(config(transport, persistence), now(0)).unwrap(),
            doc: Doc::new(1),
            out: SyncOutput::default(),
            time: 0,
        }
    }
    fn send(&mut self, input: SyncInput) {
        self.core
            .handle(now(self.time), &mut self.doc, input, &mut self.out);
    }
    fn at(&mut self, ms: u64, input: SyncInput) {
        self.time = ms;
        self.send(input)
    }
    fn start(&mut self) {
        self.send(SyncInput::Start);
    }
    fn seed(&mut self) {
        self.send(SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot: vec![],
        });
        self.send(SyncInput::Ready);
    }
    fn running(transport: TransportKind, persistence: Persistence) -> Self {
        let mut h = Self::new(transport, persistence);
        h.start();
        if persistence == Persistence::Durable {
            let id = h.storage_id();
            h.send(SyncInput::Storage(StorageEvent::Loaded {
                id,
                result: Ok(empty()),
            }));
        }
        h.seed();
        if transport == TransportKind::Direct {
            h.open();
        }
        h
    }
    fn open(&mut self) {
        let conn = self.core.connection.conn().unwrap();
        self.send(SyncInput::Socket {
            conn,
            event: SocketEvent::Opened,
        });
        self.remote(sync_protocol::FromRemote::RemoteInitialSync {
            snapshot: SliceWrapper::from_cooked(&[]),
            awareness: SliceWrapper::from_cooked(&[]),
        });
    }
    fn remote(&mut self, message: sync_protocol::FromRemote<'_>) {
        let mut bytes = vec![];
        message.serialize(&mut bytes).unwrap();
        let conn = self.core.connection.conn().unwrap();
        for frame in sync_protocol::framing::into_frames(&bytes, 900000) {
            self.send(SyncInput::Socket {
                conn,
                event: SocketEvent::Frame(frame),
            });
        }
    }
    fn storage_id(&self) -> StorageOpId {
        self.out
            .io
            .iter()
            .find_map(|e| {
                if let IoEffect::Storage { id, .. } = e {
                    Some(*id)
                } else {
                    None
                }
            })
            .unwrap()
    }
    fn done(&mut self, id: StorageOpId) {
        self.send(SyncInput::Storage(StorageEvent::Done {
            id,
            result: Ok(()),
        }));
    }
    fn edit(&mut self) {
        self.doc.edit("x");
        self.send(SyncInput::LocalChanged);
    }
    fn append(&mut self) {
        self.edit();
        self.at(self.time + 25, SyncInput::Tick);
    }
    fn ack(&mut self) {
        let id = self.core.push.as_ref().unwrap().id.as_str().to_owned();
        self.remote(sync_protocol::FromRemote::RemoteUpdateAck { id: &id });
    }
    fn close(&mut self, code: u16) {
        let conn = self.core.connection.conn().unwrap();
        self.send(SyncInput::Socket {
            conn,
            event: SocketEvent::Closed { code, clean: false },
        });
    }
    fn settle(&mut self) {
        let vv = self.core.since.back().unwrap().vv.clone();
        self.remote(sync_protocol::FromRemote::RemoteUpdateSince {
            vv: SliceWrapper::from_cooked(&vv),
            update: SliceWrapper::from_cooked(&[]),
        });
    }
}
fn empty() -> LocalState {
    LocalState {
        snapshot: None,
        orphans: vec![],
        assist: vec![],
    }
}
fn row(seq: u64) -> StoredWalRecord {
    let doc = Doc::new(7);
    doc.edit("foreign");
    StoredWalRecord {
        record: WalRecord {
            seq: WalSeq(seq),
            created_at: UnixMillis(0),
            user: UserKey("user-test".into()),
            foreign: false,
            quarantined: false,
            bytes: doc.snapshot(),
        },
        delivered: false,
    }
}

mod effective_access;
