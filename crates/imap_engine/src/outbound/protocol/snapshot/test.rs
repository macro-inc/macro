use super::super::*;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncBufReadExt, BufReader};

struct Peer {
    transport: ProtocolTransport,
    credentials: Credentials,
    requests: tokio::sync::mpsc::UnboundedReceiver<usize>,
    allow_fetch: Arc<tokio::sync::Semaphore>,
    batches: Arc<Mutex<Vec<usize>>>,
    server: tokio::task::JoinHandle<()>,
}

async fn mailbox(count: u32, header_bytes: usize) -> Peer {
    mailbox_with_first_header(count, header_bytes, header_bytes).await
}

async fn mailbox_with_first_header(
    count: u32,
    header_bytes: usize,
    first_header_bytes: usize,
) -> Peer {
    mailbox_with_archive(count, header_bytes, first_header_bytes, false).await
}

async fn mailbox_with_archive(
    count: u32,
    header_bytes: usize,
    first_header_bytes: usize,
    archive: bool,
) -> Peer {
    let (tls, pem) = smtp::retry_test::tls_config();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let allow_fetch = Arc::new(tokio::sync::Semaphore::new(0));
    let gate = allow_fetch.clone();
    let batches = Arc::new(Mutex::new(Vec::new()));
    let observed = batches.clone();
    let (sending, requests) = tokio::sync::mpsc::unbounded_channel();
    let server = tokio::spawn(async move {
        let mut clients = tokio::task::JoinSet::new();
        loop {
            let (socket, _) = listener.accept().await.unwrap();
            socket.set_nodelay(true).unwrap();
            let tls = tls.clone();
            let gate = gate.clone();
            let observed = observed.clone();
            let sending = sending.clone();
            clients.spawn(async move {
                let Ok(mut socket) = tokio_rustls::TlsAcceptor::from(tls).accept(socket).await else {
                    return;
                };
                if socket.write_all(b"* OK synthetic snapshot\r\n").await.is_err() {
                    return;
                }
                let mut socket = BufReader::new(socket);
                let mut selected_count = count;
                loop {
                    let mut line = String::new();
                    if !matches!(socket.read_line(&mut line).await, Ok(n) if n > 0) {
                        return;
                    }
                    let (tag, command) = line.trim_end().split_once(' ').unwrap();
                    let reply = if command.starts_with("CAPABILITY") {
                        b"* CAPABILITY IMAP4rev1\r\n".to_vec()
                    } else if command.starts_with("LIST") {
                        let mut names = b"* LIST (\\HasNoChildren) \"/\" \"INBOX\"\r\n".to_vec();
                        if archive {
                            names.extend_from_slice(b"* LIST (\\Archive) \"/\" \"Archive\"\r\n");
                        }
                        names
                    } else if command.starts_with("STATUS") {
                        let (name, count) = if command.contains("Archive") {
                            ("Archive", 300_000)
                        } else {
                            ("INBOX", count)
                        };
                        format!("* STATUS {name} (MESSAGES {count} UIDNEXT {} UIDVALIDITY 1)\r\n", count + 1).into_bytes()
                    } else if command.starts_with("SELECT") {
                        selected_count = if command.contains("Archive") {
                            300_000
                        } else {
                            count
                        };
                        format!("* {selected_count} EXISTS\r\n* OK [UIDVALIDITY 1] synthetic\r\n* OK [UIDNEXT {}] synthetic\r\n", selected_count + 1).into_bytes()
                    } else if command.starts_with("UID SEARCH") {
                        format!("* SEARCH {}\r\n", (1..=selected_count).map(|uid| uid.to_string()).collect::<Vec<_>>().join(" ")).into_bytes()
                    } else if let Some(fetch) = command.strip_prefix("UID FETCH ") {
                        let sequence = fetch.split_whitespace().next().unwrap();
                        let uids = sequence.split(',').map(|uid| uid.parse::<u32>().unwrap()).collect::<Vec<_>>();
                        observed.lock().unwrap().push(uids.len());
                        let _ = sending.send(uids.len());
                        gate.acquire().await.unwrap().forget();
                        for uid in uids {
                            let mut header = format!("Message-ID: <synthetic-{uid}@example.net>\r\nSubject: ").into_bytes();
                            let bytes = if uid == 1 {
                                first_header_bytes
                            } else {
                                header_bytes
                            };
                            header.resize(bytes.saturating_sub(4).max(header.len()), b'x');
                            header.extend_from_slice(b"\r\n\r\n");
                            let prefix = format!("* {uid} FETCH (UID {uid} FLAGS () INTERNALDATE \"01-Jan-2024 00:00:00 +0000\" RFC822.SIZE {} BODY[HEADER] {{{}}}\r\n", header.len() + 20, header.len());
                            if socket.get_mut().write_all(prefix.as_bytes()).await.is_err()
                                || socket.get_mut().write_all(&header).await.is_err()
                                || socket.get_mut().write_all(b")\r\n").await.is_err() {
                                return;
                            }
                        }
                        Vec::new()
                    } else {
                        Vec::new()
                    };
                    if socket.get_mut().write_all(&reply).await.is_err()
                        || socket.get_mut().write_all(format!("{tag} OK complete\r\n").as_bytes()).await.is_err()
                        || socket.get_mut().flush().await.is_err() {
                                return;
                            }
                }
            });
        }
    });
    let connector = Connector::new(crate::outbound::network::LocalEndpoints {
        addresses: std::collections::BTreeMap::from([(
            "smtp.example.net:993".into(),
            address.to_string(),
        )]),
        trust_root_pem: Some(pem),
    })
    .unwrap();
    let login = Login {
        endpoint: Endpoint {
            host: "smtp.example.net".into(),
            port: 993,
            tls: TlsMode::Implicit,
            username: "synthetic@example.net".into(),
        },
        password: Secret("synthetic-unused-password".into()),
    };
    Peer {
        transport: ProtocolTransport::new(connector),
        credentials: Credentials {
            features: None,
            binding: None,
            user_id: "synthetic".into(),
            email: "synthetic@example.net".into(),
            imap: login.clone(),
            smtp: login,
        },
        requests,
        allow_fetch,
        batches,
        server,
    }
}

