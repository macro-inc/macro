//! Real TLS peers place mail in both windows before an IDLE wait is armed.
use super::*;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};

#[derive(Clone, Copy)]
enum Arrival {
    BeforeSelect,
    UidNextOnly,
    ExistsOnly,
    EpochOnly,
    ModseqOnly,
    BeforeContinuation,
    Keepalives,
    NoIdleUidNext,
    NoIdleModseq,
    SelectRefused,
}

struct IdlePeer {
    transport: Arc<ProtocolTransport>,
    idles: tokio::sync::mpsc::UnboundedReceiver<()>,
    credentials: Credentials,
    server: tokio::task::JoinHandle<()>,
}

impl Drop for IdlePeer {
    fn drop(&mut self) {
        self.server.abort();
    }
}

async fn peer(arrival: Arrival) -> IdlePeer {
    let (tls, pem) = smtp::retry_test::tls_config();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (idling, idles) = tokio::sync::mpsc::unbounded_channel();
    let server = tokio::spawn(async move {
        let mut connections = tokio::task::JoinSet::new();
        loop {
            let (socket, _) = listener.accept().await.unwrap();
            let tls = Arc::clone(&tls);
            let idling = idling.clone();
            connections.spawn(async move {
                let Ok(mut socket) = tokio_rustls::TlsAcceptor::from(tls).accept(socket).await else {
                    return;
                };
                socket.write_all(b"* OK synthetic IMAP\r\n").await.unwrap();
                socket.flush().await.unwrap();
                let (read, mut write) = tokio::io::split(socket);
                let mut socket = BufReader::new(read);
                loop {
                    let mut request = String::new();
                    let Ok(received) = socket.read_line(&mut request).await else {
                        return;
                    };
                    if received == 0 {
                        return;
                    }
                    let (tag, command) = request.trim_end().split_once(' ').unwrap();
                    if command.starts_with("CAPABILITY") {
                        let capabilities: &[u8] = match arrival {
                            Arrival::NoIdleUidNext => b"* CAPABILITY IMAP4rev1\r\n",
                            Arrival::NoIdleModseq => b"* CAPABILITY IMAP4rev1 CONDSTORE\r\n",
                            _ => b"* CAPABILITY IMAP4rev1 IDLE CONDSTORE\r\n",
                        };
                        write.write_all(capabilities).await.unwrap();
                    } else if command.starts_with("SELECT") {
                        if matches!(arrival, Arrival::SelectRefused) {
                            write.write_all(format!("{tag} NO mailbox unavailable\r\n").as_bytes()).await.unwrap();
                            write.flush().await.unwrap();
                            continue;
                        }
                        if matches!(arrival, Arrival::NoIdleModseq) {
                            assert!(command.contains("CONDSTORE"));
                        }
                        let (exists, next, modseq) = match arrival {
                            Arrival::BeforeSelect => (2, 3, 2),
                            Arrival::BeforeContinuation | Arrival::Keepalives => (1, 2, 1),
                            Arrival::UidNextOnly | Arrival::NoIdleUidNext => (1, 3, 1),
                            Arrival::ExistsOnly => (2, 2, 1),
                            Arrival::EpochOnly => (1, 2, 1),
                            Arrival::ModseqOnly | Arrival::NoIdleModseq => (1, 2, 2),
                            Arrival::SelectRefused => unreachable!(),
                        };
                        let epoch = if matches!(arrival, Arrival::EpochOnly) { 2 } else { 1 };
                        write.write_all(format!(
                            "* FLAGS (\\Seen)\r\n* {exists} EXISTS\r\n* OK [UIDVALIDITY {epoch}] epoch\r\n* OK [UIDNEXT {next}] next\r\n* OK [HIGHESTMODSEQ {modseq}] version\r\n"
                        ).as_bytes()).await.unwrap();
                    } else if command == "IDLE" {
                        if matches!(arrival, Arrival::BeforeContinuation) {
                            write.write_all(b"* 2 EXISTS\r\n").await.unwrap();
                        }
                        write.write_all(b"+ idling\r\n").await.unwrap();
                        write.flush().await.unwrap();
                        let _ = idling.send(());
                        let mut done = Vec::new();
                        let mut keepalives = tokio::time::interval_at(
                            tokio::time::Instant::now() + Duration::from_secs(1),
                            Duration::from_secs(1),
                        );
                        loop {
                            tokio::select! {
                                received = socket.read_until(b'\n', &mut done) => {
                                    if received.unwrap_or(0) == 0 { return; }
                                    break;
                                }
                                _ = keepalives.tick(), if matches!(arrival, Arrival::Keepalives) => {
                                    write.write_all(b"* OK Still here\r\n").await.unwrap();
                                    write.flush().await.unwrap();
                                }
                            }
                        }
                        assert_eq!(done, b"DONE\r\n");
                    }
                    write.write_all(format!("{tag} OK complete\r\n").as_bytes()).await.unwrap();
                    write.flush().await.unwrap();
                }
            });
        }
    });
    let transport = ProtocolTransport::new(
        Connector::new(LocalEndpoints {
            addresses: BTreeMap::from([("smtp.example.net:993".into(), address.to_string())]),
            trust_root_pem: Some(pem),
        })
        .unwrap(),
    );
    let login = Login {
        endpoint: Endpoint {
            host: "smtp.example.net".into(),
            port: 993,
            tls: TlsMode::Implicit,
            username: "reader@example.net".into(),
        },
        password: Secret("synthetic-unused-password".into()),
    };
    IdlePeer {
        transport: Arc::new(transport),
        idles,
        credentials: Credentials {
            features: None,
            binding: Some(Binding {
                link_id: uuid::Uuid::now_v7(),
                sync_generation: 1,
                grant_generation: 1,
            }),
            user_id: "synthetic-owner".into(),
            email: "reader@example.net".into(),
            imap: login.clone(),
            smtp: login,
        },
        server,
    }
}

