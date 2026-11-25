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
    assert_eq!(
        result,
        Ok(SubmissionOutcome::Rejected {
            refusal: SubmissionRefusal {
                phase: SubmissionRefusalPhase::Recipient,
                recipient_index: Some(0),
                reply_class: Some(SubmissionRefusalClass::Permanent)
            }
        })
    );
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
    peer.shutdown().await.unwrap();
    drop(peer);
    // Keep the ephemeral port reserved: another parallel fixture could reuse
    // it after a dropped listener. Accepting proves a fresh dial occurred;
    // closing that socket makes its TLS handshake fail deterministically.
    let fresh = tokio::spawn(async move {
        let (socket, _) = listener.accept().await.unwrap();
        drop(socket);
    });
    assert_eq!(
        transport.take_smtp(&credentials).await.err(),
        Some(Error::TlsUnavailable)
    );
    fresh.await.unwrap();
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

#[sqlx::test(migrations = false)]
async fn reconnect_during_smtp_data_preserves_unknown_without_a_second_delivery(
    pool: sqlx::PgPool,
) {
    use crate::{
        domain::service::{Engine, VerificationScopeKey, test::TestCipher},
        outbound::postgres::{PgRepository, test::schema},
    };
    use std::sync::Arc;

    schema(&pool).await;
    let (transport, credentials, socket, listener) = pooled_connection().await;
    let old = credentials.binding.unwrap();
    let next = Binding {
        sync_generation: old.sync_generation + 1,
        grant_generation: old.grant_generation + 1,
        ..old
    };
    let other = uuid::Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO email_links (id, macro_id, provider)
        VALUES
            ($1, 'macro|owner@example.net', 'IMAP'),
            ($2, 'macro|other@example.net', 'GMAIL')
        "#,
        old.link_id,
        other,
    )
    .execute(&pool)
    .await
    .unwrap();
    let repository = Arc::new(PgRepository::new(pool.clone()));
    async fn promote(repository: &PgRepository, binding: Binding) {
        let id = uuid::Uuid::now_v7();
        let owner = "macro|owner@example.net";
        repository
            .put_verification(VerifiedAccount {
                verification: Verification {
                    id,
                    expires_at: Utc::now() + chrono::Duration::minutes(15),
                },
                user_id: owner.into(),
                ciphertext: vec![1],
                consumed_by: None,
            })
            .await
            .unwrap();
        repository
            .connect(binding, owner, vec![1], id)
            .await
            .unwrap();
    }
    promote(&repository, old).await;

    let engine = Arc::new(Engine::new(
        VerificationScopeKey::derive("synthetic-test-auth-key").unwrap(),
        repository.clone(),
        Arc::new(TestCipher),
        Arc::new(transport),
        tokio_util::task::TaskTracker::new(),
        tokio_util::sync::CancellationToken::new(),
    ));
    let draft: Draft = serde_json::from_value(
        engine
            .execute(
                old,
                Operation::CreateDraft {
                    input: DraftInput {
                        correlation: uuid::Uuid::now_v7(),
                        revision: 1,
                        reply_to: None,
                        content: serde_json::json!({
                            "message_id": "reconnect@example.net",
                            "message": {
                                "link_id": old.link_id, "subject": "Synthetic reconnect",
                                "to": [{"email": "recipient@example.net"}],
                                "body_text": "Synthetic body",
                            },
                            "from": {"email": "owner@example.net"},
                        }),
                    },
                },
            )
            .await
            .unwrap(),
    )
    .unwrap();

    let (data_received, data) = tokio::sync::oneshot::channel();
    let (disconnect, disconnected) = tokio::sync::oneshot::channel();
    let peer = tokio::spawn(async move {
        let mut peer = BufReader::new(socket);
        for expected in [
            "RSET\r\n",
            "MAIL FROM:<owner@example.net>\r\n",
            "RCPT TO:<recipient@example.net>\r\n",
            "DATA\r\n",
        ] {
            let mut command = String::new();
            assert!(peer.read_line(&mut command).await.unwrap() > 0);
            assert_eq!(command, expected);
            let reply: &[u8] = if expected == "DATA\r\n" {
                b"354 continue\r\n"
            } else {
                b"250 ready\r\n"
            };
            peer.get_mut().write_all(reply).await.unwrap();
        }
        let mut mime = String::new();
        loop {
            let mut line = String::new();
            assert!(peer.read_line(&mut line).await.unwrap() > 0);
            if line == ".\r\n" {
                break;
            }
            mime.push_str(&line);
        }
        assert!(mime.contains("Synthetic body"));
        data_received.send(()).unwrap();
        // Losing the final SMTP response leaves delivery ambiguous.
        disconnected.await.unwrap();
    });
    let initial = tokio::spawn({
        let engine = engine.clone();
        let id = draft.id.clone();
        async move { engine.execute(old, Operation::Submit { id }).await }
    });
    timeout(Duration::from_secs(10), data)
        .await
        .unwrap()
        .unwrap();

    promote(&repository, next).await;
    sqlx::query!(
        r#"
        UPDATE
            email_links
        SET
            sync_generation = 2,
            grant_generation = 2
        WHERE
            id = $1
        "#,
        old.link_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    let retry = engine.execute(next, Operation::Submit { id: draft.id });
    let reply = timeout(Duration::from_secs(10), async {
        tokio::select! {
            biased;
            accepted = listener.accept() => panic!("an SMTP reconnect attempted a second delivery: {accepted:?}"),
            reply = retry => reply,
        }
    })
    .await
    .unwrap()
    .unwrap();
    assert_eq!(
        serde_json::from_value::<SubmissionOutcome>(reply).unwrap(),
        SubmissionOutcome::Unknown,
    );
    disconnect.send(()).unwrap();
    peer.await.unwrap();
    // An old worker cannot persist a result after its generation is replaced.
    assert_eq!(initial.await.unwrap(), Err(Error::Conflict));
}
