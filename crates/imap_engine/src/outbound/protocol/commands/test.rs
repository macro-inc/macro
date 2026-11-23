//! Synthetic TLS IMAP peers exercise real command-session admission and reuse.
use super::*;
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicUsize, Ordering},
};
use tokio::io::{AsyncBufReadExt, BufReader};

struct Peer {
    transport: Arc<ProtocolTransport>,
    credentials: Credentials,
    connections: tokio::sync::mpsc::UnboundedReceiver<()>,
    fetches: tokio::sync::mpsc::UnboundedReceiver<()>,
    idles: tokio::sync::mpsc::UnboundedReceiver<()>,
    release: Arc<tokio::sync::Semaphore>,
    maximum: Arc<AtomicUsize>,
    stores: Arc<AtomicUsize>,
    close_after_store: Arc<AtomicBool>,
    server: tokio::task::JoinHandle<()>,
}

async fn peer() -> Peer {
    peer_with_source(b"Message-ID: <synthetic@example.net>\r\n\r\nTest body\r\n".to_vec()).await
}

async fn peer_with_source(source: Vec<u8>) -> Peer {
    let source = Arc::new(source);
    let (tls, pem) = smtp::retry_test::tls_config();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (accepted, connections) = tokio::sync::mpsc::unbounded_channel();
    let (fetching, fetches) = tokio::sync::mpsc::unbounded_channel();
    let (idling, idles) = tokio::sync::mpsc::unbounded_channel();
    let release = Arc::new(tokio::sync::Semaphore::new(0));
    let active = Arc::new(AtomicUsize::new(0));
    let maximum = Arc::new(AtomicUsize::new(0));
    let peak = maximum.clone();
    let seen = Arc::new(AtomicBool::new(false));
    let stores = Arc::new(AtomicUsize::new(0));
    let stored = stores.clone();
    let close_after_store = Arc::new(AtomicBool::new(false));
    let closing = close_after_store.clone();
    let gate = release.clone();
    let server = tokio::spawn(async move {
        let mut peers = tokio::task::JoinSet::new();
        loop {
            let (socket, _) = listener.accept().await.unwrap();
            let count = active.fetch_add(1, Ordering::SeqCst) + 1;
            peak.fetch_max(count, Ordering::SeqCst);
            let _ = accepted.send(());
            let tls = tls.clone();
            let active = active.clone();
            let gate = gate.clone();
            let fetching = fetching.clone();
            let idling = idling.clone();
            let seen = seen.clone();
            let stored = stored.clone();
            let closing = closing.clone();
            let source = source.clone();
            peers.spawn(async move {
                let mut socket = tokio_rustls::TlsAcceptor::from(tls).accept(socket).await.unwrap();
                socket.write_all(b"* OK synthetic IMAP\r\n").await.unwrap();
                socket.flush().await.unwrap();
                let mut socket = BufReader::new(socket);
                loop {
                    let mut request = String::new();
                    let Ok(received) = socket.read_line(&mut request).await else {
                        break;
                    };
                    if received == 0 {
                        break;
                    }
                    let (tag, command) = request.trim_end().split_once(' ').unwrap();
                    if command == "IDLE" {
                        socket.get_mut().write_all(b"+ idling\r\n").await.unwrap();
                        socket.get_mut().flush().await.unwrap();
                        let _ = idling.send(());
                        let mut done = String::new();
                        let Ok(received) = socket.read_line(&mut done).await else {
                            break;
                        };
                        if received == 0 {
                        break;
                    }
                        assert_eq!(done, "DONE\r\n");
                    } else if command.starts_with("CAPABILITY") {
                        socket.get_mut().write_all(b"* CAPABILITY IMAP4rev1 IDLE\r\n").await.unwrap();
                    } else if command.starts_with("SELECT") {
                        socket.get_mut().write_all(b"* FLAGS (\\Seen)\r\n* 1 EXISTS\r\n* OK [UIDVALIDITY 1] synthetic\r\n").await.unwrap();
                    } else if command.starts_with("UID STORE") {
                        stored.fetch_add(1, Ordering::SeqCst);
                        seen.store(true, Ordering::SeqCst);
                        if closing.load(Ordering::SeqCst) { break; }
                    } else if command.starts_with("UID FETCH") {
                        let header_only = command.contains("HEADER");
                        let body: &[u8] = if header_only {
                            b"Message-ID: <synthetic@example.net>\r\nSubject: Synthetic\r\n\r\n"
                        } else {
                            let _ = fetching.send(());
                            gate.acquire().await.unwrap().forget();
                            source.as_slice()
                        };
                        let section = if header_only { "HEADER" } else { "" };
                        let flags = if seen.load(Ordering::SeqCst) { "\\Seen" } else { "" };
                        socket.get_mut().write_all(format!("* 1 FETCH (UID 1 FLAGS ({flags}) RFC822.SIZE {} BODY[{section}] {{{}}}\r\n", body.len(), body.len()).as_bytes()).await.unwrap();
                        socket.get_mut().write_all(body).await.unwrap();
                        socket.get_mut().write_all(b")\r\n").await.unwrap();
                    }
                    socket.get_mut().write_all(format!("{tag} OK complete\r\n").as_bytes()).await.unwrap();
                    // TLS write_all can leave ciphertext buffered under
                    // backpressure. Deliver the reply before awaiting input.
                    socket.get_mut().flush().await.unwrap();
                }
                active.fetch_sub(1, Ordering::SeqCst);
            });
        }
    });
    let connector = Connector::new(crate::outbound::network::LocalEndpoints {
        addresses: BTreeMap::from([("smtp.example.net:993".into(), address.to_string())]),
        trust_root_pem: Some(pem),
    })
    .unwrap();
    let transport = Arc::new(ProtocolTransport::new(connector));
    let login = Login {
        endpoint: Endpoint {
            host: "smtp.example.net".into(),
            port: 993,
            tls: TlsMode::Implicit,
            username: "synthetic@example.net".into(),
        },
        password: Secret("synthetic-unused-password".into()),
    };
    let credentials = Credentials {
        features: None,
        binding: Some(Binding {
            link_id: uuid::Uuid::now_v7(),
            sync_generation: 1,
            grant_generation: 1,
        }),
        user_id: "synthetic-owner".into(),
        email: "synthetic@example.net".into(),
        imap: login.clone(),
        smtp: login,
    };
    Peer {
        transport,
        credentials,
        connections,
        fetches,
        idles,
        release,
        maximum,
        stores,
        close_after_store,
        server,
    }
}

