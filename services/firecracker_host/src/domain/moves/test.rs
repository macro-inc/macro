use std::collections::{HashMap, HashSet};
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex};

use chrono::{Duration, Utc};
use firecracker_host_api::moves::{
    AdoptComputer, ExpectMove, MoveTicket, PeerSnapshot, Replicate, ReplicationState,
};
use firecracker_host_api::{
    Computer, ComputerId, ComputerResources, ComputerRole, ControlPlaneId, EnrollmentGeneration,
    PairingId, PowerState,
};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio_util::task::TaskTracker;

use super::{MoveHost, MoveService, Origin, Peers, Place, Replicas, SendFrom};
use crate::domain::service::HostError;

const TICKET: &str = "0123456789abcdef0123456789abcdef";
const GOLDEN_GUID: u64 = 7;

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
struct FakeError(String);

/// A snapshot in a fake stream: what it is and what it is incremental from.
#[derive(serde::Serialize, serde::Deserialize)]
struct FakeStream {
    snapshot: String,
    guid: u64,
    from_guid: Option<u64>,
}

#[derive(Default)]
struct Datasets {
    /// (place, computer) -> snapshots, oldest first.
    snapshots: HashMap<(bool, ComputerId), Vec<PeerSnapshot>>,
    /// Computers whose dataset is a clone of the golden.
    clones: HashSet<(bool, ComputerId)>,
    bases: Vec<u64>,
    next_guid: u64,
    log: Vec<String>,
}

#[derive(Clone, Default)]
struct FakeReplicas(Arc<Mutex<Datasets>>);

fn key(place: Place, computer_id: ComputerId) -> (bool, ComputerId) {
    (place == Place::Live, computer_id)
}

impl FakeReplicas {
    fn with_live_clone(computer_id: ComputerId) -> Self {
        let replicas = Self::default();
        {
            let mut datasets = replicas.0.lock().unwrap();
            datasets
                .snapshots
                .insert(key(Place::Live, computer_id), Vec::new());
            datasets.clones.insert(key(Place::Live, computer_id));
            datasets.next_guid = 100;
        }
        replicas
    }

    fn staged_names(&self, computer_id: ComputerId) -> Vec<String> {
        self.0
            .lock()
            .unwrap()
            .snapshots
            .get(&key(Place::Staged, computer_id))
            .map(|snapshots| snapshots.iter().map(|s| s.name.clone()).collect())
            .unwrap_or_default()
    }

    fn log(&self) -> Vec<String> {
        self.0.lock().unwrap().log.clone()
    }
}

impl Replicas for FakeReplicas {
    type Err = FakeError;

