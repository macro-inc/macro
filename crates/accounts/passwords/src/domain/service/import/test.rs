use super::*;
use crate::domain::service::test::fakes::*;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use std::sync::atomic::Ordering;

fn fixture() -> (
    PasswordService,
    Arc<FakeRepository>,
    Arc<FakeProvider>,
    Actor,
    TeamId,
) {
    let repository = Arc::new(FakeRepository::new());
    let provider = Arc::new(FakeProvider::new());
    let actor = Actor {
        user_id: MacroUserIdStr::parse_from_str("macro|import@example.test")
            .unwrap()
            .into_owned(),
    };
    let team = TeamId(Uuid::from_u128(1));
    repository
        .memberships
        .lock()
        .unwrap()
        .insert(actor.user_id.to_string(), vec![team]);
    let service = PasswordService {
        repository: repository.clone(),
        provider: provider.clone(),
        availability: Arc::new(FakeAvailability),
    };
    (service, repository, provider, actor, team)
}

fn batch() -> ImportBatch {
    serde_json::from_value(serde_json::json!({
        "format": "bitwarden_json", "target": {"kind":"new","name":"Synthetic destination"},
        "private":false,
        "folders":[{"key":"a","name":"Synthetic parent"},{"key":"b","name":"Synthetic child","parentKey":"a"}],
        "items":[{"sourceKey":"first","name":"synthetic-name-sentinel","kind":"login","folderKey":"b","favorite":true,
            "values":{"username":"synthetic-secret-sentinel","password":"synthetic-secret-sentinel","notes":"","fields":[]},
            "totp":"JBSWY3DPEHPK3PXP"}]
    })).unwrap()
}

#[tokio::test]
async fn concurrent_items_finish_out_of_order_but_results_keep_input_order() {
    let (service, _, provider, actor, team) = fixture();
    let import = Uuid::now_v7();
    let mut input = batch();
    let mut second = batch().items.remove(0);
    second.source_key = "second".to_owned().try_into().unwrap();
    input.items.push(second);
    let first_id = derive_v7(import, "item", "first");
    let second_id = derive_v7(import, "item", "second");
    let first = Arc::new(WriteGate::new());
    let second = Arc::new(WriteGate::new());
    provider
        .write_gates
        .lock()
        .unwrap()
        .extend([(first_id, first.clone()), (second_id, second.clone())]);
    let control = async {
        first.started.notified().await;
        second.started.notified().await;
        second.release.add_permits(1);
        second.finished.notified().await;
        first.release.add_permits(1);
    };
    let (result, ()) = tokio::time::timeout(std::time::Duration::from_secs(2), async {
        tokio::join!(service.import_batch(&actor, team, import, input), control)
    })
    .await
    .expect("two item writes must overlap");
    let result = result.unwrap();
    assert_eq!(
        provider.writes_completed.lock().unwrap().as_slice(),
        [second_id, first_id]
    );
    assert_eq!(result.items[0].item_id, Some(ItemId(first_id)));
    assert_eq!(result.items[1].item_id, Some(ItemId(second_id)));
    assert!(
        result
            .items
            .iter()
            .all(|item| item.outcome == ImportOutcome::Created)
    );
}

#[test]
fn derived_ids_preserve_timestamp_version_variant_and_separate_namespaces() {
    let import = Uuid::parse_str("01956321-1234-7abc-89ab-0123456789ab").unwrap();
    let item = derive_v7(import, "item", "one");
    assert_eq!(item, derive_v7(import, "item", "one"));
    assert_eq!(&item.as_bytes()[..6], &import.as_bytes()[..6]);
    assert_eq!(item.get_version_num(), 7);
    assert_eq!(item.get_variant(), uuid::Variant::RFC4122);
    assert_ne!(item, derive_v7(import, "folder", "one"));
    assert_ne!(item, derive_v7(import, "target", "one"));
    assert_ne!(item, derive_v7(import, "item", "two"));
    assert_ne!(item, derive_v7(Uuid::now_v7(), "item", "one"));
    assert_eq!(item.to_string(), "01956321-1234-72c0-af51-e460858aa7f4");
}

