use super::*;

#[tokio::test]
async fn remote_message_results_recheck_access_after_io() {
    for (lost_owner, needs_reauth) in [(false, false), (true, false), (false, true)] {
        let mut state = AccountState::default();
        merge_snapshot(
            &mut state,
            vec![RemoteFolder {
                virtual_label: None,
                uid_next: Some(2),
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
                uid_validity: 1,
                highest_modseq: None,
                sync_tier: SyncTier::Full,
                messages: vec![RemoteMessage {
                    gmail_labels: None,
                    uid: 1,
                    flags: Vec::new(),
                    mime: Arc::from(b"Message-ID: <ingestion@example.net>\r\n\r\n".as_slice()),
                    size: 64,
                    received_at: Utc::now(),
                    modseq: None,
                    gmail_message_id: None,
                    native_message_id: None,
                    native_thread_id: None,
                }],
            }],
        )
        .unwrap();
        let message_id = state.messages.keys().next().unwrap().clone();
        let repository = Arc::new(MemoryRepository {
            state: std::sync::Mutex::new(state),
            saved_unknown: AtomicBool::new(false),
            owner_available: AtomicBool::new(true),
            owner_claims: std::sync::atomic::AtomicU32::new(0),
            owner_gate: std::sync::Mutex::new(None),
            owner_errors: std::sync::atomic::AtomicU32::new(0),
            releases: std::sync::atomic::AtomicU32::new(0),
            acquire_gate: None,
        });
        let (started, mut observed) = tokio::sync::mpsc::unbounded_channel();
        let control = Arc::new(ProviderWorkControl {
            source: Some(
                b"Message-ID: <ingestion@example.net>\r\nSubject: Synthetic\r\n\r\nTest body"
                    .to_vec(),
            ),
            started,
            released: tokio::sync::Semaphore::new(0),
        });
        let transport = Arc::new(UncertainTransport {
            repository: repository.clone(),
            submissions: std::sync::atomic::AtomicU32::new(0),
            deadline: AtomicBool::new(false),
            sent_found: std::sync::Mutex::new(std::collections::BTreeSet::new()),
            submission_deadline: std::sync::Mutex::new(None),
            provider_work: Some(control.clone()),
        });
        let engine = Engine::new(repository.clone(), Arc::new(TestCipher), transport);
        let binding = Binding {
            link_id: Uuid::now_v7(),
            sync_generation: 1,
            grant_generation: 1,
        };
        let mut reading = Box::pin(engine.execute(binding, Operation::Message { id: message_id }));
        assert!(futures::poll!(reading.as_mut()).is_pending());
        assert_eq!(observed.try_recv().unwrap(), binding.link_id);
        repository
            .owner_available
            .store(!lost_owner, Ordering::Release);
        repository.state.lock().unwrap().needs_reauth = needs_reauth;
        control.released.add_permits(1);
        let result = reading.await;
        if lost_owner {
            assert!(matches!(result, Err(Error::Conflict)));
        } else if needs_reauth {
            assert!(matches!(result, Err(Error::CredentialsRejected)));
        } else {
            let message: Message = serde_json::from_value(result.unwrap()).unwrap();
            assert!(message.source_complete);
            assert!(
                String::from_utf8(STANDARD.decode(message.mime_base64).unwrap())
                    .unwrap()
                    .contains("Test body")
            );
        }
        assert_eq!(repository.releases.load(Ordering::Relaxed), 0);
    }
}