#[tokio::test]
async fn mail_present_at_select_returns_before_entering_idle() {
    let peer = peer(Arrival::BeforeSelect).await;
    tokio::time::timeout(
        Duration::from_secs(2),
        peer.transport
            .wait_change(&peer.credentials, &[committed_inbox()], 240),
    )
    .await
    .expect("mail arriving after the committed snapshot must not wait for an IDLE timeout")
    .unwrap();
}

#[tokio::test]
async fn exists_before_the_idle_continuation_is_not_lost() {
    let peer = peer(Arrival::BeforeContinuation).await;
    tokio::time::timeout(
        Duration::from_secs(2),
        peer.transport
            .wait_change(&peer.credentials, &[committed_inbox()], 240),
    )
    .await
    .expect("EXISTS received during IDLE initialization must wake the next sync")
    .unwrap();
}

#[tokio::test]
async fn keepalives_do_not_extend_the_planned_idle_deadline() {
    let mut peer = peer(Arrival::Keepalives).await;
    let transport = Arc::clone(&peer.transport);
    let credentials = peer.credentials.clone();
    let mut watch = tokio::spawn(async move {
        transport
            .wait_change(&credentials, &[committed_inbox()], 10)
            .await
    });
    tokio::time::timeout(Duration::from_secs(2), peer.idles.recv())
        .await
        .unwrap()
        .expect("IDLE armed on the real TLS peer");
    let started = tokio::time::Instant::now();
    let result = tokio::time::timeout(Duration::from_secs(12), &mut watch).await;
    if result.is_err() {
        watch.abort();
        let _ = watch.await;
        panic!("periodic keepalives extended the absolute IDLE deadline");
    }
    assert_eq!(
        result
            .unwrap()
            .unwrap()
            .expect("a planned IDLE restart is a normal round"),
        WaitOutcome::Restarted
    );
    assert!(
        started.elapsed() >= Duration::from_secs(9),
        "a keepalive was incorrectly treated as a mailbox change"
    );
}

#[tokio::test]
async fn each_selected_watermark_can_wake_a_committed_folder() {
    for arrival in [
        Arrival::UidNextOnly,
        Arrival::ExistsOnly,
        Arrival::EpochOnly,
        Arrival::ModseqOnly,
    ] {
        let peer = peer(arrival).await;
        let outcome = tokio::time::timeout(
            Duration::from_secs(2),
            peer.transport
                .wait_change(&peer.credentials, &[committed_inbox()], 240),
        )
        .await
        .expect("a changed SELECT watermark must wake immediately")
        .unwrap();
        assert_eq!(outcome, WaitOutcome::Changed);
    }
}

