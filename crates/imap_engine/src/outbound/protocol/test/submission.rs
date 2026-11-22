//! Read-only Sent evidence uses exact headers and never manufactures a copy.
use super::*;

#[tokio::test]
#[ignore = "requires docker/imap-lab generated trust root"]
async fn real_tls_missing_sent_folder_cannot_prove_delivery() {
    use std::sync::Arc;
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio_rustls::rustls::pki_types::{CertificateDer, PrivateKeyDer, pem::PemObject};

    let generated =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../docker/imap-lab/generated");
    let cert = std::fs::read(generated.join("server.pem")).unwrap();
    let key = std::fs::read(generated.join("server.key")).unwrap();
    let config = tokio_rustls::rustls::ServerConfig::builder_with_provider(Arc::new(
        tokio_rustls::rustls::crypto::aws_lc_rs::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_no_client_auth()
    .with_single_cert(
        CertificateDer::pem_slice_iter(&cert)
            .collect::<Result<Vec<_>, _>>()
            .unwrap(),
        PrivateKeyDer::from_pem_slice(&key).unwrap(),
    )
    .unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let peer = tokio::spawn(async move {
        let (socket, _) = listener.accept().await.unwrap();
        let mut socket = tokio_rustls::TlsAcceptor::from(Arc::new(config))
            .accept(socket)
            .await
            .unwrap();
        socket
            .write_all(b"* OK Synthetic no-Sent peer\r\n")
            .await
            .unwrap();
        let mut socket = BufReader::new(socket);
        loop {
            let mut request = String::new();
            match socket.read_line(&mut request).await {
                Ok(0) | Err(_) => return,
                Ok(_) => {}
            }
            let (tag, command) = request.trim_end().split_once(' ').unwrap();
            let payload = if command.starts_with("LOGIN ") {
                ""
            } else if command == "CAPABILITY" {
                "* CAPABILITY IMAP4rev1\r\n"
            } else if command.starts_with("LIST ") {
                "* LIST () \"/\" \"INBOX\"\r\n"
            } else if command.starts_with("STATUS ") {
                "* STATUS INBOX (UIDVALIDITY 1 UIDNEXT 1 MESSAGES 0)\r\n"
            } else {
                panic!("unexpected command in no-Sent verification");
            };
            socket
                .get_mut()
                .write_all(format!("{payload}{tag} OK done\r\n").as_bytes())
                .await
                .unwrap();
        }
    });
    let transport = ProtocolTransport::new(
        Connector::new(LocalEndpoints {
            addresses: BTreeMap::from([("maillab.example.net:993".into(), address.to_string())]),
            trust_root_pem: Some(std::fs::read_to_string(generated.join("ca.pem")).unwrap()),
        })
        .unwrap(),
    );
    let login = Login {
        endpoint: Endpoint {
            host: "maillab.example.net".into(),
            port: 993,
            tls: TlsMode::Implicit,
            username: "synthetic-user".into(),
        },
        password: Secret("synthetic-test-password".into()),
    };
    let credentials = Credentials {
        features: None,
        binding: Some(Binding {
            link_id: uuid::Uuid::now_v7(),
            sync_generation: 1,
            grant_generation: 1,
        }),
        user_id: "synthetic-owner".into(),
        email: "owner@example.com".into(),
        imap: login.clone(),
        smtp: login,
    };
    assert!(
        !transport
            .save_sent(&credentials, "unconfirmed@example.com", &[], false)
            .await
            .unwrap()
    );
    drop(transport);
    tokio::time::timeout(Duration::from_secs(3), peer)
        .await
        .unwrap()
        .unwrap();
}

#[tokio::test]
#[ignore = "requires the owned Dovecot lab and explicit IMAP_TEST_ENDPOINT_MAP"]
async fn real_sent_reconciliation_requires_one_exact_message_id_and_never_appends() {
    let addresses = serde_json::from_str(
        &macro_env_var::read_env("IMAP_TEST_ENDPOINT_MAP").expect("explicit local lab endpoints"),
    )
    .unwrap();
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
    let nonce = uuid::Uuid::now_v7();
    let email = format!("sent-proof-{nonce}@example.com");
    let login = Login {
        endpoint: Endpoint {
            host: "maillab.example.net".into(),
            port: 993,
            tls: TlsMode::Implicit,
            username: email.clone(),
        },
        password: Secret("pass".into()),
    };
    let credentials = Credentials {
        features: None,
        binding: Some(Binding {
            link_id: nonce,
            sync_generation: 1,
            grant_generation: 1,
        }),
        user_id: "synthetic-owner".into(),
        email,
        imap: login.clone(),
        smtp: login,
    };
    let id = format!("sent-proof-{nonce}@example.com");
    let mut session = transport.command_session(&credentials).await.unwrap();
    let partial =
        format!("Message-ID: <prefix-{id}>\r\nSubject: Synthetic substring\r\n\r\nTest body");
    session
        .append("Sent", None, None, partial.as_bytes())
        .await
        .unwrap();
    transport.return_command(&credentials, session).await;
    assert!(
        !transport
            .save_sent(&credentials, &id, &[], false)
            .await
            .unwrap()
    );

    let mut session = transport.command_session(&credentials).await.unwrap();
    let exact = format!("Message-ID: <{id}>\r\nSubject: Synthetic exact proof\r\n\r\nTest body");
    session
        .append("Sent", None, None, exact.as_bytes())
        .await
        .unwrap();
    transport.return_command(&credentials, session).await;
    assert!(
        transport
            .save_sent(&credentials, &id, &[], false)
            .await
            .unwrap()
    );
    assert!(
        transport
            .save_sent(&credentials, &id, &[], false)
            .await
            .unwrap()
    );
    let mut session = transport.command_session(&credentials).await.unwrap();
    session.select("Sent").await.unwrap();
    assert_eq!(session.uid_search("ALL").await.unwrap().len(), 2);
    session
        .append("Sent", None, None, exact.as_bytes())
        .await
        .unwrap();
    transport.return_command(&credentials, session).await;
    assert_eq!(
        transport.save_sent(&credentials, &id, &[], false).await,
        Err(Error::ConnectionUnavailable),
    );
}
