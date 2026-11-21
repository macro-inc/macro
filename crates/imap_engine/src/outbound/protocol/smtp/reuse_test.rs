use super::*;
use crate::outbound::network::LocalEndpoints;
use tokio::io::{AsyncBufReadExt, BufReader};

pub(super) async fn pooled_connection() -> (
    ProtocolTransport,
    Credentials,
    tokio::net::TcpStream,
    tokio::net::TcpListener,
) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = Endpoint {
        host: "smtp.example.net".into(),
        port: 465,
        tls: TlsMode::Implicit,
        username: "owner@example.net".into(),
    };
    let connector = Connector::new(LocalEndpoints {
        addresses: BTreeMap::from([(
            "smtp.example.net:465".into(),
            listener.local_addr().unwrap().to_string(),
        )]),
        trust_root_pem: None,
    })
    .unwrap();
    // An already authenticated pooled socket is injected at the IO boundary;
    // this peer checks reuse commands, not TLS or password authentication.
    let stream = connector.tcp(&endpoint).await.unwrap();
    let (peer, _) = listener.accept().await.unwrap();
    let login = Login {
        endpoint,
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
        email: "owner@example.net".into(),
        imap: login.clone(),
        smtp: login,
    };
    let transport = ProtocolTransport::new(connector);
    transport.smtp_pool.lock().await.insert(
        ProtocolTransport::smtp_key(&credentials).unwrap(),
        Pooled {
            stream,
            extensions: Extensions::default(),
            opened: Instant::now(),
            last_used: Instant::now() - Duration::from_secs(31),
            messages: 1,
        },
    );
    (transport, credentials, peer, listener)
}

#[tokio::test(start_paused = true)]
async fn an_expired_admission_budget_never_touches_the_pooled_socket() {
    use tokio::io::AsyncReadExt;

    let (transport, credentials, mut peer, listener) = pooled_connection().await;
    drop(listener);
    assert_eq!(
        transport
            .submit_inner(
                &credentials,
                "owner@example.net",
                &["recipient@example.net".into()],
                b"From: owner@example.net\r\n\r\nbody\r\n",
                tokio::time::Instant::now() - Duration::from_secs(1),
            )
            .await,
        Err(Error::SendUnavailable)
    );
    drop(transport);
    let mut received = Vec::new();
    assert_eq!(peer.read_to_end(&mut received).await.unwrap(), 0);
}

#[tokio::test]
async fn pooled_session_is_checked_before_mail_and_a_real_rcpt_refusal_stays_definite() {
    let (transport, credentials, peer, listener) = pooled_connection().await;
    drop(listener);
    let peer = tokio::spawn(async move {
        let mut peer = BufReader::new(peer);
        let mut commands = Vec::new();
        loop {
            let mut command = String::new();
            if peer.read_line(&mut command).await.unwrap() == 0 {
                return commands;
            }
            commands.push(command.clone());
            let reply: &[u8] =
                if command == "RSET\r\n" || command == "MAIL FROM:<owner@example.net>\r\n" {
                    b"250 ready\r\n"
                } else if command == "RCPT TO:<recipient@example.net>\r\n" {
                    b"550 synthetic refusal\r\n"
                } else {
                    panic!("unexpected command: {command:?}");
                };
            peer.get_mut().write_all(reply).await.unwrap();
        }
    });
    let result = transport
        .submit_inner(
            &credentials,
            "owner@example.net",
            &["recipient@example.net".into()],
            b"From: owner@example.net\r\nTo: recipient@example.net\r\nSubject: synthetic\r\n\r\nbody\r\n",
            tokio::time::Instant::now() + SUBMISSION_PRE_BODY_BUDGET,
        )
        .await;
    assert_eq!(result, Err(Error::SendRejected));
    assert_eq!(
        peer.await.unwrap(),
        [
            "RSET\r\n",
            "MAIL FROM:<owner@example.net>\r\n",
            "RCPT TO:<recipient@example.net>\r\n",
        ]
    );
    assert!(transport.smtp_pool.lock().await.is_empty());
}

#[tokio::test]
async fn closed_pooled_session_is_discarded_before_a_fresh_connection_is_attempted() {
    let (transport, credentials, mut peer, listener) = pooled_connection().await;
    drop(listener);
    peer.shutdown().await.unwrap();
    drop(peer);
    // The fixture listener is gone: a fresh connection must fail, rather than
    // returning the closed socket as if it were ready to carry a submission.
    assert!(matches!(
        transport.take_smtp(&credentials).await,
        Err(Error::TcpUnavailable)
    ));
    assert!(transport.smtp_pool.lock().await.is_empty());
}

