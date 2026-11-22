//! A local TLS peer checks actual reconnect, authentication and submission bytes.
use super::*;
use crate::outbound::network::LocalEndpoints;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio_rustls::rustls::{
    ServerConfig,
    pki_types::{CertificateDer, PrivateKeyDer, pem::PemObject},
};

const MIME: &[u8] = b"From: owner@example.net\r\nSubject: synthetic retry\r\n\r\nbody\r\n.line\r\n";

pub(in crate::outbound::protocol) fn tls_config() -> (Arc<ServerConfig>, String) {
    // Use the dev shell/CI's OpenSSL, without storing a private key in fixtures.
    let directory = std::env::temp_dir().join(format!("smtp-retry-{}", uuid::Uuid::now_v7()));
    std::fs::create_dir(&directory).unwrap();
    let generated = std::process::Command::new("openssl")
        .args([
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-noenc",
            "-days",
            "1",
            "-subj",
            "/CN=smtp.example.net",
            "-addext",
            "subjectAltName=DNS:smtp.example.net",
            "-addext",
            "basicConstraints=critical,CA:FALSE",
            "-addext",
            "extendedKeyUsage=serverAuth",
            "-keyout",
            "key.pem",
            "-out",
            "cert.pem",
        ])
        .current_dir(&directory)
        .output()
        .unwrap();
    assert!(
        generated.status.success(),
        "generate ephemeral test TLS identity"
    );
    let cert = std::fs::read_to_string(directory.join("cert.pem")).unwrap();
    let key = zeroize::Zeroizing::new(std::fs::read(directory.join("key.pem")).unwrap());
    std::fs::remove_dir_all(&directory).unwrap();
    let config = ServerConfig::builder_with_provider(Arc::new(
        tokio_rustls::rustls::crypto::aws_lc_rs::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_no_client_auth()
    .with_single_cert(
        CertificateDer::pem_slice_iter(cert.as_bytes())
            .collect::<Result<Vec<_>, _>>()
            .unwrap(),
        PrivateKeyDer::from_pem_slice(&key).unwrap(),
    )
    .unwrap();
    (Arc::new(config), cert)
}

#[tokio::test]
async fn failed_probes_and_pre_body_eof_reconnect_over_tls_without_changing_the_message() {
    let telemetry = super::telemetry_test::FieldWrites::default();
    let _capture = telemetry.install();
    let (tls, root) = tls_config();
    for failure in [
        "probe-421",
        "probe-550",
        "mail",
        "data-command",
        "refuse-rcpt",
    ] {
        let (mut transport, credentials, peer, listener) =
            super::reuse_test::pooled_connection().await;
        transport.connector = Connector::new(LocalEndpoints {
            addresses: BTreeMap::from([(
                "smtp.example.net:465".into(),
                listener.local_addr().unwrap().to_string(),
            )]),
            trust_root_pem: Some(root.clone()),
        })
        .unwrap();
        let retired = tokio::spawn(async move {
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
                if expected == "RSET\r\n" {
                    if failure == "probe-421" {
                        peer.get_mut().write_all(b"421 closing\r\n").await.unwrap();
                        return;
                    }
                    if failure == "probe-550" {
                        peer.get_mut()
                            .write_all(b"550 unavailable\r\n")
                            .await
                            .unwrap();
                        return;
                    }
                    if failure == "refuse-rcpt" {
                        return;
                    }
                }
                if (failure == "mail" && expected.starts_with("MAIL FROM:"))
                    || (failure == "data-command" && expected == "DATA\r\n")
                {
                    // No 354 was sent, so no body byte can have been submitted.
                    return;
                }
                peer.get_mut().write_all(b"250 ready\r\n").await.unwrap();
            }
            panic!("the old connection must end before message data");
        });
        let acceptor = tokio_rustls::TlsAcceptor::from(tls.clone());
        let fresh = tokio::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            let socket = acceptor.accept(socket).await.unwrap();
            let mut peer = BufReader::new(socket);
            peer.get_mut()
                .write_all(b"220 synthetic peer\r\n")
                .await
                .unwrap();
            let mut command = String::new();
            peer.read_line(&mut command).await.unwrap();
            assert!(command.starts_with("EHLO "));
            peer.get_mut()
                .write_all(b"250-synthetic peer\r\n250 AUTH PLAIN\r\n")
                .await
                .unwrap();
            command.clear();
            peer.read_line(&mut command).await.unwrap();
            assert!(command.starts_with("AUTH PLAIN "));
            command.clear();
            peer.get_mut()
                .write_all(b"235 authenticated\r\n")
                .await
                .unwrap();
            for expected in [
                "MAIL FROM:<owner@example.net>\r\n",
                "RCPT TO:<recipient@example.net>\r\n",
                "DATA\r\n",
            ] {
                command.clear();
                peer.read_line(&mut command).await.unwrap();
                assert_eq!(command, expected);
                if failure == "refuse-rcpt" && expected.starts_with("RCPT TO:") {
                    peer.get_mut().write_all(b"550 refused\r\n").await.unwrap();
                    command.clear();
                    match peer.read_line(&mut command).await {
                        Ok(bytes) => assert_eq!(bytes, 0),
                        Err(error) => assert_eq!(error.kind(), std::io::ErrorKind::UnexpectedEof),
                    }
                    assert!(
                        command.is_empty(),
                        "no cleanup or message data after refusal"
                    );
                    return (peer, String::new());
                }
                let reply: &[u8] = if expected == "DATA\r\n" {
                    b"354 continue\r\n"
                } else {
                    b"250 ready\r\n"
                };
                peer.get_mut().write_all(reply).await.unwrap();
            }
            let mut received = String::new();
            loop {
                let mut line = String::new();
                assert!(peer.read_line(&mut line).await.unwrap() > 0);
                if line == ".\r\n" {
                    break;
                }
                received.push_str(if line.starts_with("..") {
                    &line[1..]
                } else {
                    &line
                });
            }
            peer.get_mut().write_all(b"250 accepted\r\n").await.unwrap();
            (peer, received)
        });
        let result = transport
            .submit_inner(
                &credentials,
                "owner@example.net",
                &["recipient@example.net".into()],
                MIME,
                tokio::time::Instant::now() + SUBMISSION_PRE_BODY_BUDGET,
            )
            .await;
        retired.await.unwrap();
        let (_peer, received) = fresh.await.unwrap();
        if failure == "refuse-rcpt" {
            assert_eq!(result, Err(Error::SendRejected));
            assert!(received.is_empty());
            assert!(transport.smtp_pool.lock().await.is_empty());
        } else {
            assert_eq!(result, Ok(SubmissionOutcome::Accepted));
            assert_eq!(received.as_bytes(), MIME);
            assert_eq!(transport.smtp_pool.lock().await.len(), 1);
        }
    }
    let spans = telemetry.spans();
    assert_eq!(spans.len(), 5);
    for (fields, (attempt, outcome)) in spans.iter().zip([
        ("1", "accepted"),
        ("1", "accepted"),
        ("2", "accepted"),
        ("2", "accepted"),
        ("1", "not_submitted"),
    ]) {
        assert_eq!(fields["smtp.attempt"], [attempt]);
        assert_eq!(fields["smtp.outcome"], [outcome]);
    }
    assert_eq!(telemetry.probe_errors(), [tracing::Level::WARN; 3]);
}

