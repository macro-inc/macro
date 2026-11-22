mod authentication;
use super::*;
use crate::outbound::network::LocalEndpoints;
use std::collections::BTreeMap;

mod submission;

#[test]
fn bcc_headers_and_continuations_are_not_transmitted() {
    let source=b"From: sender@example.net\r\nTo: visible@example.net\r\nBcc: hidden@example.net,\r\n another@example.net\r\nResent-Bcc: secret@example.net\r\nSubject: privacy\r\n\r\nBody containing Bcc: stays.";
    let wire = without_bcc(source).unwrap();
    assert!(!wire.contains("hidden@example.net"));
    assert!(!wire.contains("another@example.net"));
    assert!(!wire.contains("secret@example.net"));
    assert!(wire.contains("Body containing Bcc: stays."));
}

#[tokio::test]
#[ignore = "requires docker/imap-lab running with generated trust root"]
async fn real_tls_accounts_are_isolated_and_flags_move_and_smtp_work() {
    let ca = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../docker/imap-lab/generated/ca.pem"),
    )
    .unwrap();
    let connector = Connector::new(LocalEndpoints {
        addresses: BTreeMap::from([
            (
                "maillab.example.net:993".into(),
                "127.0.0.1:35993".parse().unwrap(),
            ),
            (
                "maillab.example.net:465".into(),
                "127.0.0.1:35465".parse().unwrap(),
            ),
            (
                "maillab.example.net:143".into(),
                "127.0.0.1:35143".parse().unwrap(),
            ),
            (
                "maillab.example.net:587".into(),
                "127.0.0.1:35587".parse().unwrap(),
            ),
        ]),
        trust_root_pem: Some(ca),
    })
    .unwrap();
    let protocol = ProtocolTransport::new(connector);
    let user = format!("engine-{}@maillab.example.net", uuid::Uuid::now_v7());
    let credentials = Credentials {
        features: None,
        binding: None,
        user_id: "owner".into(),
        email: user.clone(),
        imap: Login {
            endpoint: Endpoint {
                host: "maillab.example.net".into(),
                port: 993,
                tls: TlsMode::Implicit,
                username: user.clone(),
            },
            password: Secret("pass".into()),
        },
        smtp: Login {
            endpoint: Endpoint {
                host: "maillab.example.net".into(),
                port: 465,
                tls: TlsMode::Implicit,
                username: user.clone(),
            },
            password: Secret("pass".into()),
        },
    };
    protocol.verify(&credentials).await.unwrap();
    let mut session = protocol.imap(&credentials.imap).await.unwrap();
    session.create("Archive").await.unwrap();
    let mime = format!(
        "From: {user}\r\nTo: recipient@example.net\r\nMessage-ID: <{}@maillab.example.net>\r\nSubject: isolated\r\n\r\nPrivate source",
        uuid::Uuid::now_v7()
    );
    session
        .append("INBOX", None, None, mime.as_bytes())
        .await
        .unwrap();
    session.logout().await.unwrap();
    let snapshot = protocol
        .snapshot(&credentials, &AccountState::default())
        .await
        .unwrap();
    let inbox = snapshot
        .iter()
        .find(|f| f.folder.role == FolderRole::Inbox)
        .unwrap();
    assert_eq!(inbox.messages.len(), 1);
    let message = &inbox.messages[0];
    let source = protocol
        .source(&credentials, &inbox.path, inbox.uid_validity, message.uid)
        .await
        .unwrap();
    assert!(
        String::from_utf8(source)
            .unwrap()
            .contains("Private source")
    );
    protocol
        .apply(
            &credentials,
            &inbox.path,
            inbox.uid_validity,
            message.uid,
            RemoteAction::Flag {
                flag: "\\Seen".into(),
                enabled: true,
            },
        )
        .await
        .unwrap();
    if let Some(modseq) = message.modseq {
        assert!(matches!(
            protocol
                .apply(
                    &credentials,
                    &inbox.path,
                    inbox.uid_validity,
                    message.uid,
                    RemoteAction::IfUnchanged {
                        modseq,
                        action: Box::new(RemoteAction::Flag {
                            flag: "\\Flagged".into(),
                            enabled: true
                        })
                    }
                )
                .await,
            Err(ApplyError::Uncertain(Error::Conflict))
        ));
    }
    protocol
        .apply(
            &credentials,
            &inbox.path,
            inbox.uid_validity,
            message.uid,
            RemoteAction::Move("Archive".into()),
        )
        .await
        .unwrap();
    let moved = protocol
        .snapshot(&credentials, &AccountState::default())
        .await
        .unwrap();
    assert_eq!(
        moved
            .iter()
            .find(|f| f.folder.role == FolderRole::Inbox)
            .unwrap()
            .messages
            .len(),
        0
    );
    assert_eq!(
        moved
            .iter()
            .find(|f| f.folder.role == FolderRole::Archive)
            .unwrap()
            .messages
            .len(),
        1
    );
    let mut other = credentials.clone();
    other.email = format!("other-{}@maillab.example.net", uuid::Uuid::now_v7());
    other.imap.endpoint.username = other.email.clone();
    other.smtp.endpoint.username = other.email.clone();
    let isolated = protocol
        .snapshot(&other, &AccountState::default())
        .await
        .unwrap();
    assert!(isolated.iter().all(|f| f.messages.is_empty()));
    assert_eq!(
        protocol
            .submit(
                &credentials,
                &user,
                &["recipient@example.net".into()],
                mime.as_bytes(),
                tokio::time::Instant::now() + SUBMISSION_PRE_BODY_BUDGET,
            )
            .await
            .unwrap()
            .outcome,
        SubmissionOutcome::Accepted
    );
    let mut starttls = credentials;
    starttls.imap.endpoint.port = 143;
    starttls.imap.endpoint.tls = TlsMode::StartTls;
    starttls.smtp.endpoint.port = 587;
    starttls.smtp.endpoint.tls = TlsMode::StartTls;
    protocol.verify(&starttls).await.unwrap();
}