#[tokio::test]
async fn retry_keeps_item_folder_grants_and_totp_without_provider_writes() {
    let (service, repository, provider, actor, team) = fixture();
    let import = Uuid::now_v7();
    let first = service
        .import_batch(&actor, team, import, batch())
        .await
        .unwrap();
    assert_eq!(first.items[0].outcome, ImportOutcome::Created);
    let id = first.items[0].item_id.unwrap();
    let record = repository.get(team, id).await.unwrap();
    assert_eq!(record.metadata.folder_id, Some(first.folders[1].folder_id));
    assert!(record.metadata.favorite);
    assert_eq!(record.grants.len(), 1);
    assert!(record.metadata.has_totp);
    let key = record.totp_key_id;
    let writes = provider.stored.lock().unwrap().len();
    let target = first.target_folder_id.unwrap();
    repository
        .folders
        .lock()
        .unwrap()
        .get_mut(&(team, target))
        .unwrap()
        .name = "Renamed destination".into();
    repository
        .folders
        .lock()
        .unwrap()
        .get_mut(&(team, first.folders[1].folder_id))
        .unwrap()
        .parent_id = None;
    let calls = provider.calls.load(Ordering::SeqCst);
    let retry = service
        .import_batch(&actor, team, import, batch())
        .await
        .unwrap();
    assert_eq!(retry.items[0].outcome, ImportOutcome::AlreadyPresent);
    assert_eq!(retry.items[0].item_id, Some(id));
    assert_eq!(retry.target_folder_id, first.target_folder_id);
    assert_eq!(retry.folders[1].folder_id, first.folders[1].folder_id);
    assert_eq!(repository.get(team, id).await.unwrap().totp_key_id, key);
    assert_eq!(provider.stored.lock().unwrap().len(), writes);
    // Reconciliation consults provider version only; it never enrolls or rewrites.
    assert_eq!(provider.calls.load(Ordering::SeqCst), calls + 1);
    assert_eq!(provider.totp_seeds.lock().unwrap().len(), 1);
    let folders = repository.folders.lock().unwrap();
    assert_eq!(folders[&(team, target)].name, "Renamed destination");
    assert_eq!(folders[&(team, first.folders[1].folder_id)].parent_id, None);
    let audits = repository.imports.lock().unwrap();
    assert_eq!(audits.len(), 2);
    assert_eq!(audits[0].3.created, 1);
    assert_eq!(audits[1].3.already_present, 1);
}

#[tokio::test]
async fn private_root_existing_and_folder_nesting_follow_target() {
    let (service, repository, _, actor, team) = fixture();
    let mut root = batch();
    root.target = ImportTarget::Root;
    root.private = true;
    let result = service
        .import_batch(&actor, team, Uuid::now_v7(), root)
        .await
        .unwrap();
    assert!(result.target_folder_id.is_none());
    let record = repository
        .get(team, result.items[0].item_id.unwrap())
        .await
        .unwrap();
    assert!(record.grants.is_empty());
    assert_eq!(
        repository.folders.lock().unwrap()[&(team, result.folders[1].folder_id)].parent_id,
        Some(result.folders[0].folder_id)
    );
    let mut existing = batch();
    existing.target = ImportTarget::Existing {
        folder_id: result.folders[0].folder_id,
    };
    let nested = service
        .import_batch(&actor, team, Uuid::now_v7(), existing)
        .await
        .unwrap();
    assert_eq!(
        repository.folders.lock().unwrap()[&(team, nested.folders[0].folder_id)].parent_id,
        nested.target_folder_id
    );
    let mut foreign = batch();
    foreign.target = ImportTarget::Existing {
        folder_id: Uuid::now_v7(),
    };
    assert!(matches!(
        service
            .import_batch(&actor, team, Uuid::now_v7(), foreign)
            .await,
        Err(Error::Invalid)
    ));
}