    async fn snapshots(
        &self,
        place: Place,
        computer_id: ComputerId,
    ) -> Result<Vec<PeerSnapshot>, FakeError> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .snapshots
            .get(&key(place, computer_id))
            .cloned()
            .unwrap_or_default())
    }

    async fn origin(
        &self,
        place: Place,
        computer_id: ComputerId,
    ) -> Result<Option<Origin>, FakeError> {
        let datasets = self.0.lock().unwrap();
        Ok(datasets
            .clones
            .contains(&key(place, computer_id))
            .then(|| Origin {
                full_name: "pool/goldens/img/2v-2048m@built-1".to_owned(),
                guid: GOLDEN_GUID,
            }))
    }

    async fn snapshot(
        &self,
        place: Place,
        computer_id: ComputerId,
        name: &str,
    ) -> Result<u64, FakeError> {
        let mut datasets = self.0.lock().unwrap();
        datasets.next_guid += 1;
        let guid = datasets.next_guid;
        datasets
            .snapshots
            .get_mut(&key(place, computer_id))
            .ok_or_else(|| FakeError("no dataset".to_owned()))?
            .push(PeerSnapshot {
                name: name.to_owned(),
                guid,
            });
        Ok(guid)
    }

    async fn send(
        &self,
        place: Place,
        computer_id: ComputerId,
        from: &SendFrom,
        snapshot: &str,
        sink: &mut (impl AsyncWrite + Unpin + Send),
        _progress: &AtomicU64,
    ) -> Result<(), FakeError> {
        let stream = {
            let mut datasets = self.0.lock().unwrap();
            datasets
                .log
                .push(format!("send {from:?} -> {snapshot} from {place:?}"));
            let snapshots = datasets
                .snapshots
                .get(&key(place, computer_id))
                .cloned()
                .unwrap_or_default();
            let guid_of = |name: &str| {
                snapshots
                    .iter()
                    .find(|s| s.name == name)
                    .map(|s| s.guid)
                    .ok_or_else(|| FakeError(format!("no snapshot {name}")))
            };
            FakeStream {
                snapshot: snapshot.to_owned(),
                guid: guid_of(snapshot)?,
                from_guid: match from {
                    SendFrom::Nothing | SendFrom::Resume(_) => None,
                    SendFrom::Snapshot(name) => Some(guid_of(name)?),
                    SendFrom::Origin(_) => Some(GOLDEN_GUID),
                },
            }
        };
        let mut line = serde_json::to_vec(&stream).unwrap();
        line.push(b'\n');
        sink.write_all(&line)
            .await
            .map_err(|error| FakeError(error.to_string()))
    }

    async fn send_base(
        &self,
        origin: &Origin,
        sink: &mut (impl AsyncWrite + Unpin + Send),
        _progress: &AtomicU64,
    ) -> Result<(), FakeError> {
        self.0
            .lock()
            .unwrap()
            .log
            .push(format!("send base {}", origin.guid));
        sink.write_all(b"base\n")
            .await
            .map_err(|error| FakeError(error.to_string()))
    }

    async fn receive(
        &self,
        computer_id: ComputerId,
        origin_guid: Option<u64>,
        source: &mut (impl AsyncRead + Unpin + Send),
    ) -> Result<(), FakeError> {
        let mut line = String::new();
        BufReader::new(source)
            .read_line(&mut line)
            .await
            .map_err(|error| FakeError(error.to_string()))?;
        let stream: FakeStream =
            serde_json::from_str(&line).map_err(|error| FakeError(error.to_string()))?;
        let mut datasets = self.0.lock().unwrap();
        let staged = key(Place::Staged, computer_id);
        match (origin_guid, datasets.snapshots.get(&staged)) {
            (Some(origin), None) => {
                if !datasets.bases.contains(&origin) || stream.from_guid != Some(origin) {
                    return Err(FakeError("no such base".to_owned()));
                }
            }
            (None, Some(ours)) => {
                if ours.last().map(|s| s.guid) != stream.from_guid {
                    return Err(FakeError(
                        "incremental from a snapshot we do not have".to_owned(),
                    ));
                }
            }
            _ => return Err(FakeError("stream does not fit".to_owned())),
        }
        datasets
            .snapshots
            .entry(staged)
            .or_default()
            .push(PeerSnapshot {
                name: stream.snapshot,
                guid: stream.guid,
            });
        Ok(())
    }

    async fn receive_base(
        &self,
        guid: u64,
        source: &mut (impl AsyncRead + Unpin + Send),
    ) -> Result<(), FakeError> {
        let mut line = String::new();
        BufReader::new(source)
            .read_line(&mut line)
            .await
            .map_err(|error| FakeError(error.to_string()))?;
        self.0.lock().unwrap().bases.push(guid);
        Ok(())
    }

    async fn bases(&self) -> Result<Vec<u64>, FakeError> {
        Ok(self.0.lock().unwrap().bases.clone())
    }

    async fn resume_token(&self, _computer_id: ComputerId) -> Result<Option<String>, FakeError> {
        Ok(None)
    }

    async fn stage(&self, computer_id: ComputerId) -> Result<(), FakeError> {
        let mut datasets = self.0.lock().unwrap();
        let live = key(Place::Live, computer_id);
        let snapshots = datasets
            .snapshots
            .remove(&live)
            .ok_or_else(|| FakeError("not live".to_owned()))?;
        datasets
            .snapshots
            .insert(key(Place::Staged, computer_id), snapshots);
        if datasets.clones.remove(&live) {
            datasets.clones.insert(key(Place::Staged, computer_id));
        }
        datasets.log.push("stage".to_owned());
        Ok(())
    }

    async fn unstage(&self, computer_id: ComputerId, refquota_bytes: u64) -> Result<(), FakeError> {
        let mut datasets = self.0.lock().unwrap();
        let snapshots = datasets
            .snapshots
            .remove(&key(Place::Staged, computer_id))
            .ok_or_else(|| FakeError("not staged".to_owned()))?;
        datasets
            .snapshots
            .insert(key(Place::Live, computer_id), snapshots);
        datasets.log.push(format!("unstage quota {refquota_bytes}"));
        Ok(())
    }

    async fn mount_staged(&self, _computer_id: ComputerId) -> Result<(), FakeError> {
        Ok(())
    }

    async fn staged(&self) -> Result<Vec<ComputerId>, FakeError> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .snapshots
            .keys()
            .filter(|(live, _)| !live)
            .map(|(_, computer_id)| *computer_id)
            .collect())
    }

    async fn drop_staged(&self, computer_id: ComputerId) -> Result<(), FakeError> {
        self.0
            .lock()
            .unwrap()
            .snapshots
            .remove(&key(Place::Staged, computer_id));
        Ok(())
    }

    async fn prune(
        &self,
        place: Place,
        computer_id: ComputerId,
        keep: &str,
    ) -> Result<(), FakeError> {
        let mut datasets = self.0.lock().unwrap();
        if let Some(snapshots) = datasets.snapshots.get_mut(&key(place, computer_id)) {
            snapshots.retain(|s| s.name.as_str() >= keep);
        }
        Ok(())
    }
}