#[test]
fn excessively_nested_mime_is_rejected_without_recursing_through_the_entire_source() {
    let mut source = String::new();
    for depth in 0..150 {
        source.push_str(&format!(
            "Content-Type: multipart/mixed; boundary=boundary{depth:03}_end\r\n\r\n--boundary{depth:03}_end\r\n"
        ));
    }
    source.push_str("Content-Type: text/plain\r\n\r\nend\r\n");
    for depth in (0..150).rev() {
        source.push_str(&format!("\r\n--boundary{depth:03}_end--\r\n"));
    }
    assert!(mailparse::parse_mail(source.as_bytes()).is_err());
}

#[tokio::test]
#[ignore = "requires docker/imap-lab running with generated trust root"]
async fn smtp_pool_reuses_one_connection_but_never_another_binding() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let proxy_address = listener.local_addr().unwrap();
    let connections = std::sync::Arc::new(std::sync::atomic::AtomicU32::new(0));
    let counted = connections.clone();
    let cancellation = tokio_util::sync::CancellationToken::new();
    let stopped = cancellation.clone();
    let tasks = tokio_util::task::TaskTracker::new();
    let forwards = tasks.clone();
    tasks.spawn(async move {
        loop {
            let (mut inbound, _) = tokio::select! {
                _ = stopped.cancelled() => break,
                accepted = listener.accept() => accepted.unwrap(),
            };
            let number = counted.fetch_add(1, std::sync::atomic::Ordering::AcqRel);
            if number > 0 {
                drop(inbound);
                continue;
            }
            let done = stopped.clone();
            forwards.spawn(async move {
                let mut upstream = tokio::net::TcpStream::connect("127.0.0.1:35465")
                    .await
                    .unwrap();
                tokio::select! {
                    _ = done.cancelled() => {},
                    _ = tokio::io::copy_bidirectional(&mut inbound, &mut upstream) => {},
                }
            });
        }
    });
    let ca = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../docker/imap-lab/generated/ca.pem"),
    )
    .unwrap();
    let protocol = ProtocolTransport::new(
        Connector::new(LocalEndpoints {
            addresses: BTreeMap::from([(
                "maillab.example.net:465".into(),
                proxy_address.to_string(),
            )]),
            trust_root_pem: Some(ca),
        })
        .unwrap(),
    );
    let binding = Binding {
        link_id: uuid::Uuid::now_v7(),
        sync_generation: 1,
        grant_generation: 1,
    };
    let owner = format!("pool-{}@maillab.example.net", uuid::Uuid::now_v7());
    let credentials = Credentials {
        features: None,
        binding: Some(binding),
        user_id: "owner".into(),
        email: owner.clone(),
        imap: Login {
            endpoint: Endpoint {
                host: "maillab.example.net".into(),
                port: 993,
                tls: TlsMode::Implicit,
                username: owner.clone(),
            },
            password: Secret("pass".into()),
        },
        smtp: Login {
            endpoint: Endpoint {
                host: "maillab.example.net".into(),
                port: 465,
                tls: TlsMode::Implicit,
                username: owner.clone(),
            },
            password: Secret("pass".into()),
        },
    };
    for n in 0..2 {
        let mime = format!(
            "From: {owner}\r\nTo: recipient@example.net\r\nMessage-ID: <{n}.{}@maillab.example.net>\r\nSubject: pool\r\n\r\nTest",
            binding.link_id
        );
        assert_eq!(
            protocol
                .submit(
                    &credentials,
                    &owner,
                    &["recipient@example.net".into()],
                    mime.as_bytes(),
                    tokio::time::Instant::now() + SUBMISSION_PRE_BODY_BUDGET,
                )
                .await
                .unwrap()
                .outcome,
            SubmissionOutcome::Accepted
        );
    }
    assert_eq!(connections.load(std::sync::atomic::Ordering::Acquire), 1);
    let mut other = credentials.clone();
    other.binding = Some(Binding {
        link_id: uuid::Uuid::now_v7(),
        ..binding
    });
    assert!(
        protocol
            .submit(
                &other,
                &owner,
                &["recipient@example.net".into()],
                b"From: test@example.net\r\n\r\nprivate",
                tokio::time::Instant::now() + SUBMISSION_PRE_BODY_BUDGET,
            )
            .await
            .is_err()
    );
    assert_eq!(connections.load(std::sync::atomic::Ordering::Acquire), 2);
    protocol.disconnect(binding).await.unwrap();
    cancellation.cancel();
    tasks.close();
    tokio::time::timeout(Duration::from_secs(5), tasks.wait())
        .await
        .unwrap();
}

