use super::*;
use chrono::TimeZone;
use std::sync::atomic::{AtomicBool, Ordering};

mod admission;
mod credential_health;
mod fakes;
mod ownership;
mod reads;
pub(crate) use fakes::{MemoryRepository, ProviderWorkControl, TestCipher, UncertainTransport};

#[test]
fn moving_and_uidvalidity_reset_preserve_identity_and_emit_folder_removals() {
    let received = Utc.timestamp_opt(1_700_000_000, 0).unwrap();
    let mime=b"From: sender@example.net\r\nTo: receiver@example.net\r\nMessage-ID: <stable@example.net>\r\nSubject: example\r\n\r\nHello".to_vec();
    let mut state = AccountState::default();
    merge_snapshot(
        &mut state,
        vec![RemoteFolder {
            virtual_label: None,
            uid_next: None,
            phantom: None,
            detected_role: None,
            monitored: true,
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
            uid_validity: 10,
            highest_modseq: None,
            sync_tier: SyncTier::Full,
            messages: vec![RemoteMessage {
                gmail_labels: None,
                uid: 1,
                flags: Vec::new(),
                mime: mime.clone().into(),
                size: 100,
                received_at: received,
                modseq: None,
                gmail_message_id: None,
                native_message_id: None,
                native_thread_id: None,
            }],
        }],
    )
    .unwrap();
    let original = state.messages.keys().next().unwrap().clone();
    let checkpoint = changes(&state, "inbox", None).unwrap().position;
    merge_snapshot(
        &mut state,
        vec![
            RemoteFolder {
                virtual_label: None,
                uid_next: None,
                phantom: None,
                detected_role: None,
                monitored: true,
                folder: Folder {
                    sync_enabled: true,
                    id: "inbox".into(),
                    parent_id: None,
                    name: "INBOX".into(),
                    role: FolderRole::Inbox,
                    has_children: false,
                    total_items: Some(0),
                },
                path: "INBOX".into(),
                uid_validity: 10,
                highest_modseq: None,
                sync_tier: SyncTier::Full,
                messages: Vec::new(),
            },
            RemoteFolder {
                virtual_label: None,
                uid_next: None,
                phantom: None,
                detected_role: None,
                monitored: true,
                folder: Folder {
                    sync_enabled: true,
                    id: "archive".into(),
                    parent_id: None,
                    name: "Archive".into(),
                    role: FolderRole::Archive,
                    has_children: false,
                    total_items: Some(1),
                },
                path: "Archive".into(),
                uid_validity: 20,
                highest_modseq: None,
                sync_tier: SyncTier::Full,
                messages: vec![RemoteMessage {
                    gmail_labels: None,
                    uid: 99,
                    flags: vec!["\\Seen".into()],
                    mime: mime.clone().into(),
                    size: 100,
                    received_at: received,
                    modseq: None,
                    gmail_message_id: None,
                    native_message_id: None,
                    native_thread_id: None,
                }],
            },
        ],
    )
    .unwrap();
    assert_eq!(state.messages.len(), 1);
    assert_eq!(state.messages.get(&original).unwrap().folder_id, "archive");
    assert_eq!(
        changes(&state, "inbox", Some(&checkpoint)).unwrap().removed,
        vec![original.clone()]
    );
    let old_archive = changes(&state, "archive", None).unwrap().position;
    merge_snapshot(
        &mut state,
        vec![RemoteFolder {
            virtual_label: None,
            uid_next: None,
            phantom: None,
            detected_role: None,
            monitored: true,
            folder: Folder {
                sync_enabled: true,
                id: "archive".into(),
                parent_id: None,
                name: "Archive".into(),
                role: FolderRole::Archive,
                has_children: false,
                total_items: Some(1),
            },
            path: "Archive".into(),
            uid_validity: 21,
            highest_modseq: None,
            sync_tier: SyncTier::Full,
            messages: vec![RemoteMessage {
                gmail_labels: None,
                uid: 3,
                flags: vec!["\\Seen".into()],
                mime: mime.into(),
                size: 100,
                received_at: received,
                modseq: None,
                gmail_message_id: None,
                native_message_id: None,
                native_thread_id: None,
            }],
        }],
    )
    .unwrap();
    assert!(state.messages.contains_key(&original));
    assert_eq!(
        changes(&state, "archive", Some(&old_archive)).unwrap_err(),
        Error::CursorOutdated
    );
}

