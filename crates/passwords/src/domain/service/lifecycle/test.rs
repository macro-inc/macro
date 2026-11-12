use super::super::test::fakes::*;
use super::*;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use std::sync::atomic::Ordering;

struct Fixture {
    service: PasswordService,
    repository: Arc<FakeRepository>,
    provider: Arc<FakeProvider>,
    actor: Actor,
    team: TeamId,
    item: ItemId,
}
impl Fixture {
    async fn new() -> Self {
        let repository = Arc::new(FakeRepository::new());
        let provider = Arc::new(FakeProvider::new());
        let actor = Actor {
            user_id: MacroUserIdStr::parse_from_str("macro|creator@example.com")
                .unwrap()
                .into_owned(),
        };
        let team = TeamId(Uuid::now_v7());
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
        let item = service
            .create(
                &actor,
                team,
                WriteItem {
                    private: true,
                    operation_id: Uuid::now_v7(),
                    name: "Credential".into(),
                    kind: ItemKind::Login,
                    url: None,
                    folder_id: None,
                    favorite: false,
                    expected_version: None,
                    values: SecretValues {
                        username: SecretString("account".into()),
                        password: SecretString("synthetic".into()),
                        notes: SecretString(String::new()),
                        fields: vec![],
                    },
                },
            )
            .await
            .unwrap()
            .id;
        Self {
            service,
            repository,
            provider,
            actor,
            team,
            item,
        }
    }
}

#[tokio::test]
async fn failed_explicit_delete_retains_retry_and_enabled_cleanup_finishes_it() {
    let f = Fixture::new().await;
    f.provider.fail_delete.store(true, Ordering::SeqCst);
    assert!(matches!(
        f.service.delete(&f.actor, f.team, f.item).await,
        Err(Error::Unavailable)
    ));
    assert!(f.repository.records.lock().unwrap()[&f.item.0].deleting);
    assert_eq!(f.service.cleanup_retired_items().await.unwrap(), 0);
    assert!(f.provider.stored.lock().unwrap().contains_key(&f.item.0));
    f.provider.fail_delete.store(false, Ordering::SeqCst);
    assert_eq!(f.service.cleanup_retired_items().await.unwrap(), 1);
    assert!(!f.provider.stored.lock().unwrap().contains_key(&f.item.0));
    assert!(f.repository.records.lock().unwrap()[&f.item.0].deleting);
}

#[tokio::test]
async fn disabled_jobs_and_internal_purge_do_no_work_and_reenable_resumes() {
    use crate::outbound::availability::*;
    use feature_flags::{FlagSnapshot, FlagValue, outbound::fake::FakeFeatureFlags};
    for result in [Ok(FlagSnapshot::default()), Err("remote failed".to_owned())] {
        let mut f = Fixture::new().await;
        f.provider.fail_delete.store(true, Ordering::SeqCst);
        assert!(f.service.delete(&f.actor, f.team, f.item).await.is_err());
        let mut flags = FakeFeatureFlags::default();
        flags.set_service(PASSWORDS_CONTEXT, result);
        f.service.availability = Arc::new(PasswordAvailability {
            flags,
            provider_configured: true,
        });
        let repo_calls = f.repository.calls.load(Ordering::SeqCst);
        let provider_calls = f.provider.calls.load(Ordering::SeqCst);
        assert!(f.service.cleanup_retired_items().await.is_err());
        assert!(f.service.cleanup_expired_totp_enrollments().await.is_err());
        assert!(f.service.purge_team(f.team).await.is_err());
        assert_eq!(f.repository.calls.load(Ordering::SeqCst), repo_calls);
        assert_eq!(f.provider.calls.load(Ordering::SeqCst), provider_calls);
        assert!(f.repository.closed_teams.lock().unwrap().is_empty());
        let mut flags = FakeFeatureFlags::default();
        flags.set_service(
            PASSWORDS_CONTEXT,
            Ok(FlagSnapshot::new([(
                PASSWORDS_FLAG.into(),
                FlagValue::Boolean(true),
            )])),
        );
        f.service.availability = Arc::new(PasswordAvailability {
            flags,
            provider_configured: true,
        });
        f.provider.fail_delete.store(false, Ordering::SeqCst);
        assert_eq!(f.service.cleanup_retired_items().await.unwrap(), 1);
    }
}

#[tokio::test]
async fn namespace_failure_retains_closed_team_and_retry_erases_metadata() {
    let f = Fixture::new().await;
    f.provider.fail_purge.store(true, Ordering::SeqCst);
    assert!(matches!(
        f.service.purge_team(f.team).await,
        Err(Error::Unavailable)
    ));
    assert!(f.repository.records.lock().unwrap().contains_key(&f.item.0));
    assert!(matches!(
        f.service
            .reveal(&f.actor, f.team, f.item, None, false)
            .await,
        Err(Error::NotFound)
    ));
    f.provider.fail_purge.store(false, Ordering::SeqCst);
    f.service.purge_team(f.team).await.unwrap();
    assert_eq!(*f.provider.purged.lock().unwrap(), vec![f.team]);
    assert!(f.repository.records.lock().unwrap().is_empty());
}