mod fault;

#[tokio::test]
#[ignore = "requires docker/imap-lab running with generated trust root"]
async fn real_smtp_temporary_and_permanent_refusals_do_not_submit_data() {
    for (code, expected) in [
        (451, Error::ConnectionUnavailable),
        (554, Error::SendRejected),
    ] {
        let proxy = fault::Proxy::start(fault::Fault::RejectData(code)).await;
        let protocol = proxy.transport();
        let owner = format!("refusal-{}@maillab.example.net", uuid::Uuid::now_v7());
        let credentials = Credentials {
            features: None,
            binding: Some(Binding {
                link_id: uuid::Uuid::now_v7(),
                sync_generation: 1,
                grant_generation: 1,
            }),
            user_id: "owner".into(),
            email: owner.clone(),
            imap: Login {
                endpoint: Endpoint {
                    host: "maillab.example.net".into(),
                    port: 993,
                    tls: TlsMode::Implicit,
                    username: owner.clone(),
                },
                password: Secret("pass".into()),
            },
            smtp: Login {
                endpoint: Endpoint {
                    host: "maillab.example.net".into(),
                    port: 465,
                    tls: TlsMode::Implicit,
                    username: owner.clone(),
                },
                password: Secret("pass".into()),
            },
        };
        assert_eq!(
            protocol
                .submit(
                    &credentials,
                    &owner,
                    &["recipient@example.net".into()],
                    b"From: sender@example.net\r\n\r\nRefused",
                    tokio::time::Instant::now() + SUBMISSION_PRE_BODY_BUDGET,
                )
                .await
                .unwrap_err(),
            expected
        );
        assert_eq!(proxy.accepted.load(std::sync::atomic::Ordering::Acquire), 0);
        proxy.close().await;
    }
}