#[tokio::test]
async fn concurrent_body_reads_keep_three_command_sessions_and_leave_sync_independent() {
    let Peer {
        transport,
        credentials,
        mut connections,
        mut fetches,
        release,
        maximum,
        server,
        ..
    } = peer().await;
    let mut reads = tokio::task::JoinSet::new();
    for _ in 0..8 {
        let transport = transport.clone();
        let credentials = credentials.clone();
        reads.spawn(async move { transport.source(&credentials, "INBOX", 1, 1).await });
    }
    for _ in 0..3 {
        connections.recv().await.unwrap();
        fetches.recv().await.unwrap();
    }
    assert!(
        tokio::time::timeout(Duration::from_millis(500), connections.recv())
            .await
            .is_err(),
        "a fourth command socket must wait for an account permit"
    );
    let mut shared_mailbox = credentials.clone();
    shared_mailbox.binding.as_mut().unwrap().link_id = uuid::Uuid::now_v7();
    assert!(matches!(
        transport.source(&shared_mailbox, "INBOX", 1, 1).await,
        Err(Error::AccountBusy)
    ));
    // The account actor's independent sync socket does not wait on read slots.
    let sync = transport.imap(&credentials.imap).await.unwrap();
    connections.recv().await.unwrap();
    release.add_permits(8);
    let mut accepted = 0;
    let mut throttled = 0;
    while let Some(result) = reads.join_next().await {
        match result.unwrap() {
            Ok(body) => {
                assert!(body.ends_with(b"Test body\r\n"));
                accepted += 1;
            }
            Err(Error::AccountBusy) => throttled += 1,
            Err(error) => panic!("unexpected read outcome: {error}"),
        }
    }
    assert_eq!(accepted, 3);
    assert_eq!(throttled, 5);
    // Busy results are retryable once the in-flight reads have returned.
    release.add_permits(5);
    for _ in 0..5 {
        assert!(
            transport
                .source(&credentials, "INBOX", 1, 1)
                .await
                .unwrap()
                .ends_with(b"Test body\r\n")
        );
    }
    assert!(maximum.load(Ordering::SeqCst) <= 4);
    drop(sync);
    transport.evict_commands(credentials.binding.unwrap()).await;
    server.abort();
    let _ = server.await;
}
struct PeerCipher;
#[async_trait::async_trait]
impl CredentialCipher for PeerCipher {
    async fn encrypt(&self, _: uuid::Uuid, _: &str, _: &Credentials) -> Result<Vec<u8>, Error> {
        Err(Error::Invalid)
    }
    async fn decrypt(
        &self,
        id: uuid::Uuid,
        owner: &str,
        value: &[u8],
    ) -> Result<Credentials, Error> {
        let mut credentials = crate::domain::service::test::TestCipher
            .decrypt(id, owner, value)
            .await?;
        credentials.imap.endpoint.host = "smtp.example.net".into();
        credentials.imap.endpoint.username = format!("{id}@example.net");
        Ok(credentials)
    }
}