#[tokio::test]
async fn provider_disclosure_after_membership_revocation_returns_no_values() {
    let f = Fixture::new().await;
    *f.provider.revoke_on_disclosure.lock().unwrap() = Some(f.repository.clone());
    assert!(matches!(
        f.service
            .reveal(&f.actor, f.team, f.item, None, false)
            .await,
        Err(Error::NotFound)
    ));
}

#[tokio::test(start_paused = true)]
async fn timed_out_item_erasure_retains_values_and_continues_to_another_team() {
    let f = Fixture::new().await;
    let second_team = TeamId(Uuid::now_v7());
    let second_item = ItemId(Uuid::now_v7());
    f.repository
        .memberships
        .lock()
        .unwrap()
        .get_mut(f.actor.user_id.as_ref())
        .unwrap()
        .push(second_team);
    let mut record = f.repository.records.lock().unwrap()[&f.item.0].clone();
    record.metadata.id = second_item;
    record.metadata.team_id = second_team;
    f.repository
        .records
        .lock()
        .unwrap()
        .insert(second_item.0, record);
    let payload = f.provider.stored.lock().unwrap()[&f.item.0].clone();
    f.provider
        .stored
        .lock()
        .unwrap()
        .insert(second_item.0, payload);
    f.provider.fail_delete.store(true, Ordering::SeqCst);
    assert!(f.service.delete(&f.actor, f.team, f.item).await.is_err());
    assert!(
        f.service
            .delete(&f.actor, second_team, second_item)
            .await
            .is_err()
    );
    f.provider.fail_delete.store(false, Ordering::SeqCst);
    f.provider.blocked_deletes.lock().unwrap().insert(f.item.0);
    let started = tokio::time::Instant::now();
    assert_eq!(f.service.cleanup_retired_items().await.unwrap(), 1);
    assert_eq!(started.elapsed(), CLEANUP_ATTEMPT_TIMEOUT);
    assert!(f.provider.stored.lock().unwrap().contains_key(&f.item.0));
    assert!(
        !f.provider
            .stored
            .lock()
            .unwrap()
            .contains_key(&second_item.0)
    );
    assert!(f.repository.records.lock().unwrap()[&f.item.0].deleting);
    f.provider.blocked_deletes.lock().unwrap().clear();
    assert_eq!(f.service.cleanup_retired_items().await.unwrap(), 1);
    assert!(!f.provider.stored.lock().unwrap().contains_key(&f.item.0));
}

#[tokio::test(start_paused = true)]
async fn timed_out_totp_erasure_preserves_quarantine_and_continues_the_pass() {
    let f = Fixture::new().await;
    let first = TotpKeyId(Uuid::now_v7());
    let second = TotpKeyId(Uuid::now_v7());
    for key in [first, second] {
        f.repository.stage_totp(f.team, f.item, key).await.unwrap();
        f.provider
            .set_totp(f.team, key, &SecretString("JBSWY3DPEHPK3PXP".into()))
            .await
            .unwrap();
    }
    assert_eq!(
        f.service.cleanup_expired_totp_enrollments().await.unwrap(),
        0,
        "first pass establishes quarantine without erasing"
    );
    assert_eq!(f.provider.totp_seeds.lock().unwrap().len(), 2);
    for enrollment in f.repository.enrollments.lock().unwrap().values_mut() {
        assert!(enrollment.cleanup_started, "quarantine remains required");
        enrollment.grace_elapsed = true; // Fake repository's explicit grace-period completion fact.
    }
    f.provider
        .blocked_totp_deletes
        .lock()
        .unwrap()
        .insert(first.0);
    let started = tokio::time::Instant::now();
    assert_eq!(
        f.service.cleanup_expired_totp_enrollments().await.unwrap(),
        1
    );
    assert_eq!(started.elapsed(), CLEANUP_ATTEMPT_TIMEOUT);
    assert!(f.provider.totp_seeds.lock().unwrap().contains_key(&first.0));
    assert!(
        !f.provider
            .totp_seeds
            .lock()
            .unwrap()
            .contains_key(&second.0)
    );
    assert!(
        f.repository
            .enrollments
            .lock()
            .unwrap()
            .contains_key(&first.0)
    );
    f.provider.blocked_totp_deletes.lock().unwrap().clear();
    assert_eq!(
        f.service.cleanup_expired_totp_enrollments().await.unwrap(),
        1
    );
}