/// A host whose computers are live or not, recording what it was asked.
#[derive(Default)]
struct FakeHost {
    live: Mutex<HashSet<ComputerId>>,
    staged: Mutex<HashSet<ComputerId>>,
    calls: Mutex<Vec<String>>,
}

fn computer(computer_id: ComputerId) -> Computer {
    Computer {
        computer_id,
        control_plane_id: ControlPlaneId::try_new("plane").unwrap(),
        generation: EnrollmentGeneration::new(3),
        pairing_id: PairingId::new_from_uuid(uuid::Uuid::nil()),
        image: firecracker_host_api::GuestImage::try_new("img").unwrap(),
        role: ComputerRole::Person,
        resources: ComputerResources {
            vcpus: 2,
            memory_mib: 2048,
            root_disk_gib: 10,
            home_disk_gib: 20,
        },
        state: PowerState::Stopped,
        enrollment_present: false,
        created_at: Utc::now(),
        usage: None,
        restore_pending: false,
        last_launch: None,
    }
}

impl MoveHost for FakeHost {
    async fn is_live(&self, computer_id: ComputerId) -> bool {
        self.live.lock().unwrap().contains(&computer_id)
    }

    async fn release<Staging>(
        &self,
        computer_id: ComputerId,
        stage: Staging,
    ) -> Result<(), HostError>
    where
        Staging: Future<Output = Result<(), HostError>> + Send,
    {
        if !self.live.lock().unwrap().contains(&computer_id) {
            return Err(HostError::NotFound(computer_id));
        }
        self.calls.lock().unwrap().push("shutdown".to_owned());
        stage.await?;
        self.live.lock().unwrap().remove(&computer_id);
        Ok(())
    }

    async fn adopt<Unstaging, Unstage>(
        &self,
        computer_id: ComputerId,
        request: &AdoptComputer,
        unstage: Unstage,
    ) -> Result<Computer, HostError>
    where
        Unstage: FnOnce(u64) -> Unstaging + Send,
        Unstaging: Future<Output = Result<(), HostError>> + Send,
    {
        if request.control_plane_id.as_str() != "plane" {
            return Err(HostError::GenerationMismatch(computer_id));
        }
        unstage(31 * 1024 * 1024 * 1024).await?;
        self.live.lock().unwrap().insert(computer_id);
        Ok(computer(computer_id))
    }

    fn set_staged(&self, computer_id: ComputerId, staged: bool) {
        let mut set = self.staged.lock().unwrap();
        if staged {
            set.insert(computer_id);
        } else {
            set.remove(&computer_id);
        }
    }
}

type Service = MoveService<FakeHost, FakeReplicas, Wire>;

/// Connects to the target service in memory.
#[derive(Clone, Default)]
struct Wire(Arc<Mutex<Option<Arc<Service>>>>);

#[derive(Debug, thiserror::Error)]
#[error("no target")]
struct NoTarget;

impl Peers for Wire {
    type Err = NoTarget;
    type Connection = tokio::io::DuplexStream;

    async fn connect(&self, _target: &str) -> Result<tokio::io::DuplexStream, NoTarget> {
        let target = self.0.lock().unwrap().clone().ok_or(NoTarget)?;
        let (ours, theirs) = tokio::io::duplex(64 * 1024);
        tokio::spawn(async move { target.serve_peer(theirs).await });
        Ok(ours)
    }
}