fn indexed_engine(transport: Arc<ProtocolTransport>) -> Arc<crate::domain::service::Engine> {
    use crate::domain::service::test::MemoryRepository;
    use std::sync::atomic::{AtomicBool, AtomicU32};
    let mut state = AccountState::default();
    state.folders.insert(
        "inbox".into(),
        FolderState {
            monitored: true,
            virtual_label: None,
            uid_next: None,
            phantom: None,
            detected_role: None,
            folder: Folder {
                sync_enabled: true,
                id: "inbox".into(),
                parent_id: None,
                name: "INBOX".into(),
                role: FolderRole::Inbox,
                has_children: false,
                total_items: Some(1),
            },
            path: "INBOX".into(),
            uid_validity: 1,
            highest_modseq: None,
            sync_tier: None,
            sequence: 0,
            journal: Vec::new(),
        },
    );
    state.messages.insert(
        "m:one".into(),
        Message {
            id: "m:one".into(),
            thread_id: "t:one".into(),
            folder_id: "inbox".into(),
            flags: Vec::new(),
            tags: Vec::new(),
            version: "v1".into(),
            mime_base64: String::new(),
            source_complete: false,
            classification: None,
            received_at: Utc::now(),
            size: 64,
            is_sent: false,
            draft_correlation: None,
        },
    );
    state.locations.push(Location {
        folder_id: "inbox".into(),
        uid_validity: 1,
        uid: 1,
        message_id: "m:one".into(),
        fingerprint: "synthetic".into(),
    });
    let repository = Arc::new(MemoryRepository {
        revision: Default::default(),
        scoped_acquire_errors: Default::default(),
        state: std::sync::Mutex::new(state),
        saved_unknown: AtomicBool::new(false),
        command_leases: None,
        owner_available: AtomicBool::new(true),
        owner_claims: AtomicU32::new(0),
        owner_errors: AtomicU32::new(0),
        renewal: Default::default(),
        releases: AtomicU32::new(0),
        owner_gate: std::sync::Mutex::new(None),
        acquire_gate: None,
    });
    Arc::new(crate::domain::service::Engine::new(
        crate::domain::service::VerificationScopeKey::derive("synthetic-test-auth-key").unwrap(),
        repository,
        Arc::new(PeerCipher),
        transport,
        tokio_util::task::TaskTracker::new(),
        tokio_util::sync::CancellationToken::new(),
    ))
}