struct FixedCredentials(Credentials);
#[async_trait::async_trait]
impl CredentialCipher for FixedCredentials {
    async fn encrypt(&self, _: uuid::Uuid, _: &str, _: &Credentials) -> Result<Vec<u8>, Error> {
        Err(Error::Invalid)
    }
    async fn decrypt(&self, _: uuid::Uuid, _: &str, _: &[u8]) -> Result<Credentials, Error> {
        Ok(self.0.clone())
    }
}

#[tokio::test]
#[ignore = "requires docker/imap-lab running with generated trust root"]
async fn lost_real_smtp_final_reply_is_unknown_and_a_restarted_engine_never_retransmits() {
    use crate::domain::{
        models::DraftInput,
        service::{Engine, test::MemoryRepository},
    };
    use std::sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    };
    let proxy = fault::Proxy::start(fault::Fault::LoseFinal).await;
    let repository = Arc::new(MemoryRepository {
        state: Mutex::new(AccountState::default()),
        saved_unknown: AtomicBool::new(false),
        owner_available: AtomicBool::new(true),
        owner_claims: std::sync::atomic::AtomicU32::new(0),
        owner_gate: std::sync::Mutex::new(None),
        owner_errors: std::sync::atomic::AtomicU32::new(0),
        releases: std::sync::atomic::AtomicU32::new(0),
        acquire_gate: None,
    });
    let binding = Binding {
        link_id: uuid::Uuid::now_v7(),
        sync_generation: 1,
        grant_generation: 1,
    };
    let owner = format!("lost-final-{}@maillab.example.net", binding.link_id);
    let credentials = Credentials {
        features: None,
        binding: Some(binding),
        user_id: "owner".into(),
        email: owner.clone(),
        imap: Login {
            endpoint: Endpoint {
                host: "maillab.example.net".into(),
                port: 993,
                tls: TlsMode::Implicit,
                username: owner.clone(),
            },
            password: Secret("pass".into()),
        },
        smtp: Login {
            endpoint: Endpoint {
                host: "maillab.example.net".into(),
                port: 465,
                tls: TlsMode::Implicit,
                username: owner.clone(),
            },
            password: Secret("pass".into()),
        },
    };
    let cipher = Arc::new(FixedCredentials(credentials));
    let engine = Engine::new(
        repository.clone(),
        cipher.clone(),
        Arc::new(proxy.transport()),
    );
    let correlation = uuid::Uuid::now_v7();
    let input = DraftInput {
        correlation,
        revision: 1,
        reply_to: None,
        content: serde_json::json!(
        {
            "message_id": format!("{correlation}@example.net"),
            "message": {
                "link_id": binding.link_id,
                "subject": format!("lost-final-{correlation}"),
                "to": [
                    {
                        "email": "recipient@example.net",
                        "name": null,
                        "photo_url": null
                    }
                ],
                "body_text": "only once"
            },
            "from": {
                "email": owner,
                "name": null,
                "photo_url": null
            },
            "parent_message_id": null,
            "references": null
        }
        ),
    };
    let draft: Draft = serde_json::from_value(
        engine
            .execute(binding, Operation::CreateDraft { input })
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        engine
            .execute(
                binding,
                Operation::Submit {
                    id: draft.id.clone()
                }
            )
            .await
            .unwrap(),
        serde_json::json!("unknown")
    );
    assert_eq!(proxy.accepted.load(Ordering::Acquire), 1);
    let restarted = Engine::new(repository, cipher, Arc::new(proxy.transport()));
    assert_eq!(
        restarted
            .execute(binding, Operation::Submit { id: draft.id })
            .await
            .unwrap(),
        serde_json::json!("unknown")
    );
    assert_eq!(proxy.connections.load(Ordering::Acquire), 1);
    proxy.close().await;
}