#[tokio::test]
async fn an_idle_closed_pool_and_two_failed_fresh_connections_report_no_submission() {
    let (transport, credentials, mut peer, listener) = pooled_connection().await;
    peer.shutdown().await.unwrap();
    drop(peer);
    let fresh = tokio::spawn(async move {
        for _ in 0..2 {
            let (socket, _) = listener.accept().await.unwrap();
            // End each fresh connection before TLS or AUTH completes. Neither
            // connection can carry a MAIL command or any message content.
            drop(socket);
        }
    });
    assert_eq!(
        transport
            .submit_inner(
                &credentials,
                "owner@example.net",
                &["recipient@example.net".into()],
                b"From: owner@example.net\r\nSubject: synthetic\r\n\r\nbody\r\n",
                tokio::time::Instant::now() + SUBMISSION_PRE_BODY_BUDGET,
            )
            .await,
        Err(Error::SendUnavailable)
    );
    fresh.await.unwrap();
    assert!(transport.smtp_pool.lock().await.is_empty());
}

#[tokio::test]
async fn a_lost_reply_after_data_never_opens_a_fresh_connection() {
    let (transport, credentials, peer, listener) = pooled_connection().await;
    let stop = tokio_util::sync::CancellationToken::new();
    let done = stop.clone();
    let peer = tokio::spawn(async move {
        let mut peer = BufReader::new(peer);
        for expected in [
            "RSET\r\n",
            "MAIL FROM:<owner@example.net>\r\n",
            "RCPT TO:<recipient@example.net>\r\n",
            "DATA\r\n",
        ] {
            let mut command = String::new();
            peer.read_line(&mut command).await.unwrap();
            assert_eq!(command, expected);
            let reply: &[u8] = if expected == "DATA\r\n" {
                b"354 send content\r\n"
            } else {
                b"250 ready\r\n"
            };
            peer.get_mut().write_all(reply).await.unwrap();
        }
        let mut body_lines = 0;
        loop {
            let mut body = String::new();
            assert!(peer.read_line(&mut body).await.unwrap() > 0);
            if body == ".\r\n" {
                break;
            }
            body_lines += 1;
        }
        assert!(body_lines > 0);
        drop(peer);
        let mut reconnects = 0;
        loop {
            tokio::select! {
                _ = done.cancelled() => return reconnects,
                incoming = listener.accept() => {
                    drop(incoming.unwrap());
                    reconnects += 1;
                }
            }
        }
    });
    assert_eq!(
        transport
            .submit_inner(
                &credentials,
                "owner@example.net",
                &["recipient@example.net".into()],
                b"From: owner@example.net\r\nSubject: synthetic\r\n\r\nbody\r\n",
                tokio::time::Instant::now() + SUBMISSION_PRE_BODY_BUDGET,
            )
            .await,
        Ok(SubmissionOutcome::Unknown)
    );
    stop.cancel();
    assert_eq!(peer.await.unwrap(), 0);
    assert!(transport.smtp_pool.lock().await.is_empty());
}

#[tokio::test(start_paused = true)]
async fn stalled_envelopes_share_one_budget_and_do_not_start_a_short_retry() {
    for first_failure_after in [None, Some(Duration::from_secs(40))] {
        let (transport, credentials, peer, listener) = pooled_connection().await;
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
        let (close_tx, close_rx) = tokio::sync::oneshot::channel();
        let stop = tokio_util::sync::CancellationToken::new();
        let done = stop.clone();
        let peer = tokio::spawn(async move {
            let mut peer = BufReader::new(peer);
            let mut command = String::new();
            peer.read_line(&mut command).await.unwrap();
            assert_eq!(command, "RSET\r\n");
            peer.get_mut().write_all(b"250 ready\r\n").await.unwrap();
            command.clear();
            peer.read_line(&mut command).await.unwrap();
            assert_eq!(command, "MAIL FROM:<owner@example.net>\r\n");
            ready_tx.send(()).unwrap();
            close_rx.await.unwrap();
            drop(peer);
        });
        let fresh = tokio::spawn(async move {
            let mut connections = Vec::new();
            loop {
                tokio::select! {
                    _ = done.cancelled() => return connections.len(),
                    socket = listener.accept() => connections.push(socket.unwrap().0),
                }
            }
        });
        let started = tokio::time::Instant::now();
        let submission = tokio::spawn(async move {
            transport
                .submit_inner(
                    &credentials,
                    "owner@example.net",
                    &["recipient@example.net".into()],
                    b"From: owner@example.net\r\nSubject: synthetic\r\n\r\nbody\r\n",
                    tokio::time::Instant::now() + SUBMISSION_PRE_BODY_BUDGET,
                )
                .await
        });
        ready_rx.await.unwrap();
        if let Some(delay) = first_failure_after {
            tokio::time::advance(delay).await;
            close_tx.send(()).unwrap();
        } else {
            // Leave MAIL unanswered until the whole submission budget expires.
            tokio::time::advance(Duration::from_secs(60)).await;
            close_tx.send(()).unwrap();
        }
        assert_eq!(submission.await.unwrap(), Err(Error::SendUnavailable));
        let elapsed = started.elapsed();
        stop.cancel();
        peer.await.unwrap();
        let fresh_connections = fresh.await.unwrap();
        assert!(
            elapsed <= Duration::from_secs(60),
            "pre-body submission took {elapsed:?}"
        );
        assert_eq!(
            fresh_connections, 0,
            "do not open a fresh connection with less than 30s left"
        );
    }
}