#[test]
fn equal_message_id_with_different_content_never_deduplicates_or_crosses_accounts() {
    let received = Utc.timestamp_opt(1_700_000_000, 0).unwrap();
    let mut first = AccountState::default();
    let mut second = AccountState::default();
    for (state, body) in [(&mut first, "One"), (&mut second, "Two")] {
        merge_snapshot(
            state,
            vec![RemoteFolder {
                virtual_label: None,
                uid_next: None,
                phantom: None,
                detected_role: None,
                monitored: true,
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
                uid_validity: 10,
                highest_modseq: None,
                sync_tier: SyncTier::Full,
                messages: vec![RemoteMessage {
                    gmail_labels: None,
                    uid: 1,
                    flags: Vec::new(),
                    size: 100,
                    mime: format!("Message-ID: <same@attacker.example>\r\n\r\n{body}")
                        .into_bytes()
                        .into(),
                    received_at: received,
                    modseq: None,
                    gmail_message_id: None,
                    native_message_id: None,
                    native_thread_id: None,
                }],
            }],
        )
        .unwrap();
    }
    assert_ne!(first.messages.keys().next(), second.messages.keys().next());
    assert_ne!(
        first.messages.values().next().unwrap().thread_id,
        second.messages.values().next().unwrap().thread_id
    );
}

#[test]
fn initial_pages_use_keyset_and_later_changes_remain_visible() {
    let mut state = AccountState::default();
    let mut folder = FolderState {
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
            total_items: None,
        },
        path: "INBOX".into(),
        uid_validity: 10,
        highest_modseq: None,
        sync_tier: Some(SyncTier::Full),
        sequence: 501,
        journal: Vec::new(),
    };
    for n in 0..501 {
        let id = format!("m:{n:04}");
        state.locations.push(Location {
            folder_id: "inbox".into(),
            uid_validity: 10,
            uid: n + 1,
            message_id: id.clone(),
            fingerprint: id.clone(),
        });
        folder.journal.push(Change {
            sequence: u64::from(n) + 1,
            id,
            removed: false,
        });
    }
    state.folders.insert("inbox".into(), folder);
    let first = changes(&state, "inbox", None).unwrap();
    assert!(first.has_more);
    assert_eq!(first.changed.len(), 500);
    state.locations.retain(|l| l.message_id != "m:0001");
    state.locations.push(Location {
        folder_id: "inbox".into(),
        uid_validity: 10,
        uid: 999,
        message_id: "m:0000a".into(),
        fingerprint: "new".into(),
    });
    let folder = state.folders.get_mut("inbox").unwrap();
    folder.sequence = 502;
    folder.journal.push(Change {
        sequence: 502,
        id: "m:0000a".into(),
        removed: false,
    });
    let second = changes(&state, "inbox", Some(&first.position)).unwrap();
    assert_eq!(second.changed, vec!["m:0500"]);
    assert!(!second.has_more);
    let delta = changes(&state, "inbox", Some(&second.position)).unwrap();
    assert_eq!(delta.changed, vec!["m:0000a"]);
}