#[tokio::test]
async fn no_idle_checks_uidnext_and_uses_condstore_for_existing_message_changes() {
    for arrival in [Arrival::NoIdleUidNext, Arrival::NoIdleModseq] {
        let mut peer = peer(arrival).await;
        let outcome = tokio::time::timeout(
            Duration::from_secs(2),
            peer.transport
                .wait_change(&peer.credentials, &[committed_inbox()], 180),
        )
        .await
        .expect("a changed SELECT must not wait for the no-IDLE poll")
        .unwrap();
        assert_eq!(outcome, WaitOutcome::Changed);
        assert!(
            peer.idles.try_recv().is_err(),
            "server did not advertise IDLE"
        );
    }
}

#[tokio::test]
async fn an_unselectable_physical_folder_requests_baseline_recovery() {
    let peer = peer(Arrival::SelectRefused).await;
    let outcome = tokio::time::timeout(
        Duration::from_secs(2),
        peer.transport
            .wait_change(&peer.credentials, &[committed_inbox()], 180),
    )
    .await
    .expect("SELECT refusal must reach the actor's bounded recovery backoff")
    .unwrap();
    assert_eq!(outcome, WaitOutcome::BaselineUnavailable);
}

#[tokio::test]
async fn a_saturated_watch_polls_without_idle_and_reuses_a_freed_slot() {
    let mut peer = peer(Arrival::Keepalives).await;
    let mut watches = (0..150)
        .map(|_| {
            peer.transport
                .connector
                .try_watch(&peer.credentials.imap.endpoint)
                .unwrap()
                .unwrap()
        })
        .collect::<Vec<_>>();
    let transport = peer.transport.clone();
    let credentials = peer.credentials.clone();
    let started = tokio::time::Instant::now();
    let poll = tokio::spawn(async move {
        transport
            .wait_change(&credentials, &[committed_inbox()], 180)
            .await
    });
    assert!(
        tokio::time::timeout(Duration::from_secs(1), peer.idles.recv())
            .await
            .is_err(),
        "a full host watch budget must never open IDLE"
    );
    drop(watches.pop());
    let outcome = tokio::time::timeout(Duration::from_secs(34), poll)
        .await
        .expect("the cheap poll must finish within its thirty-second interval")
        .unwrap()
        .unwrap();
    assert_eq!(outcome, WaitOutcome::Restarted);
    assert!(started.elapsed() >= Duration::from_secs(30));
    let transport = peer.transport.clone();
    let credentials = peer.credentials.clone();
    let rearmed = tokio::spawn(async move {
        transport
            .wait_change(&credentials, &[committed_inbox()], 180)
            .await
    });
    tokio::time::timeout(Duration::from_secs(2), peer.idles.recv())
        .await
        .unwrap()
        .expect("a freed watch slot must restore IDLE next round");
    rearmed.abort();
    let _ = rearmed.await;
}

#[tokio::test]
async fn a_watch_over_host_capacity_still_detects_new_mail_from_select() {
    let mut peer = peer(Arrival::BeforeSelect).await;
    let _watches = (0..150)
        .map(|_| {
            peer.transport
                .connector
                .try_watch(&peer.credentials.imap.endpoint)
                .unwrap()
                .unwrap()
        })
        .collect::<Vec<_>>();
    let outcome = tokio::time::timeout(
        Duration::from_secs(2),
        peer.transport
            .wait_change(&peer.credentials, &[committed_inbox()], 180),
    )
    .await
    .expect("an over-budget watch must still compare the folder's new-mail watermarks")
    .unwrap();
    assert_eq!(outcome, WaitOutcome::Changed);
    assert!(peer.idles.try_recv().is_err());
}

struct LabCipher(Credentials);
#[async_trait::async_trait]
impl CredentialCipher for LabCipher {
    async fn encrypt(&self, _: uuid::Uuid, _: &str, _: &Credentials) -> Result<Vec<u8>, Error> {
        Err(Error::Invalid)
    }
    async fn decrypt(&self, _: uuid::Uuid, _: &str, _: &[u8]) -> Result<Credentials, Error> {
        Ok(self.0.clone())
    }
}