#[tokio::test]
async fn one_stalled_mailbox_cannot_fill_global_interactive_slots_with_waiters() {
    let Peer {
        transport,
        mut fetches,
        release,
        server,
        ..
    } = peer().await;
    let engine = indexed_engine(transport);
    let binding = Binding {
        link_id: uuid::Uuid::now_v7(),
        sync_generation: 1,
        grant_generation: 1,
    };
    let (entered, mut entries) = tokio::sync::mpsc::unbounded_channel();
    let mut reads = tokio::task::JoinSet::new();
    for _ in 0..16 {
        let engine = engine.clone();
        let entered = entered.clone();
        reads.spawn(async move {
            let mut reading =
                Box::pin(engine.execute(binding, Operation::Message { id: "m:one".into() }));
            let initial = futures::poll!(reading.as_mut());
            entered.send(()).unwrap();
            match initial {
                std::task::Poll::Ready(result) => result,
                std::task::Poll::Pending => reading.await,
            }
        });
    }
    for _ in 0..16 {
        entries.recv().await.unwrap();
    }
    for _ in 0..3 {
        fetches.recv().await.unwrap();
    }
    let other = Binding {
        link_id: uuid::Uuid::now_v7(),
        ..binding
    };
    let mut lookup = Box::pin(engine.execute(
        other,
        Operation::Organization {
            id: "missing".into(),
        },
    ));
    assert!(
        matches!(futures::poll!(lookup.as_mut()), std::task::Poll::Ready(Ok(value)) if value.is_null()),
        "another account must not wait behind the stalled mailbox"
    );
    // Keep the provider blocked until all quota waiters have exhausted their
    // one bounded retry. None may hold a global slot during that delay.
    for _ in 0..13 {
        assert!(matches!(
            reads.join_next().await.unwrap().unwrap(),
            Err(Error::AccountBusy)
        ));
    }
    release.add_permits(3);
    for _ in 0..3 {
        assert!(reads.join_next().await.unwrap().unwrap().is_ok());
    }
    assert!(reads.join_next().await.is_none());
    server.abort();
    let _ = server.await;
}

#[tokio::test]
async fn idle_start_and_sent_recovery_do_not_wait_behind_body_reads() {
    let Peer {
        transport,
        credentials,
        mut fetches,
        mut idles,
        release,
        server,
        ..
    } = peer().await;
    let mut reads = tokio::task::JoinSet::new();
    for _ in 0..3 {
        let transport = transport.clone();
        let credentials = credentials.clone();
        reads.spawn(async move { transport.source(&credentials, "INBOX", 1, 1).await });
    }
    for _ in 0..3 {
        fetches.recv().await.unwrap();
    }
    let sent = tokio::time::timeout(
        Duration::from_secs(2),
        transport.save_sent_inner(&credentials, "<synthetic@example.net>", &[], false),
    )
    .await;
    assert!(
        matches!(sent, Ok(Ok(false))),
        "Sent lookup must run independently of body-read permits"
    );
    let idle_transport = transport.clone();
    let idle_credentials = credentials.clone();
    let idle = tokio::spawn(async move {
        let mut committed = crate::outbound::protocol::test::committed_inbox();
        committed.uid_next = None;
        committed.highest_modseq = None;
        idle_transport
            .wait_change(&idle_credentials, &[committed], 10)
            .await
    });
    tokio::time::timeout(Duration::from_secs(2), idles.recv())
        .await
        .expect("IDLE must start while body reads are stalled")
        .unwrap();
    release.add_permits(3);
    while let Some(result) = reads.join_next().await {
        assert!(result.unwrap().is_ok());
    }
    idle.abort();
    let _ = idle.await;
    server.abort();
    let _ = server.await;
}

#[tokio::test]
async fn a_fourth_user_read_retries_after_capacity_returns_without_holding_a_global_slot() {
    let Peer {
        transport,
        mut fetches,
        release,
        server,
        ..
    } = peer().await;
    let engine = indexed_engine(transport);
    let binding = Binding {
        link_id: uuid::Uuid::now_v7(),
        sync_generation: 1,
        grant_generation: 1,
    };
    let mut reads = tokio::task::JoinSet::new();
    for _ in 0..3 {
        let engine = engine.clone();
        reads.spawn(async move {
            engine
                .execute(binding, Operation::Message { id: "m:one".into() })
                .await
        });
    }
    for _ in 0..3 {
        fetches.recv().await.unwrap();
    }
    let mut fourth = Box::pin(engine.execute(binding, Operation::Message { id: "m:one".into() }));
    assert!(
        futures::poll!(fourth.as_mut()).is_pending(),
        "a brief busy read gets a bounded retry before a user error"
    );
    let other = Binding {
        link_id: uuid::Uuid::now_v7(),
        ..binding
    };
    let mut lookup = Box::pin(engine.execute(
        other,
        Operation::Organization {
            id: "missing".into(),
        },
    ));
    assert!(
        matches!(futures::poll!(lookup.as_mut()), std::task::Poll::Ready(Ok(value)) if value.is_null())
    );
    release.add_permits(4);
    while let Some(result) = reads.join_next().await {
        assert!(result.unwrap().is_ok());
    }
    let message: Message = serde_json::from_value(fourth.await.unwrap()).unwrap();
    assert!(message.source_complete);
    server.abort();
    let _ = server.await;
}