#[tokio::test]
async fn uncertain_send_is_persisted_before_io_and_is_not_sent_again_after_restart() {
    let repository = Arc::new(MemoryRepository {
        state: std::sync::Mutex::new(AccountState::default()),
        saved_unknown: AtomicBool::new(false),
        owner_available: AtomicBool::new(true),
        owner_claims: std::sync::atomic::AtomicU32::new(0),
        owner_gate: std::sync::Mutex::new(None),
        owner_errors: std::sync::atomic::AtomicU32::new(0),
        releases: std::sync::atomic::AtomicU32::new(0),
        acquire_gate: None,
    });
    let transport = Arc::new(UncertainTransport {
        repository: repository.clone(),
        submissions: std::sync::atomic::AtomicU32::new(0),
        deadline: AtomicBool::new(false),
        sent_found: std::sync::Mutex::new(std::collections::BTreeSet::new()),
        submission_deadline: std::sync::Mutex::new(None),
        provider_work: None,
    });
    let binding = Binding {
        link_id: Uuid::now_v7(),
        sync_generation: 1,
        grant_generation: 1,
    };
    let engine = Engine::new(repository.clone(), Arc::new(TestCipher), transport.clone());
    let correlation = Uuid::now_v7();
    let input = DraftInput {
        correlation,
        revision: 1,
        reply_to: None,
        content: serde_json::json!(
        {
            "message_id": "send-once@example.net",
            "message": {
                "link_id": binding.link_id,
                "subject": "test",
                "to": [
                    {
                        "email": "recipient@example.net",
                        "name": null,
                        "photo_url": null
                    }
                ],
                "body_text": "payload"
            },
            "from": {
                "email": "owner@example.net",
                "name": null,
                "photo_url": null
            },
            "parent_message_id": null,
            "references": null
        }
        ),
    };
    let created: Draft = serde_json::from_value(
        engine
            .execute(binding, Operation::CreateDraft { input })
            .await
            .unwrap(),
    )
    .unwrap();
    let first: SubmissionOutcome = serde_json::from_value(
        engine
            .execute(
                binding,
                Operation::Submit {
                    id: created.id.clone(),
                },
            )
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(first, SubmissionOutcome::Unknown);
    let restarted = Engine::new(repository, Arc::new(TestCipher), transport.clone());
    let second: SubmissionOutcome = serde_json::from_value(
        restarted
            .execute(
                binding,
                Operation::Submit {
                    id: created.id.clone(),
                },
            )
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(second, SubmissionOutcome::Unknown);
    assert_eq!(transport.submissions.load(Ordering::Acquire), 1);
    {
        let mut state = transport.repository.state.lock().unwrap();
        let mut unrelated = state.drafts[&created.id].clone();
        unrelated.draft.id = "a-unprovable".into();
        let mut send: SendRequest =
            serde_json::from_value(unrelated.frozen_content.take().unwrap()).unwrap();
        send.message_id = Some("unprovable@example.com".into());
        unrelated.frozen_content = Some(serde_json::to_value(send).unwrap());
        state.drafts.insert("a-unprovable".into(), unrelated);
    }
    let pending: Option<Draft> = serde_json::from_value(
        restarted
            .execute(
                binding,
                Operation::GetDraft {
                    id: created.id.clone(),
                },
            )
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(pending.unwrap().is_draft);
    transport
        .sent_found
        .lock()
        .unwrap()
        .insert("send-once@example.net".into());
    let confirmed: Option<Draft> = serde_json::from_value(
        restarted
            .execute(binding, Operation::GetDraft { id: created.id })
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(!confirmed.unwrap().is_draft);
    assert_eq!(
        transport.repository.state.lock().unwrap().drafts["a-unprovable"].submission,
        Some(SubmissionOutcome::Unknown)
    );
    assert_eq!(transport.submissions.load(Ordering::Acquire), 1);
}

#[tokio::test]
async fn a_send_deadline_pauses_other_attempts_but_never_replays_the_unknown_one() {
    let repository = Arc::new(MemoryRepository {
        state: std::sync::Mutex::new(AccountState::default()),
        saved_unknown: AtomicBool::new(false),
        owner_available: AtomicBool::new(true),
        owner_claims: std::sync::atomic::AtomicU32::new(0),
        owner_gate: std::sync::Mutex::new(None),
        owner_errors: std::sync::atomic::AtomicU32::new(0),
        releases: std::sync::atomic::AtomicU32::new(0),
        acquire_gate: None,
    });
    let transport = Arc::new(UncertainTransport {
        repository: repository.clone(),
        submissions: std::sync::atomic::AtomicU32::new(0),
        deadline: AtomicBool::new(true),
        sent_found: std::sync::Mutex::new(std::collections::BTreeSet::new()),
        submission_deadline: std::sync::Mutex::new(None),
        provider_work: None,
    });
    let binding = Binding {
        link_id: Uuid::now_v7(),
        sync_generation: 1,
        grant_generation: 1,
    };
    let engine = Engine::new(repository.clone(), Arc::new(TestCipher), transport.clone());
    let first = Uuid::now_v7();
    let second = Uuid::now_v7();
    for correlation in [first, second] {
        let input = DraftInput {
            correlation,
            revision: 1,
            reply_to: None,
            content: serde_json::json!(
            {
                "message_id": format!("{correlation}@example.net"),
                "message": {
                    "link_id": binding.link_id,
                    "subject": "deadline",
                    "to": [
                        {
                            "email": "recipient@example.net",
                            "name": null,
                            "photo_url": null
                        }
                    ],
                    "body_text": "payload"
                },
                "from": {
                    "email": "owner@example.net",
                    "name": null,
                    "photo_url": null
                },
                "parent_message_id": null,
                "references": null
            }
            ),
        };
        engine
            .execute(binding, Operation::CreateDraft { input })
            .await
            .unwrap();
    }
    let first_id = format!("m:{first}");
    assert_eq!(
        engine
            .execute(
                binding,
                Operation::Submit {
                    id: first_id.clone()
                }
            )
            .await
            .unwrap(),
        serde_json::json!("unknown")
    );
    let until = repository.state.lock().unwrap().send_penalty_until.unwrap();
    assert!(until > Utc::now() + Duration::minutes(9));
    assert_eq!(
        engine
            .execute(
                binding,
                Operation::Submit {
                    id: format!("m:{second}")
                }
            )
            .await
            .unwrap_err(),
        Error::ConnectionUnavailable
    );
    assert_eq!(
        engine
            .execute(binding, Operation::Submit { id: first_id })
            .await
            .unwrap(),
        serde_json::json!("unknown")
    );
    assert_eq!(transport.submissions.load(Ordering::Acquire), 1);
}

#[test]
fn interrupted_uidvalidity_reset_keeps_the_committed_view_until_a_complete_pass() {
    let mut state = AccountState::default();
    let folder = Folder {
        sync_enabled: true,
        id: "inbox".into(),
        parent_id: None,
        name: "INBOX".into(),
        role: FolderRole::Inbox,
        has_children: false,
        total_items: Some(1),
    };
    let source=b"From: sender@example.net\r\nMessage-ID: <epoch-interrupted@example.net>\r\nSubject: stable\r\n\r\n".to_vec();
    let message = RemoteMessage {
        gmail_labels: None,
        uid: 1,
        flags: Vec::new(),
        mime: source.into(),
        size: 80,
        received_at: Utc.timestamp_opt(1_700_000_000, 0).unwrap(),
        modseq: None,
        gmail_message_id: None,
        native_message_id: None,
        native_thread_id: None,
    };
    merge_snapshot(
        &mut state,
        vec![RemoteFolder {
            virtual_label: None,
            uid_next: Some(2),
            phantom: None,
            detected_role: None,
            monitored: true,
            folder: folder.clone(),
            path: "INBOX".into(),
            uid_validity: 10,
            highest_modseq: None,
            sync_tier: SyncTier::Full,
            messages: vec![message.clone()],
        }],
    )
    .unwrap();
    let id = state.messages.keys().next().unwrap().clone();
    let cursor = changes(&state, "inbox", None).unwrap().position;
    let marker = super::super::folder_health::PhantomFolder::failed(
        None,
        super::super::folder_health::FolderStatus {
            uid_validity: Some(20),
            uid_next: Some(5),
            messages: 1,
        },
        Utc::now().timestamp_millis(),
    );
    // A tagged SELECT refusal after STATUS observes the replacement epoch cannot erase the prior committed view.
    merge_snapshot(
        &mut state,
        vec![RemoteFolder {
            virtual_label: None,
            uid_next: Some(2),
            phantom: Some(marker),
            detected_role: None,
            monitored: false,
            folder: folder.clone(),
            path: "INBOX".into(),
            uid_validity: 10,
            highest_modseq: None,
            sync_tier: SyncTier::Full,
            messages: Vec::new(),
        }],
    )
    .unwrap();
    assert!(state.messages.contains_key(&id));
    assert_eq!(state.folders["inbox"].uid_validity, 10);
    assert!(changes(&state, "inbox", Some(&cursor)).is_ok());
    let mut replacement = message;
    replacement.uid = 4;
    merge_snapshot(
        &mut state,
        vec![RemoteFolder {
            virtual_label: None,
            uid_next: Some(5),
            phantom: None,
            detected_role: None,
            monitored: true,
            folder,
            path: "INBOX".into(),
            uid_validity: 20,
            highest_modseq: None,
            sync_tier: SyncTier::Full,
            messages: vec![replacement],
        }],
    )
    .unwrap();
    assert_eq!(state.messages.keys().next(), Some(&id));
    assert!(state.folders["inbox"].phantom.is_none());
    assert!(matches!(
        changes(&state, "inbox", Some(&cursor)),
        Err(Error::CursorOutdated)
    ));
}

mod gmail;

#[tokio::test]
async fn ambiguous_sent_append_is_fenced_across_restart_even_with_blind_search_and_many_later_messages()
 {
    let repository = Arc::new(MemoryRepository {
        state: std::sync::Mutex::new(AccountState::default()),
        saved_unknown: AtomicBool::new(false),
        owner_available: AtomicBool::new(true),
        owner_claims: std::sync::atomic::AtomicU32::new(0),
        owner_gate: std::sync::Mutex::new(None),
        owner_errors: std::sync::atomic::AtomicU32::new(0),
        releases: std::sync::atomic::AtomicU32::new(0),
        acquire_gate: None,
    });
    let transport = Arc::new(UncertainTransport {
        repository: repository.clone(),
        submissions: std::sync::atomic::AtomicU32::new(0),
        deadline: AtomicBool::new(false),
        sent_found: std::sync::Mutex::new(std::collections::BTreeSet::new()),
        submission_deadline: std::sync::Mutex::new(None),
        provider_work: None,
    });
    let binding = Binding {
        link_id: Uuid::now_v7(),
        sync_generation: 1,
        grant_generation: 1,
    };
    let id = "sent-once".to_owned();
    let correlation = Uuid::now_v7();
    let input = DraftInput {
        correlation,
        revision: 1,
        reply_to: None,
        content: serde_json::json!(
        {
            "message_id": "sent-once@example.net",
            "message": {
                "link_id": binding.link_id,
                "subject": "test",
                "to": [
                    {
                        "email": "recipient@example.net",
                        "name": null,
                        "photo_url": null
                    }
                ],
                "body_text": "readable fallback"
            },
            "from": {
                "email": "owner@example.net",
                "name": null,
                "photo_url": null
            },
            "parent_message_id": null,
            "references": null
        }
        ),
    };
    let mut draft = new_draft(&AccountState::default(), id.clone(), input).unwrap();
    draft.submission = Some(SubmissionOutcome::Accepted);
    draft.sent_copy_pending = true;
    draft.draft.is_draft = false;
    let send: SendRequest = serde_json::from_value(draft.input.content.clone()).unwrap();
    let mime = send.build_mime().unwrap();
    let fallback = Message {
        id: id.clone(),
        thread_id: "thread".into(),
        folder_id: "virtual:sent".into(),
        flags: vec!["\\Seen".into()],
        tags: vec![],
        version: "sent".into(),
        mime_base64: STANDARD.encode(&mime),
        source_complete: true,
        size: mime.len() as u32,
        received_at: Utc::now(),
        is_sent: true,
        draft_correlation: Some(correlation),
        classification: None,
    };
    {
        let mut state = repository.state.lock().unwrap();
        state.drafts.insert(id.clone(), draft);
        state.messages.insert(id.clone(), fallback.clone());
    }
    let engine = Engine::new(repository.clone(), Arc::new(TestCipher), transport.clone());
    let credentials = TestCipher
        .decrypt(binding.link_id, "owner", &[])
        .await
        .unwrap();
    let mut account = repository.acquire(binding).await.unwrap();
    engine
        .reconcile_sent(&mut account, &credentials)
        .await
        .unwrap();
    assert_eq!(transport.submissions.load(Ordering::Acquire), 1);
    assert!(account.state.drafts[&id].sent_copy_pending);
    // Simulate a server whose Message-ID SEARCH is blind and whose recent UID window is displaced.
    {
        let mut state = repository.state.lock().unwrap();
        for index in 0..250 {
            let mut later = fallback.clone();
            later.id = format!("later-{index}");
            state.messages.insert(later.id.clone(), later);
        }
    }
    let restarted = Engine::new(repository.clone(), Arc::new(TestCipher), transport.clone());
    let mut account = repository.acquire(binding).await.unwrap();
    restarted
        .reconcile_sent(&mut account, &credentials)
        .await
        .unwrap();
    assert_eq!(transport.submissions.load(Ordering::Acquire), 1);
    assert!(account.state.drafts[&id].sent_copy_attempted);
    assert!(account.state.drafts[&id].sent_copy_pending);
    let readable: Option<Message> = serde_json::from_value(
        restarted
            .execute(binding, Operation::Message { id })
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(readable.unwrap().source_complete);
}

#[tokio::test]
async fn an_actor_that_loses_its_first_owner_claim_exits_instead_of_holding_capacity() {
    let repository = Arc::new(MemoryRepository {
        state: std::sync::Mutex::new(AccountState::default()),
        saved_unknown: AtomicBool::new(false),
        owner_available: AtomicBool::new(false),
        owner_claims: std::sync::atomic::AtomicU32::new(0),
        owner_gate: std::sync::Mutex::new(None),
        owner_errors: std::sync::atomic::AtomicU32::new(0),
        releases: std::sync::atomic::AtomicU32::new(0),
        acquire_gate: None,
    });
    let transport = Arc::new(UncertainTransport {
        repository: repository.clone(),
        submissions: std::sync::atomic::AtomicU32::new(0),
        deadline: AtomicBool::new(false),
        sent_found: std::sync::Mutex::new(std::collections::BTreeSet::new()),
        submission_deadline: std::sync::Mutex::new(None),
        provider_work: None,
    });
    let engine = Engine::new(repository, Arc::new(TestCipher), transport.clone());
    let binding = Binding {
        link_id: Uuid::now_v7(),
        sync_generation: 1,
        grant_generation: 1,
    };
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(1),
        engine.run_account(binding, tokio_util::sync::CancellationToken::new()),
    )
    .await
    .expect("a replica loser must release its local slot immediately");
    assert!(result.is_ok());
    assert_eq!(transport.submissions.load(Ordering::Acquire), 0);
}