#[tokio::test]
async fn partial_failures_and_busy_return_independent_retryable_results() {
    let (service, repository, _, actor, team) = fixture();
    let import = Uuid::now_v7();
    let mut input = batch();
    input.items[0].name = String::new();
    let mut busy = batch().items.remove(0);
    busy.source_key = "busy".to_owned().try_into().unwrap();
    let busy_id = derive_v7(import, "item", "busy");
    repository.busy_items.lock().unwrap().insert(busy_id);
    input.items.push(busy);
    let mut good = batch().items.remove(0);
    good.source_key = "good".to_owned().try_into().unwrap();
    input.items.push(good);
    let result = service
        .import_batch(&actor, team, import, input)
        .await
        .unwrap();
    assert_eq!(
        result.items[0].error_code,
        Some(ImportErrorCode::InvalidRequest)
    );
    assert_eq!(result.items[1].error_code, Some(ImportErrorCode::Busy));
    assert_eq!(result.items[2].outcome, ImportOutcome::Created);
    assert_eq!(repository.records.lock().unwrap().len(), 1);
    let audits = repository.imports.lock().unwrap();
    assert_eq!(audits[0].3.failed, 2);
    assert_eq!(audits[0].3.created, 1);
}

#[tokio::test]
async fn totp_failure_keeps_created_item_and_retry_finishes_enrollment() {
    let (service, repository, provider, actor, team) = fixture();
    let import = Uuid::now_v7();
    provider.fail_set.store(true, Ordering::SeqCst);
    let first = service
        .import_batch(&actor, team, import, batch())
        .await
        .unwrap();
    assert_eq!(first.items[0].outcome, ImportOutcome::Failed);
    let id = first.items[0].item_id.unwrap();
    assert!(!repository.get(team, id).await.unwrap().metadata.has_totp);
    provider.fail_set.store(false, Ordering::SeqCst);
    let retry = service
        .import_batch(&actor, team, import, batch())
        .await
        .unwrap();
    assert_eq!(retry.items[0].outcome, ImportOutcome::AlreadyPresent);
    assert_eq!(retry.items[0].item_id, Some(id));
    assert!(repository.get(team, id).await.unwrap().metadata.has_totp);
}

