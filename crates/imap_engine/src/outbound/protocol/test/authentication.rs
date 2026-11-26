//! Real TLS authentication refusals and retries against an explicitly selected lab.
use super::*;
use tokio::io::{AsyncBufReadExt, BufReader};

#[tokio::test]
async fn mail_servers_can_close_without_answering_logout_and_quit() {
    let (tls, pem) = smtp::retry_test::tls_config();
    let imap = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let smtp = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addresses = BTreeMap::from([
        (
            "smtp.example.net:993".into(),
            imap.local_addr().unwrap().to_string(),
        ),
        (
            "smtp.example.net:465".into(),
            smtp.local_addr().unwrap().to_string(),
        ),
    ]);
    let server = tokio_rustls::TlsAcceptor::from(tls);
    let imap_peer = tokio::spawn({
        let server = server.clone();
        async move {
            let mut stream =
                BufReader::new(server.accept(imap.accept().await.unwrap().0).await.unwrap());
            stream
                .get_mut()
                .write_all(b"* OK synthetic IMAP\r\n")
                .await
                .unwrap();
            loop {
                let mut line = String::new();
                assert!(stream.read_line(&mut line).await.unwrap() > 0);
                let (tag, command) = line.trim_end().split_once(' ').unwrap();
                let verb = command
                    .split_ascii_whitespace()
                    .next()
                    .unwrap()
                    .to_ascii_uppercase();
                match verb.as_str() {
                    "LOGIN" | "ID" => {}
                    "SELECT" => stream
                        .get_mut()
                        .write_all(b"* 0 EXISTS\r\n* OK [UIDVALIDITY 1] synthetic\r\n")
                        .await
                        .unwrap(),
                    "LIST" => stream
                        .get_mut()
                        .write_all(b"* LIST (\\Inbox) \"/\" \"INBOX\"\r\n")
                        .await
                        .unwrap(),
                    "CAPABILITY" => stream
                        .get_mut()
                        .write_all(b"* CAPABILITY IMAP4rev1 IDLE UIDPLUS\r\n")
                        .await
                        .unwrap(),
                    "LOGOUT" => break,
                    _ => panic!("unexpected synthetic IMAP command"),
                }
                stream
                    .get_mut()
                    .write_all(format!("{tag} OK complete\r\n").as_bytes())
                    .await
                    .unwrap();
            }
            stream.get_mut().shutdown().await.unwrap();
        }
    });
    let smtp_peer = tokio::spawn(async move {
        let mut stream =
            BufReader::new(server.accept(smtp.accept().await.unwrap().0).await.unwrap());
        stream
            .get_mut()
            .write_all(b"220 synthetic SMTP\r\n")
            .await
            .unwrap();
        for (command, response) in [
            (
                "EHLO ",
                &b"250-synthetic\r\n250-AUTH PLAIN\r\n250 SIZE 25000000\r\n"[..],
            ),
            ("AUTH PLAIN ", &b"235 authenticated\r\n"[..]),
        ] {
            let mut line = String::new();
            assert!(stream.read_line(&mut line).await.unwrap() > 0);
            assert!(line.starts_with(command));
            stream.get_mut().write_all(response).await.unwrap();
        }
        let mut line = String::new();
        stream.read_line(&mut line).await.unwrap();
        assert_eq!(line, "QUIT\r\n");
        stream.get_mut().shutdown().await.unwrap();
    });
    let transport = ProtocolTransport::new(
        Connector::new(LocalEndpoints {
            addresses,
            trust_root_pem: Some(pem),
        })
        .unwrap(),
    );
    let login = |port| Login {
        endpoint: Endpoint {
            host: "smtp.example.net".into(),
            port,
            tls: TlsMode::Implicit,
            username: "owner@example.net".into(),
        },
        password: Secret("synthetic-password".into()),
    };

    let features = transport
        .verify_features(&Credentials {
            features: None,
            binding: None,
            user_id: "synthetic-owner".into(),
            email: "owner@example.net".into(),
            imap: login(993),
            smtp: login(465),
        })
        .await
        .unwrap()
        .unwrap();
    assert!(features.idle && features.uid_plus);
    assert_eq!(features.send_limit_bytes, Some(25_000_000));
    imap_peer.await.unwrap();
    smtp_peer.await.unwrap();
}

#[tokio::test]
#[ignore = "requires the owned Dovecot lab and explicit IMAP_TEST_ENDPOINT_MAP"]
async fn real_tls_authentication_refusals_allow_a_successful_retry() {
    let addresses: BTreeMap<String, String> = serde_json::from_str(
        &macro_env_var::read_env("IMAP_TEST_ENDPOINT_MAP").expect("explicit local lab endpoints"),
    )
    .unwrap();
    assert!(addresses.contains_key("maillab.example.net:993"));
    assert!(addresses.contains_key("maillab.example.net:465"));
    let ca = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../docker/imap-lab/generated/ca.pem"),
    )
    .unwrap();
    let transport = ProtocolTransport::new(
        Connector::new(LocalEndpoints {
            addresses,
            trust_root_pem: Some(ca),
        })
        .unwrap(),
    );
    let email = format!("auth-retry-{}@example.com", uuid::Uuid::now_v7());
    let login = |port| Login {
        endpoint: Endpoint {
            host: "maillab.example.net".into(),
            port,
            tls: TlsMode::Implicit,
            username: email.clone(),
        },
        password: Secret("pass".into()),
    };
    let credentials = Credentials {
        features: None,
        binding: None,
        user_id: "synthetic-owner".into(),
        email: email.clone(),
        imap: login(993),
        smtp: login(465),
    };

    let mut wrong_imap = credentials.clone();
    wrong_imap.imap.password = Secret("incorrect-test-password".into());
    assert_eq!(
        transport.verify(&wrong_imap).await,
        Err(Error::CredentialsRejected)
    );
    transport.verify(&credentials).await.unwrap();

    let mut wrong_smtp = credentials.clone();
    wrong_smtp.smtp.password = Secret("incorrect-test-password".into());
    assert_eq!(
        transport.verify(&wrong_smtp).await,
        Err(Error::CredentialsRejected)
    );
    transport.verify(&credentials).await.unwrap();
}