#[tokio::test]
#[ignore = "requires optional docker/imap-lab Stalwart profile"]
async fn real_stalwart_roundtrip_preserves_source_flags_move_and_sent_copy() {
    let ca = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../docker/imap-lab/generated/ca.pem"),
    )
    .unwrap();
    let protocol = ProtocolTransport::new(
        Connector::new(LocalEndpoints {
            addresses: BTreeMap::from([
                (
                    "maillab.example.net:993".into(),
                    "127.0.0.1:36993".parse().unwrap(),
                ),
                (
                    "maillab.example.net:465".into(),
                    "127.0.0.1:36465".parse().unwrap(),
                ),
            ]),
            trust_root_pem: Some(ca),
        })
        .unwrap(),
    );
    let user = "stalwart-alice@example.net";
    let credentials = Credentials {
        features: None,
        binding: None,
        user_id: "stalwart-owner".into(),
        email: user.into(),
        imap: Login {
            endpoint: Endpoint {
                host: "maillab.example.net".into(),
                port: 993,
                tls: TlsMode::Implicit,
                username: user.into(),
            },
            password: Secret("lab-mail-pass".into()),
        },
        smtp: Login {
            endpoint: Endpoint {
                host: "maillab.example.net".into(),
                port: 465,
                tls: TlsMode::Implicit,
                username: user.into(),
            },
            password: Secret("lab-mail-pass".into()),
        },
    };
    protocol.verify(&credentials).await.unwrap();
    let unique = uuid::Uuid::now_v7();
    let destination = format!("Archive-{unique}");
    let mut session = protocol.imap(&credentials.imap).await.unwrap();
    session.create(&destination).await.unwrap();
    let source = format!(
        "From: {user}\r\nTo: stalwart-bob@example.net\r\nMessage-ID: <{unique}@example.net>\r\nSubject: interoperability\r\n\r\nReal Stalwart source {unique}"
    );
    session
        .append("INBOX", None, None, source.as_bytes())
        .await
        .unwrap();
    session.logout().await.unwrap();
    let snapshot = protocol
        .snapshot(&credentials, &AccountState::default())
        .await
        .unwrap();
    let inbox = snapshot
        .iter()
        .find(|f| f.folder.role == FolderRole::Inbox)
        .unwrap();
    let message = inbox
        .messages
        .iter()
        .find(|m| String::from_utf8_lossy(&m.mime).contains(&unique.to_string()))
        .unwrap();
    let fetched = protocol
        .source(&credentials, &inbox.path, inbox.uid_validity, message.uid)
        .await
        .unwrap();
    assert!(String::from_utf8_lossy(&fetched).contains(&format!("Real Stalwart source {unique}")));
    protocol
        .apply(
            &credentials,
            &inbox.path,
            inbox.uid_validity,
            message.uid,
            RemoteAction::Flag {
                flag: "\\Seen".into(),
                enabled: true,
            },
        )
        .await
        .unwrap();
    let receipt = protocol
        .apply(
            &credentials,
            &inbox.path,
            inbox.uid_validity,
            message.uid,
            RemoteAction::Move(destination.clone()),
        )
        .await
        .unwrap();
    assert!(receipt.destination_uid.is_some());
    let moved = protocol
        .snapshot(&credentials, &AccountState::default())
        .await
        .unwrap();
    let target = moved.iter().find(|f| f.path == destination).unwrap();
    assert!(
        target
            .messages
            .iter()
            .any(|m| m.flags.iter().any(|f| f == "\\Seen")
                && String::from_utf8_lossy(&m.mime).contains(&unique.to_string()))
    );
    assert_eq!(
        protocol
            .submit(
                &credentials,
                user,
                &["stalwart-bob@example.net".into()],
                source.as_bytes(),
                tokio::time::Instant::now() + SUBMISSION_PRE_BODY_BUDGET,
            )
            .await
            .unwrap()
            .outcome,
        SubmissionOutcome::Accepted
    );
    protocol
        .save_sent(
            &credentials,
            &format!("{unique}@example.net"),
            source.as_bytes(),
            true,
        )
        .await
        .unwrap();
    protocol
        .save_sent(
            &credentials,
            &format!("{unique}@example.net"),
            source.as_bytes(),
            true,
        )
        .await
        .unwrap();
    let after = protocol
        .snapshot(&credentials, &AccountState::default())
        .await
        .unwrap();
    let sent = after
        .iter()
        .find(|f| f.folder.role == FolderRole::Sent)
        .unwrap();
    assert_eq!(
        sent.messages
            .iter()
            .filter(|m| String::from_utf8_lossy(&m.mime).contains(&unique.to_string()))
            .count(),
        1
    );
}