struct Hosts {
    computer_id: ComputerId,
    source: Arc<Service>,
    source_replicas: FakeReplicas,
    source_tasks: TaskTracker,
    target: Arc<Service>,
    target_replicas: FakeReplicas,
}

async fn hosts() -> Hosts {
    let computer_id = ComputerId::new_from_uuid(uuid::Uuid::now_v7());
    let source_host = Arc::new(FakeHost::default());
    source_host.live.lock().unwrap().insert(computer_id);
    let source_replicas = FakeReplicas::with_live_clone(computer_id);
    let target_replicas = FakeReplicas::default();
    let wire = Wire::default();
    let source_tasks = TaskTracker::new();
    let source = Arc::new(
        MoveService::start(
            source_host,
            source_replicas.clone(),
            wire.clone(),
            source_tasks.clone(),
        )
        .await
        .unwrap(),
    );
    let target = Arc::new(
        MoveService::start(
            Arc::new(FakeHost::default()),
            target_replicas.clone(),
            Wire::default(),
            TaskTracker::new(),
        )
        .await
        .unwrap(),
    );
    *wire.0.lock().unwrap() = Some(target.clone());
    Hosts {
        computer_id,
        source,
        source_replicas,
        source_tasks,
        target,
        target_replicas,
    }
}

fn replicate_request() -> Replicate {
    Replicate {
        target: "10.88.0.2:8446".to_owned(),
        ticket: MoveTicket::new(TICKET.to_owned()),
    }
}

async fn expect(hosts: &Hosts) {
    hosts
        .target
        .expect(
            hosts.computer_id,
            ExpectMove {
                ticket: MoveTicket::new(TICKET.to_owned()),
                expires_at: Utc::now() + Duration::hours(1),
            },
        )
        .await
        .unwrap();
}

/// Run one round to its end.
async fn round(hosts: &Hosts) -> firecracker_host_api::moves::Replication {
    hosts
        .source
        .replicate(hosts.computer_id, replicate_request())
        .await
        .unwrap();
    hosts.source_tasks.close();
    hosts.source_tasks.wait().await;
    hosts.source_tasks.reopen();
    hosts.source.replication(hosts.computer_id)
}

#[tokio::test]
async fn a_computer_moves_with_pre_copy_final_round_and_adopt() {
    let hosts = hosts().await;
    expect(&hosts).await;

    // Seed: the target has no base, so the golden goes first, then the
    // computer incremental from it.
    let first = round(&hosts).await;
    assert_eq!(first.state, ReplicationState::Done);
    assert!(!first.released);
    assert_eq!(
        first.incremental_from.as_deref(),
        Some("pool/goldens/img/2v-2048m@built-1")
    );
    let seed = first.snapshot.clone().unwrap();
    assert_eq!(
        hosts.target_replicas.staged_names(hosts.computer_id),
        std::slice::from_ref(&seed)
    );

    // Catch-up: incremental from the snapshot both hold; no base again.
    let second = round(&hosts).await;
    assert_eq!(second.state, ReplicationState::Done);
    assert_eq!(second.incremental_from.as_deref(), Some(seed.as_str()));

    // Release, then the final round goes from the staged copy.
    let released = hosts.source.release(hosts.computer_id).await.unwrap();
    assert!(!released.live);
    assert!(released.staged);
    let last = round(&hosts).await;
    assert_eq!(last.state, ReplicationState::Done);
    assert!(last.released);
    assert_eq!(last.incremental_from, second.snapshot);

    let adopted = hosts
        .target
        .adopt(
            hosts.computer_id,
            AdoptComputer {
                control_plane_id: ControlPlaneId::try_new("plane").unwrap(),
                generation: EnrollmentGeneration::new(3),
            },
        )
        .await
        .unwrap();
    assert_eq!(adopted.state, PowerState::Stopped);
    let target = hosts.target.move_holding(hosts.computer_id).await.unwrap();
    assert!(target.live);
    assert!(!target.staged);

    assert_eq!(
        hosts
            .source_replicas
            .log()
            .iter()
            .filter(|line| line.starts_with("send base"))
            .count(),
        1
    );
    assert!(
        hosts
            .target_replicas
            .log()
            .contains(&format!("unstage quota {}", 31_u64 * 1024 * 1024 * 1024))
    );
}

#[tokio::test]
async fn a_round_without_the_ticket_fails_and_sends_nothing() {
    let hosts = hosts().await;
    let replication = round(&hosts).await;
    let ReplicationState::Failed { message } = replication.state else {
        panic!("expected a failure, got {replication:?}");
    };
    assert!(message.contains("no move"), "{message}");
    assert!(
        hosts
            .target_replicas
            .staged_names(hosts.computer_id)
            .is_empty()
    );
}