#[tokio::test]
async fn marking_read_after_opening_a_thread_retries_before_any_provider_write() {
    let Peer {
        transport,
        mut fetches,
        release,
        stores,
        server,
        ..
    } = peer().await;
    let engine = indexed_engine(transport);
    let binding = Binding {
        link_id: uuid::Uuid::now_v7(),
        sync_generation: 1,
        grant_generation: 1,
    };
    let mut reads = tokio::task::JoinSet::new();
    for _ in 0..3 {
        let engine = engine.clone();
        reads.spawn(async move {
            engine
                .execute(binding, Operation::Message { id: "m:one".into() })
                .await
        });
    }
    for _ in 0..3 {
        fetches.recv().await.unwrap();
    }
    let mut marking = Box::pin(engine.execute(
        binding,
        Operation::Apply {
            id: "m:one".into(),
            request: ActionRequest {
                action: serde_json::json!({"action":"set_read","value":true}),
                expected_version: None,
            },
        },
    ));
    assert!(
        futures::poll!(marking.as_mut()).is_pending(),
        "a busy pre-write lookup must get a bounded retry"
    );
    assert_eq!(stores.load(Ordering::SeqCst), 0);
    release.add_permits(3);
    while let Some(result) = reads.join_next().await {
        assert!(result.unwrap().is_ok());
    }
    let receipt: WriteReceipt = serde_json::from_value(marking.await.unwrap()).unwrap();
    assert_eq!(receipt.id, "m:one");
    assert_eq!(stores.load(Ordering::SeqCst), 1);
    let message: Message = serde_json::from_value(
        engine
            .execute(binding, Operation::Organization { id: "m:one".into() })
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(message.flags.iter().any(|flag| flag == "\\Seen"));
    server.abort();
    let _ = server.await;
}

#[tokio::test]
async fn apply_admission_is_retryable_but_a_lost_store_reply_is_uncertain() {
    let Peer {
        transport,
        credentials,
        stores,
        close_after_store,
        server,
        ..
    } = peer().await;
    let mut held = Vec::new();
    for _ in 0..3 {
        held.push(transport.command_session(&credentials).await.unwrap());
    }
    let action = || RemoteAction::Flag {
        flag: "\\Seen".into(),
        enabled: true,
    };
    assert!(matches!(
        transport.apply(&credentials, "INBOX", 1, 1, action()).await,
        Err(ApplyError::NotStarted(Error::AccountBusy))
    ));
    assert_eq!(stores.load(Ordering::SeqCst), 0);
    drop(held);
    close_after_store.store(true, Ordering::SeqCst);
    assert!(matches!(
        transport.apply(&credentials, "INBOX", 1, 1, action()).await,
        Err(ApplyError::Uncertain(Error::ConnectionUnavailable))
    ));
    assert_eq!(stores.load(Ordering::SeqCst), 1);
    server.abort();
}

#[tokio::test]
async fn a_pooled_connection_can_read_more_than_512_mib_across_bounded_commands() {
    let Peer {
        transport,
        credentials,
        release,
        maximum,
        server,
        ..
    } = peer_with_source(vec![b'x'; 20 * 1024 * 1024]).await;
    release.add_permits(30);
    for _ in 0..30 {
        let source = transport.source(&credentials, "INBOX", 1, 1).await.unwrap();
        assert_eq!(source.len(), 20 * 1024 * 1024);
    }
    assert_eq!(maximum.load(Ordering::SeqCst), 1);
    server.abort();
}