#[tokio::test]
async fn a_million_uid_folder_is_refused_before_fetching_any_headers() {
    let Peer {
        transport,
        credentials,
        mut requests,
        server,
        ..
    } = mailbox(1_000_000, 128).await;
    let known = AccountState::default();
    tokio::select! {
        result = transport.snapshot(&credentials, &known) => {
            assert!(matches!(result, Err(Error::SnapshotTooLarge)));
        }
        _ = requests.recv() => panic!("a folder above the UID bound must stop before header I/O"),
    }
    server.abort();
}

#[tokio::test]
async fn twenty_kib_headers_finish_in_byte_sized_batches() {
    let Peer {
        transport,
        credentials,
        allow_fetch,
        batches,
        server,
        ..
    } = mailbox(1000, 20 * 1024).await;
    allow_fetch.add_permits(2000);
    let result = transport
        .snapshot(&credentials, &AccountState::default())
        .await
        .unwrap_or_else(|error| {
            panic!(
                "snapshot failed: {error:?}; requested batch counts: {:?}",
                batches.lock().unwrap()
            )
        });
    assert_eq!(result[0].messages.len(), 1000);
    assert!(batches.lock().unwrap().iter().all(|count| *count < 1000));
    server.abort();
}

#[tokio::test]
async fn retained_header_bytes_across_batches_have_a_typed_total_bound() {
    let Peer {
        transport,
        credentials,
        allow_fetch,
        server,
        ..
    } = mailbox(50, 6 * 1024 * 1024).await;
    allow_fetch.add_permits(1000);
    let result = transport
        .snapshot(&credentials, &AccountState::default())
        .await;
    assert!(matches!(result, Err(Error::SnapshotTooLarge)));
    server.abort();
}

#[tokio::test]
async fn unexpectedly_large_headers_shrink_the_batch_without_resetting_the_sync_budget() {
    let Peer {
        transport,
        credentials,
        allow_fetch,
        batches,
        server,
        ..
    } = mailbox_with_first_header(1001, 40 * 1024, 128).await;
    allow_fetch.add_permits(2000);
    let result = transport
        .snapshot(&credentials, &AccountState::default())
        .await
        .unwrap();
    assert_eq!(result[0].messages.len(), 1001);
    let sizes = batches.lock().unwrap().clone();
    assert!(
        sizes
            .windows(2)
            .any(|pair| pair[0] == 1000 && pair[1] < 1000)
    );
    server.abort();
}

#[tokio::test]
async fn oversized_archive_refuses_the_complete_snapshot_instead_of_publishing_partial_inbox() {
    let Peer {
        transport,
        credentials,
        allow_fetch,
        server,
        ..
    } = mailbox_with_archive(2, 128, 128, true).await;
    allow_fetch.add_permits(100);
    let remote = transport
        .snapshot(&credentials, &AccountState::default())
        .await;
    assert!(matches!(remote, Err(Error::SnapshotTooLarge)));
    server.abort();
}