#[tokio::test]
async fn a_target_where_the_computer_is_live_refuses_it() {
    let hosts = hosts().await;
    expect(&hosts).await;
    hosts
        .target
        .host
        .live
        .lock()
        .unwrap()
        .insert(hosts.computer_id);
    let replication = round(&hosts).await;
    assert!(matches!(replication.state, ReplicationState::Failed { .. }));
    assert!(
        hosts
            .target_replicas
            .staged_names(hosts.computer_id)
            .is_empty()
    );
}

#[tokio::test]
async fn release_waits_for_a_running_round_and_repeats_safely() {
    let hosts = hosts().await;
    expect(&hosts).await;
    round(&hosts).await;
    hosts.source.release(hosts.computer_id).await.unwrap();
    // Again: already staged, nothing to stop.
    let again = hosts.source.release(hosts.computer_id).await.unwrap();
    assert!(again.staged);
    assert!(
        hosts
            .source
            .host
            .staged
            .lock()
            .unwrap()
            .contains(&hosts.computer_id)
    );
}

#[tokio::test]
async fn a_short_ticket_is_refused() {
    let hosts = hosts().await;
    let refused = hosts
        .target
        .expect(
            hosts.computer_id,
            ExpectMove {
                ticket: MoveTicket::new("short".to_owned()),
                expires_at: Utc::now() + Duration::hours(1),
            },
        )
        .await;
    assert!(matches!(refused, Err(HostError::MoveRefused(_))));
}

#[tokio::test]
async fn request_lines_have_a_size_limit() {
    let (mut ours, theirs) = tokio::io::duplex(1024);
    let line = vec![b'x'; super::MAX_PEER_LINE_BYTES + 10];
    tokio::spawn(async move {
        let _ = ours.write_all(&line).await;
    });
    let mut reader = BufReader::new(theirs);
    let read: Result<serde_json::Value, HostError> = super::read_line(&mut reader).await;
    assert!(matches!(read, Err(HostError::MoveRefused(_))));
}

/// The one client against the real move routes: a path, method or
/// body that drifts between them fails here.
#[tokio::test]
async fn the_client_and_the_move_routes_agree() {
    use firecracker_host_api::client::HostClient;

    async fn serve(service: Arc<Service>) -> HostClient {
        let router = crate::inbound::moves::router(service);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, router).await });
        HostClient::over_plain_http(&format!("http://{address}")).unwrap()
    }

    let hosts = hosts().await;
    let source = serve(hosts.source.clone()).await;
    let target = serve(hosts.target.clone()).await;
    let request = replicate_request();

    let expected = target
        .expect_move(
            hosts.computer_id,
            &ExpectMove {
                ticket: MoveTicket::new(TICKET.to_owned()),
                expires_at: Utc::now() + Duration::hours(1),
            },
        )
        .await
        .unwrap();
    assert!(!expected.live);
    assert_eq!(
        source.replication(hosts.computer_id).await.unwrap().state,
        ReplicationState::Idle
    );
    source.replicate(hosts.computer_id, &request).await.unwrap();
    hosts.source_tasks.close();
    hosts.source_tasks.wait().await;
    hosts.source_tasks.reopen();
    assert_eq!(
        source.replication(hosts.computer_id).await.unwrap().state,
        ReplicationState::Done
    );

    let released = source.release(hosts.computer_id).await.unwrap();
    assert!(released.staged);
    source.replicate(hosts.computer_id, &request).await.unwrap();
    hosts.source_tasks.close();
    hosts.source_tasks.wait().await;
    assert!(
        source
            .replication(hosts.computer_id)
            .await
            .unwrap()
            .released
    );

    let adopted = target
        .adopt(
            hosts.computer_id,
            &AdoptComputer {
                control_plane_id: ControlPlaneId::try_new("plane").unwrap(),
                generation: EnrollmentGeneration::new(3),
            },
        )
        .await
        .unwrap();
    assert_eq!(adopted.computer_id, hosts.computer_id);
    assert!(target.move_holding(hosts.computer_id).await.unwrap().live);
    source.drop_staged(hosts.computer_id).await.unwrap();
    assert!(!source.move_holding(hosts.computer_id).await.unwrap().staged);
}
