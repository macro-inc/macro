//! Synthetic TLS IMAP peers exercise real command-session admission and reuse.
use super::*;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use tokio::io::{AsyncBufReadExt, BufReader};

#[tokio::test]
async fn concurrent_body_reads_keep_three_command_sessions_and_leave_sync_independent() {
    let (tls, pem) = smtp::retry_test::tls_config();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (accepted, mut connections) = tokio::sync::mpsc::unbounded_channel();
    let (fetching, mut fetches) = tokio::sync::mpsc::unbounded_channel();
    let release = Arc::new(tokio::sync::Semaphore::new(0));
    let active = Arc::new(AtomicUsize::new(0));
    let maximum = Arc::new(AtomicUsize::new(0));
    let peak = maximum.clone();
    let gate = release.clone();
    let server = tokio::spawn(async move {
        let mut peers = tokio::task::JoinSet::new();
        loop {
            let (socket, _) = listener.accept().await.unwrap();
            let count = active.fetch_add(1, Ordering::SeqCst) + 1;
            peak.fetch_max(count, Ordering::SeqCst);
            accepted.send(()).unwrap();
            let tls = tls.clone();
            let active = active.clone();
            let gate = gate.clone();
            let fetching = fetching.clone();
            peers.spawn(async move {
                let mut socket = tokio_rustls::TlsAcceptor::from(tls).accept(socket).await.unwrap();
                socket.write_all(b"* OK synthetic IMAP\r\n").await.unwrap();
                let mut socket = BufReader::new(socket);
                loop {
                    let mut request = String::new();
                    let Ok(received) = socket.read_line(&mut request).await else { break; };
                    if received == 0 { break; }
                    let (tag, command) = request.trim_end().split_once(' ').unwrap();
                    if command.starts_with("CAPABILITY") {
                        socket.get_mut().write_all(b"* CAPABILITY IMAP4rev1\r\n").await.unwrap();
                    } else if command.starts_with("SELECT") {
                        socket.get_mut().write_all(b"* FLAGS (\\Seen)\r\n* 1 EXISTS\r\n* OK [UIDVALIDITY 1] synthetic\r\n").await.unwrap();
                    } else if command.starts_with("UID FETCH") {
                        fetching.send(()).unwrap();
                        gate.acquire().await.unwrap().forget();
                        let body = b"Message-ID: <synthetic@example.net>\r\n\r\nTest body\r\n";
                        socket.get_mut().write_all(format!("* 1 FETCH (UID 1 RFC822.SIZE {} BODY[] {{{}}}\r\n",body.len(),body.len()).as_bytes()).await.unwrap();
                        socket.get_mut().write_all(body).await.unwrap();
                        socket.get_mut().write_all(b")\r\n").await.unwrap();
                    }
                    socket.get_mut().write_all(format!("{tag} OK complete\r\n").as_bytes()).await.unwrap();
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
    // The account actor's independent sync socket does not wait on read slots.
    let sync = transport.imap(&credentials.imap).await.unwrap();
    connections.recv().await.unwrap();
    release.add_permits(8);
    while let Some(result) = reads.join_next().await {
        assert!(result.unwrap().unwrap().ends_with(b"Test body\r\n"));
    }
    assert!(maximum.load(Ordering::SeqCst) <= 4);
    drop(sync);
    transport.evict_commands(credentials.binding.unwrap()).await;
    server.abort();
    let _ = server.await;
}