#[tokio::test]
#[ignore = "requires the task-owned Dovecot lab on 35993; creates only a new synthetic mailbox"]
async fn real_tls_mail_after_snapshot_commit_is_indexed_without_an_idle_timeout() {
    use crate::domain::service::{Engine, test::MemoryRepository};
    use std::sync::atomic::{AtomicBool, AtomicU32};
    let user = format!("idle-gap-{}@example.net", uuid::Uuid::now_v7());
    let ca = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../docker/imap-lab/generated/ca.pem"),
    )
    .unwrap();
    let transport = Arc::new(ProtocolTransport::new(
        Connector::new(LocalEndpoints {
            addresses: BTreeMap::from([(
                "maillab.example.net:993".into(),
                "127.0.0.1:35993".into(),
            )]),
            trust_root_pem: Some(ca),
        })
        .unwrap(),
    ));
    let login = Login {
        endpoint: Endpoint {
            host: "maillab.example.net".into(),
            port: 993,
            tls: TlsMode::Implicit,
            username: user.clone(),
        },
        password: Secret("pass".into()),
    };
    let binding = Binding {
        link_id: uuid::Uuid::now_v7(),
        sync_generation: 1,
        grant_generation: 1,
    };
    let credentials = Credentials {
        features: None,
        binding: Some(binding),
        user_id: "owner".into(),
        email: user,
        imap: login.clone(),
        smtp: login,
    };
    let repository = Arc::new(MemoryRepository {
        revision: Default::default(),
        scoped_acquire_errors: Default::default(),
        owner_claims: AtomicU32::new(0),
        owner_gate: Default::default(),
        owner_errors: AtomicU32::new(0),
        renewal: Default::default(),
        releases: AtomicU32::new(0),
        acquire_gate: None,
        command_leases: None,
        owner_available: AtomicBool::new(true),
        state: Default::default(),
        saved_unknown: AtomicBool::new(false),
    });
    // The repository and cipher are test adapters; all mailbox commands and
    // headers below cross verified TLS to the real Dovecot lab.
    let engine = Engine::new(
        crate::domain::service::VerificationScopeKey::derive("synthetic-test-auth-key").unwrap(),
        repository.clone(),
        Arc::new(LabCipher(credentials.clone())),
        transport.clone(),
        tokio_util::task::TaskTracker::new(),
        tokio_util::sync::CancellationToken::new(),
    );
    engine.execute(binding, Operation::Sync).await.unwrap();
    let committed = repository.state.lock().unwrap().clone();
    assert!(committed.messages.is_empty());
    assert!(
        repository
            .revision
            .load(std::sync::atomic::Ordering::Acquire)
            > 0
    );
    let mut independent = transport.imap(&credentials.imap).await.unwrap();
    independent.append("INBOX", None, None,
        b"From: sender@example.net\r\nMessage-ID: <idle-gap@example.net>\r\nSubject: Synthetic arm gap\r\n\r\nSynthetic body\r\n")
        .await.unwrap();
    independent.logout().await.unwrap();
    let started = tokio::time::Instant::now();
    let folders = committed.folders.into_values().collect::<Vec<_>>();
    let outcome = tokio::time::timeout(
        Duration::from_secs(2),
        transport.wait_change(&credentials, &folders, 180),
    )
    .await
    .expect("mail already in SELECT must not wait for IDLE")
    .unwrap();
    assert_eq!(outcome, WaitOutcome::Changed);
    engine.execute(binding, Operation::Sync).await.unwrap();
    assert!(started.elapsed() < Duration::from_secs(5));
    assert_eq!(repository.state.lock().unwrap().messages.len(), 1);
    assert_eq!(repository.state.lock().unwrap().locations.len(), 1);
}

#[test]
fn a_derived_gmail_feed_does_not_compare_its_filtered_count_to_all_mail() {
    let mut committed = committed_inbox();
    committed.virtual_label = Some("Project".into());
    committed.folder.total_items = Some(0);
    let mut selected = async_imap::types::Mailbox {
        exists: 1,
        uid_validity: Some(1),
        uid_next: Some(2),
        highest_modseq: Some(1),
        ..Default::default()
    };
    assert!(!crate::outbound::protocol::idle::selected_changed(
        &committed, &selected
    ));
    selected.uid_next = Some(3);
    assert!(crate::outbound::protocol::idle::selected_changed(
        &committed, &selected
    ));
}