#[tokio::test]
async fn admission_denies_nonmembers_and_session_shaped_agents_before_leases() {
    let (service, repository, provider, actor, team) = fixture();
    repository
        .agents
        .lock()
        .unwrap()
        .insert(actor.user_id.to_string());
    assert!(matches!(
        service
            .import_batch(&actor, team, Uuid::now_v7(), batch())
            .await,
        Err(Error::Forbidden)
    ));
    repository.agents.lock().unwrap().clear();
    repository.memberships.lock().unwrap().clear();
    assert!(matches!(
        service
            .import_batch(&actor, team, Uuid::now_v7(), batch())
            .await,
        Err(Error::NotFound)
    ));
    assert_eq!(repository.lock_calls.load(Ordering::SeqCst), 0);
    assert_eq!(provider.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn invalid_batch_structure_and_limits_create_nothing() {
    let (service, repository, provider, actor, team) = fixture();
    let mut cases = [batch(), batch(), batch(), batch()];
    cases[0].folders.swap(0, 1);
    cases[1]
        .folders
        .push(serde_json::from_value(serde_json::json!({"key":"a","name":"Duplicate"})).unwrap());
    // Distinct keys, so only the count limits can refuse these two.
    cases[2].items = (0..26)
        .map(|index| {
            let mut item = batch().items.remove(0);
            item.source_key = format!("item-{index}").try_into().unwrap();
            item.folder_key = None;
            item
        })
        .collect();
    cases[2].folders = vec![];
    cases[3].folders = (0..201)
        .map(|index| {
            serde_json::from_value(
                serde_json::json!({"key": format!("folder-{index}"), "name": "Synthetic"}),
            )
            .unwrap()
        })
        .collect();
    cases[3].items[0].folder_key = None;
    for case in cases {
        assert!(matches!(
            service
                .import_batch(&actor, team, Uuid::now_v7(), case)
                .await,
            Err(Error::Invalid)
        ));
    }
    assert!(matches!(
        service
            .import_batch(&actor, team, Uuid::nil(), batch())
            .await,
        Err(Error::Invalid)
    ));
    assert!(repository.records.lock().unwrap().is_empty());
    assert!(repository.folders.lock().unwrap().is_empty());
    assert_eq!(provider.calls.load(Ordering::SeqCst), 0);
    for key in ["".to_owned(), "a".repeat(201), "source\nkey".into()] {
        assert!(ImportKey::try_from(key).is_err());
    }
}

#[tokio::test]
async fn trace_and_errors_never_contain_item_metadata_or_secrets() {
    use std::io::Write;
    use tracing::instrument::WithSubscriber;
    use tracing_subscriber::fmt::format::FmtSpan;
    #[derive(Clone)]
    struct Capture(Arc<std::sync::Mutex<Vec<u8>>>);
    impl Write for Capture {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let bytes = Arc::new(std::sync::Mutex::new(Vec::new()));
    let writer = Capture(bytes.clone());
    let subscriber = tracing_subscriber::fmt()
        .with_ansi(false)
        .without_time()
        .with_span_events(FmtSpan::NEW | FmtSpan::CLOSE)
        .with_writer(move || writer.clone())
        .finish();
    let (service, repository, _, actor, team) = fixture();
    repository.fail_import_audit.store(true, Ordering::SeqCst);
    let mut input = batch();
    input.items[0].totp = Some(SecretString("synthetic-secret-sentinel".into()));
    let result = service
        .import_batch(&actor, team, Uuid::now_v7(), input)
        .with_subscriber(subscriber)
        .await
        .unwrap();
    assert_eq!(
        result.items[0].error_code,
        Some(ImportErrorCode::InvalidRequest)
    );
    let output = String::from_utf8(bytes.lock().unwrap().clone()).unwrap();
    assert!(output.contains("passwords.import.batch"));
    assert!(output.contains("failed=1"));
    assert!(output.contains("audit_failed=true"));
    for sentinel in ["synthetic-name-sentinel", "synthetic-secret-sentinel"] {
        assert!(!output.contains(sentinel));
        for error in [
            Error::Invalid,
            Error::NotFound,
            Error::Forbidden,
            Error::Busy,
            Error::Conflict,
            Error::FolderMissing,
            Error::Unavailable,
            Error::NotProvisioned,
        ] {
            assert!(!error.to_string().contains(sentinel));
            assert!(!format!("{error:?}").contains(sentinel));
        }
    }
}

#[tokio::test]
async fn disabled_rollout_denies_batch_before_repository_and_provider_work() {
    struct FlagOff;
    #[async_trait::async_trait]
    impl Availability for FlagOff {
        async fn require_enabled(&self, _: &Actor) -> Result<(), Error> {
            Err(Error::NotFound)
        }
        fn require_provider(&self) -> Result<(), Error> {
            Ok(())
        }
    }
    let (mut service, repository, provider, actor, team) = fixture();
    service.availability = Arc::new(FlagOff);
    assert!(matches!(
        service
            .import_batch(&actor, team, Uuid::now_v7(), batch())
            .await,
        Err(Error::NotFound)
    ));
    assert_eq!(repository.calls.load(Ordering::SeqCst), 0);
    assert_eq!(provider.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn empty_and_fully_failed_batches_are_audited_without_items() {
    let (service, repository, provider, actor, team) = fixture();
    let mut empty = batch();
    empty.target = ImportTarget::Root;
    empty.folders.clear();
    empty.items.clear();
    let result = service
        .import_batch(&actor, team, Uuid::now_v7(), empty)
        .await
        .unwrap();
    assert!(result.items.is_empty());
    let mut invalid = batch();
    invalid.target = ImportTarget::Root;
    invalid.folders.clear();
    invalid.items[0].folder_key = None;
    invalid.items[0].name.clear();
    let result = service
        .import_batch(&actor, team, Uuid::now_v7(), invalid)
        .await
        .unwrap();
    assert_eq!(result.items[0].outcome, ImportOutcome::Failed);
    assert!(repository.records.lock().unwrap().is_empty());
    assert_eq!(provider.calls.load(Ordering::SeqCst), 0);
    let audits = repository.imports.lock().unwrap();
    assert_eq!(audits.len(), 2);
    assert_eq!(audits[0].3.failed, 0);
    assert_eq!(audits[1].3.failed, 1);
}

#[tokio::test]
async fn folder_deleted_after_the_folder_phase_is_folder_missing() {
    let (service, repository, _, actor, team) = fixture();
    repository
        .forget_ensured_folders
        .store(true, Ordering::SeqCst);
    let result = service
        .import_batch(&actor, team, Uuid::now_v7(), batch())
        .await
        .unwrap();
    assert_eq!(result.items[0].outcome, ImportOutcome::Failed);
    assert_eq!(
        result.items[0].error_code,
        Some(ImportErrorCode::FolderMissing)
    );
}

#[tokio::test]
async fn items_recheck_membership_once_after_the_batch_admission() {
    let (service, repository, _, actor, team) = fixture();
    let mut batch: ImportBatch = serde_json::from_value(serde_json::json!({
        "format": "bitwarden_csv", "target": {"kind":"root"}, "private": false, "folders": [],
        "items": [
            {"sourceKey":"one","name":"Synthetic one","kind":"note","favorite":false,
                "values":{"username":"","password":"","notes":"synthetic","fields":[]}},
            {"sourceKey":"two","name":"Synthetic two","kind":"note","favorite":false,
                "values":{"username":"","password":"","notes":"synthetic","fields":[]}},
            {"sourceKey":"three","name":"Synthetic three","kind":"note","favorite":false,
                "values":{"username":"","password":"","notes":"synthetic","fields":[]}}
        ]
    }))
    .unwrap();
    batch.private = true;
    service
        .import_batch(&actor, team, Uuid::now_v7(), batch)
        .await
        .unwrap();
    // Batch admission, recheck under its lease, then a fresh check for each item.
    assert_eq!(repository.team_lookups.load(Ordering::SeqCst), 2 + 3);
}

#[tokio::test]
async fn match_names_finds_visible_items_by_name_and_bounds_the_request() {
    let (service, _, _, actor, team) = fixture();
    service
        .import_batch(&actor, team, Uuid::now_v7(), batch())
        .await
        .unwrap();
    let found = service
        .match_names(
            &actor,
            team,
            vec!["synthetic-name-sentinel".into(), "absent".into()],
        )
        .await
        .unwrap();
    assert_eq!(found.len(), 1);
    assert!(matches!(
        service
            .match_names(
                &actor,
                team,
                vec!["x".into(); vault::MAX_IMPORT_MATCH_NAMES + 1]
            )
            .await,
        Err(Error::Invalid)
    ));
    assert!(matches!(
        service
            .match_names(
                &actor,
                team,
                vec!["x".repeat(vault::MAX_NAME_BYTES * MAX_LOWERCASE_GROWTH + 1)]
            )
            .await,
        Err(Error::Invalid)
    ));
}

#[tokio::test]
async fn match_names_accepts_a_lowercased_name_longer_than_the_original() {
    let (service, _, _, actor, team) = fixture();
    // 100 'İ' (2 bytes each) is a valid name; lower-cased it is 300 bytes.
    let name = "İ".repeat(100).to_lowercase();
    assert!(name.len() > vault::MAX_NAME_BYTES);
    assert!(service.match_names(&actor, team, vec![name]).await.is_ok());
}

#[tokio::test]
async fn concurrency_is_bounded_by_available_pool_capacity() {
    let (service, repository, provider, actor, team) = fixture();
    repository.import_capacity.store(2, Ordering::SeqCst);
    let import = Uuid::now_v7();
    let mut input = batch();
    input.items = (0..7)
        .map(|index| {
            let mut item = batch().items.remove(0);
            item.source_key = format!("bounded-{index}").try_into().unwrap();
            item
        })
        .collect();
    let gates: Vec<_> = (0..7)
        .map(|index| {
            let gate = Arc::new(WriteGate::new());
            provider.write_gates.lock().unwrap().insert(
                derive_v7(import, "item", &format!("bounded-{index}")),
                gate.clone(),
            );
            gate
        })
        .collect();
    let control = async {
        gates[0].started.notified().await;
        gates[1].started.notified().await;
        assert_eq!(provider.max_writes_in_flight.load(Ordering::SeqCst), 2);
        assert_eq!(repository.live_leases.load(Ordering::SeqCst), 1);
        for gate in &gates {
            gate.release.add_permits(1);
        }
    };
    let (result, ()) = tokio::time::timeout(std::time::Duration::from_secs(2), async {
        tokio::join!(
            service.import_batch_concurrent(
                &actor,
                team,
                import,
                input,
                NonZeroUsize::new(4).unwrap()
            ),
            control
        )
    })
    .await
    .expect("bounded imports must drain");
    assert!(
        result
            .unwrap()
            .items
            .iter()
            .all(|item| item.outcome == ImportOutcome::Created)
    );
    assert_eq!(provider.max_writes_in_flight.load(Ordering::SeqCst), 2);
    assert_eq!(repository.live_leases.load(Ordering::SeqCst), 0);
    assert_eq!(repository.lock_calls.load(Ordering::SeqCst), 1);
    assert_eq!(provider.totp_seeds.lock().unwrap().len(), 7);
}

#[tokio::test]
async fn folder_disappearing_before_a_queued_item_starts_fails_only_that_item() {
    let (service, repository, provider, actor, team) = fixture();
    repository.import_capacity.store(2, Ordering::SeqCst);
    let import = Uuid::now_v7();
    let mut input = batch();
    input.target = ImportTarget::Root;
    input.folders.truncate(1);
    input.items[0].folder_key = None;
    let mut second = batch().items.remove(0);
    second.source_key = "second".to_owned().try_into().unwrap();
    second.folder_key = None;
    input.items.push(second);
    let mut affected = batch().items.remove(0);
    affected.source_key = "affected".to_owned().try_into().unwrap();
    affected.folder_key = Some("a".to_owned().try_into().unwrap());
    input.items.push(affected);
    let first = Arc::new(WriteGate::new());
    let second = Arc::new(WriteGate::new());
    provider.write_gates.lock().unwrap().extend([
        (derive_v7(import, "item", "first"), first.clone()),
        (derive_v7(import, "item", "second"), second.clone()),
    ]);
    let control = async {
        first.started.notified().await;
        second.started.notified().await;
        repository
            .folders
            .lock()
            .unwrap()
            .remove(&(team, derive_v7(import, "folder", "a")));
        first.release.add_permits(1);
        second.release.add_permits(1);
    };
    let (result, ()) = tokio::time::timeout(std::time::Duration::from_secs(2), async {
        tokio::join!(service.import_batch(&actor, team, import, input), control)
    })
    .await
    .expect("deleted folders must not hang imports");
    let result = result.unwrap();
    assert_eq!(result.items[0].outcome, ImportOutcome::Created);
    assert_eq!(result.items[1].outcome, ImportOutcome::Created);
    assert_eq!(
        result.items[2].error_code,
        Some(ImportErrorCode::FolderMissing)
    );
    let counts = repository.imports.lock().unwrap()[0].3;
    assert_eq!((counts.created, counts.failed), (2, 1));
    assert_eq!(provider.stored.lock().unwrap().len(), 2);
    assert_eq!(repository.live_leases.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn membership_is_rechecked_when_a_queued_item_starts() {
    let (service, repository, provider, actor, team) = fixture();
    repository.import_capacity.store(1, Ordering::SeqCst);
    let import = Uuid::now_v7();
    let mut input = batch();
    input.items[0].totp = None;
    let mut next = batch().items.remove(0);
    next.source_key = "next".to_owned().try_into().unwrap();
    input.items.push(next);
    let gate = Arc::new(WriteGate::new());
    provider
        .write_gates
        .lock()
        .unwrap()
        .insert(derive_v7(import, "item", "first"), gate.clone());
    let control = async {
        gate.started.notified().await;
        repository.memberships.lock().unwrap().clear();
        gate.release.add_permits(1);
    };
    let (result, ()) = tokio::join!(service.import_batch(&actor, team, import, input), control);
    let result = result.unwrap();
    assert_eq!(result.items[0].outcome, ImportOutcome::Created);
    assert_eq!(result.items[1].error_code, Some(ImportErrorCode::NotFound));
    assert_eq!(provider.stored.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn cancellation_drops_item_futures_and_the_shared_lease() {
    let (service, repository, provider, actor, team) = fixture();
    let import = Uuid::now_v7();
    let gate = Arc::new(WriteGate::new());
    provider
        .write_gates
        .lock()
        .unwrap()
        .insert(derive_v7(import, "item", "first"), gate.clone());
    let mut work = Box::pin(service.import_batch(&actor, team, import, batch()));
    tokio::select! {
        _ = gate.started.notified() => {},
        _ = &mut work => panic!("write gate must hold the import"),
    }
    assert_eq!(repository.live_leases.load(Ordering::SeqCst), 1);
    drop(work);
    assert_eq!(repository.live_leases.load(Ordering::SeqCst), 0);
    assert_eq!(provider.writes_in_flight.load(Ordering::SeqCst), 0);
    assert!(provider.stored.lock().unwrap().is_empty());
}

#[tokio::test]
async fn panic_and_folder_error_release_the_shared_lease() {
    use futures::FutureExt;
    let (service, repository, provider, actor, team) = fixture();
    let import = Uuid::now_v7();
    let gate = Arc::new(WriteGate::new());
    gate.panic.store(true, Ordering::SeqCst);
    gate.release.add_permits(1);
    provider
        .write_gates
        .lock()
        .unwrap()
        .insert(derive_v7(import, "item", "first"), gate);
    let result = std::panic::AssertUnwindSafe(service.import_batch(&actor, team, import, batch()))
        .catch_unwind()
        .await;
    assert!(result.is_err());
    assert_eq!(repository.live_leases.load(Ordering::SeqCst), 0);
    assert_eq!(provider.writes_in_flight.load(Ordering::SeqCst), 0);
    let mut invalid = batch();
    invalid.target = ImportTarget::New {
        name: String::new(),
    };
    assert!(matches!(
        service
            .import_batch(&actor, team, Uuid::now_v7(), invalid)
            .await,
        Err(Error::Invalid)
    ));
    assert_eq!(repository.live_leases.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn imported_favorite_belongs_to_importer_and_retry_does_not_restore_it() {
    let (service, repository, _, actor, team) = fixture();
    let viewer = Actor {
        user_id: MacroUserIdStr::parse_from_str("macro|viewer@example.test")
            .expect("fixture")
            .into_owned(),
    };
    repository
        .memberships
        .lock()
        .expect("fixture")
        .insert(viewer.user_id.to_string(), vec![team]);
    let import = Uuid::now_v7();
    service
        .import_batch(&actor, team, import, batch())
        .await
        .expect("import");
    let owner_items = service.list(&actor, team, "").await.expect("importer list");
    let item = &owner_items[0];
    assert!(item.favorite);
    assert!(!service.list(&viewer, team, "").await.expect("viewer list")[0].favorite);
    service
        .set_favorite(&actor, team, item.id, false)
        .await
        .expect("unfavorite");
    service
        .import_batch(&actor, team, import, batch())
        .await
        .expect("retry");
    assert!(
        !service
            .get(&actor, team, item.id)
            .await
            .expect("preference retained")
            .favorite
    );
}

#[tokio::test]
async fn unprovisioned_team_vault_fails_every_item_as_not_provisioned() {
    let (service, repository, provider, actor, team) = fixture();
    provider.unprovisioned.store(true, Ordering::SeqCst);
    let result = service
        .import_batch(&actor, team, Uuid::now_v7(), batch())
        .await
        .unwrap();
    assert_eq!(result.items[0].outcome, ImportOutcome::Failed);
    assert_eq!(
        result.items[0].error_code,
        Some(ImportErrorCode::VaultNotProvisioned)
    );
    assert!(repository.records.lock().unwrap().is_empty());
}
