//! A trusted-TLS transcript fixture for Google's documented X-GM extension.
use super::*;
use std::sync::{Arc, Mutex};
use tokio_rustls::rustls::pki_types::{CertificateDer, PrivateKeyDer, pem::PemObject};
#[tokio::test]
#[ignore = "requires docker/imap-lab generated trust root"]
async fn gmail_wire_scans_only_three_physical_folders_and_derives_native_label_feeds() {
    let generated =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../docker/imap-lab/generated");
    let cert = std::fs::read(generated.join("server.pem")).unwrap();
    let key = std::fs::read(generated.join("server.key")).unwrap();
    let certificates = CertificateDer::pem_slice_iter(&cert)
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    let key = PrivateKeyDer::from_pem_slice(&key).unwrap();
    let config = tokio_rustls::rustls::ServerConfig::builder_with_provider(Arc::new(
        tokio_rustls::rustls::crypto::aws_lc_rs::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_no_client_auth()
    .with_single_cert(certificates, key)
    .unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let selects = Arc::new(Mutex::new(Vec::new()));
    let recorded = selects.clone();
    let server = tokio::spawn(async move {
        let (socket, _) = listener.accept().await.unwrap();
        let mut socket = tokio_rustls::TlsAcceptor::from(Arc::new(config))
            .accept(socket)
            .await
            .unwrap();
        socket
            .write_all(b"* OK Gmail transcript\r\n")
            .await
            .unwrap();
        let mut selected = String::new();
        loop {
            let incoming = line(&mut socket).await.unwrap();
            let incoming = std::str::from_utf8(&incoming).unwrap().trim();
            let (tag, command) = incoming.split_once(' ').unwrap();
            let mut payload = String::new();
            if command.starts_with("CAPABILITY") {
                payload.push_str("* CAPABILITY IMAP4rev1 X-GM-EXT-1\r\n");
            } else if command.starts_with("LIST ") {
                payload.push_str("* LIST (\\All) \"/\" \"All Mail\"\r\n* LIST () \"/\" \"INBOX\"\r\n* LIST (\\Sent) \"/\" \"Sent\"\r\n* LIST (\\Junk) \"/\" \"Spam\"\r\n* LIST (\\Trash) \"/\" \"Trash\"\r\n* LIST () \"/\" \"Envoy&AOk-s\"\r\n");
            } else if command.starts_with("STATUS ") {
                let mailbox = command
                    .strip_prefix("STATUS ")
                    .unwrap()
                    .split_once(" (")
                    .unwrap()
                    .0;
                payload = format!("* STATUS {mailbox} (UIDVALIDITY 10 UIDNEXT 2 MESSAGES 1)\r\n");
            } else if let Some(folder) = command.strip_prefix("SELECT ") {
                selected = folder.trim_matches('"').to_owned();
                recorded.lock().unwrap().push(selected.clone());
                payload.push_str(
                    "* 1 EXISTS\r\n* OK [UIDVALIDITY 10] epoch\r\n* OK [UIDNEXT 2] next\r\n",
                );
            } else if command.starts_with("UID SEARCH") {
                payload = if selected == "All Mail" {
                    "* SEARCH 1\r\n".into()
                } else {
                    "* SEARCH\r\n".into()
                };
            } else if command.starts_with("UID FETCH") && command.contains("X-GM-THRID") {
                payload.push_str("* 1 FETCH (UID 1 X-GM-MSGID 42 X-GM-THRID 48 X-GM-LABELS (\\Inbox Envoy&AOk-s))\r\n");
            } else if command.starts_with("UID FETCH") {
                let header = "From: sender@example.net\r\nMessage-ID: <gmail-native@example.net>\r\nSubject: native\r\n\r\n";
                payload = format!(
                    "* 1 FETCH (UID 1 FLAGS () INTERNALDATE \"14-Nov-2023 22:13:20 +0000\" RFC822.SIZE 99 X-GM-MSGID 42 BODY[HEADER] {{{}}}\r\n{})\r\n",
                    header.len(),
                    header
                );
            } else if command.starts_with("LOGOUT") {
                socket
                    .write_all(format!("* BYE done\r\n{tag} OK logout\r\n").as_bytes())
                    .await
                    .unwrap();
                return;
            } else {
                assert!(
                    command.starts_with("LOGIN "),
                    "unexpected transcript command"
                );
            }
            payload.push_str(&format!("{tag} OK done\r\n"));
            socket.write_all(payload.as_bytes()).await.unwrap();
        }
    });
    let ca = std::fs::read_to_string(generated.join("ca.pem")).unwrap();
    let protocol = ProtocolTransport::new(
        Connector::new(LocalEndpoints {
            addresses: BTreeMap::from([("maillab.example.net:993".into(), address.to_string())]),
            trust_root_pem: Some(ca),
        })
        .unwrap(),
    );
    let login = Login {
        endpoint: Endpoint {
            host: "maillab.example.net".into(),
            port: 993,
            tls: TlsMode::Implicit,
            username: "owner@example.net".into(),
        },
        password: Secret("pass".into()),
    };
    let credentials = Credentials {
        features: None,
        binding: None,
        user_id: "owner".into(),
        email: "owner@example.net".into(),
        imap: login.clone(),
        smtp: login,
    };
    let snapshot = protocol
        .snapshot(&credentials, &AccountState::default())
        .await
        .unwrap();
    server.await.unwrap();
    let selected = selects.lock().unwrap();
    assert_eq!(selected.len(), 3);
    assert!(
        selected
            .iter()
            .all(|f| ["All Mail", "Spam", "Trash"].contains(&f.as_str()))
    );
    let inbox = snapshot
        .iter()
        .find(|f| f.folder.role == FolderRole::Inbox)
        .unwrap();
    assert_eq!(inbox.path, "All Mail");
    assert_eq!(inbox.messages.len(), 1);
    assert_eq!(inbox.messages[0].gmail_message_id, Some(42));
    assert_eq!(inbox.messages[0].native_thread_id.as_deref(), Some("g:30"));
    let project = snapshot
        .iter()
        .find(|f| f.folder.name == "Envoyés")
        .unwrap();
    assert_eq!(project.messages.len(), 1);
    assert_eq!(project.virtual_label.as_deref(), Some("Envoyés"));
    assert!(
        project.messages[0]
            .gmail_labels
            .as_ref()
            .unwrap()
            .contains(&"Envoyés".to_owned())
    );
    assert!(Arc::ptr_eq(
        &inbox.messages[0].mime,
        &project.messages[0].mime
    ));
}