mod gmail;

#[tokio::test]
#[ignore = "requires docker/imap-lab running with generated trust root"]
async fn imap_spare_connection_reuses_only_the_same_binding_and_disconnect_evicts_it() {
    use std::sync::{
        Arc,
        atomic::{AtomicU32, Ordering},
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let connections = Arc::new(AtomicU32::new(0));
    let recorded = connections.clone();
    let stop = tokio_util::sync::CancellationToken::new();
    let stopped = stop.clone();
    let tasks = tokio_util::task::TaskTracker::new();
    let children = tasks.clone();
    tasks.spawn(async move {
        loop {
            let (mut client, _) = tokio::select! {
                _ = stopped.cancelled() => return,
                s = listener.accept() => s.unwrap(),
            };
            recorded.fetch_add(1, Ordering::AcqRel);
            let done = stopped.clone();
            children.spawn(async move {
                let mut upstream = tokio::net::TcpStream::connect("127.0.0.1:35993")
                    .await
                    .unwrap();
                tokio::select! {
                    _ = done.cancelled() => {},
                    _ = tokio::io::copy_bidirectional(&mut client, &mut upstream) => {},
                }
            });
        }
    });
    let ca = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../docker/imap-lab/generated/ca.pem"),
    )
    .unwrap();
    let protocol = ProtocolTransport::new(
        Connector::new(LocalEndpoints {
            addresses: BTreeMap::from([("maillab.example.net:993".into(), address.to_string())]),
            trust_root_pem: Some(ca),
        })
        .unwrap(),
    );
    let binding = Binding {
        link_id: uuid::Uuid::now_v7(),
        sync_generation: 1,
        grant_generation: 1,
    };
    let user = format!("imap-pool-{}@example.net", binding.link_id);
    let login = Login {
        endpoint: Endpoint {
            host: "maillab.example.net".into(),
            port: 993,
            tls: TlsMode::Implicit,
            username: user.clone(),
        },
        password: Secret("pass".into()),
    };
    let mut credentials = Credentials {
        features: None,
        binding: Some(binding),
        user_id: "owner".into(),
        email: user,
        imap: login.clone(),
        smtp: login,
    };
    for _ in 0..2 {
        let mut command = protocol.command_session(&credentials).await.unwrap();
        command.select("INBOX").await.unwrap();
        protocol.return_command(&credentials, command).await;
    }
    assert_eq!(connections.load(Ordering::Acquire), 1);
    credentials.binding = Some(Binding {
        grant_generation: 2,
        ..binding
    });
    let mut command = protocol.command_session(&credentials).await.unwrap();
    command.select("INBOX").await.unwrap();
    protocol.return_command(&credentials, command).await;
    assert_eq!(connections.load(Ordering::Acquire), 2);
    protocol
        .disconnect(credentials.binding.unwrap())
        .await
        .unwrap();
    let command = protocol.command_session(&credentials).await.unwrap();
    drop(command);
    assert_eq!(connections.load(Ordering::Acquire), 3);
    stop.cancel();
    tasks.close();
    tokio::time::timeout(Duration::from_secs(5), tasks.wait())
        .await
        .unwrap();
}

mod scale;