#[tokio::test(start_paused = true)]
async fn the_pre_body_deadline_never_cancels_a_body_already_submitted() {
    let (mut client, peer) = tokio::io::duplex(65536);
    let (data_tx, data_rx) = tokio::sync::oneshot::channel();
    let (continue_tx, continue_rx) = tokio::sync::oneshot::channel();
    let (body_tx, body_rx) = tokio::sync::oneshot::channel();
    let (accepted_tx, accepted_rx) = tokio::sync::oneshot::channel();
    let peer = tokio::spawn(async move {
        let mut peer = BufReader::new(peer);
        for expected in [
            "MAIL FROM:<owner@example.net>\r\n",
            "RCPT TO:<recipient@example.net>\r\n",
        ] {
            let mut command = String::new();
            peer.read_line(&mut command).await.unwrap();
            assert_eq!(command, expected);
            peer.get_mut().write_all(b"250 ready\r\n").await.unwrap();
        }
        let mut command = String::new();
        peer.read_line(&mut command).await.unwrap();
        assert_eq!(command, "DATA\r\n");
        data_tx.send(()).unwrap();
        continue_rx.await.unwrap();
        peer.get_mut().write_all(b"354 continue\r\n").await.unwrap();
        let mut body_bytes = 0;
        loop {
            let mut line = String::new();
            assert!(peer.read_line(&mut line).await.unwrap() > 0);
            if line == ".\r\n" {
                break;
            }
            body_bytes += line.len();
        }
        assert!(body_bytes > 0);
        body_tx.send(()).unwrap();
        accepted_rx.await.unwrap();
        peer.get_mut().write_all(b"250 accepted\r\n").await.unwrap();
    });
    let started = tokio::time::Instant::now();
    let submission = tokio::spawn(async move {
        deliver(
            &mut client,
            &Extensions::default(),
            "owner@example.net",
            &["recipient@example.net".into()],
            std::str::from_utf8(MIME).unwrap(),
            started + SUBMISSION_PRE_BODY_BUDGET,
        )
        .await
    });
    data_rx.await.unwrap();
    tokio::time::advance(Duration::from_secs(45)).await;
    continue_tx.send(()).unwrap();
    body_rx.await.unwrap();
    tokio::time::advance(Duration::from_secs(20)).await;
    accepted_tx.send(()).unwrap();
    assert_eq!(submission.await.unwrap(), Ok(SubmissionOutcome::Accepted));
    assert_eq!(started.elapsed(), Duration::from_secs(65));
    peer.await.unwrap();
}
