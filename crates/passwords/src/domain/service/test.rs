use super::*;
#[test]
fn owner_and_grants_are_scoped_to_the_team_and_permission() {
    use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
    let owner = MacroUserIdStr::parse_from_str("macro|owner@example.test")
        .expect("valid fixture")
        .into_owned();
    let viewer = Actor {
        user_id: MacroUserIdStr::parse_from_str("macro|viewer@example.test")
            .expect("valid fixture")
            .into_owned(),
        session_token: None,
    };
    let team = TeamId(Uuid::from_u128(1));
    let now = Utc::now();
    let mut record = Record {
        user_id: owner,
        grants: vec![Grant {
            kind: GranteeKind::User,
            id: viewer.user_id.to_string(),
            permission: Permission::View,
        }],
        deleting: false,
        revision: 0,
        totp_key_id: None,
        metadata: ItemMetadata {
            id: ItemId(Uuid::from_u128(2)),
            team_id: team,
            name: "Credential".into(),
            kind: ItemKind::Login,
            url: None,
            folder_id: None,
            favorite: false,
            version: 1,
            has_totp: false,
            shared: true,
            share_count: 0,
            created_at: now,
            updated_at: now,
            last_used_at: None,
        },
    };
    assert!(PasswordService::permission(&viewer, team, &record, false));
    assert!(!PasswordService::permission(&viewer, team, &record, true));
    record.grants = vec![Grant {
        kind: GranteeKind::Team,
        id: Uuid::from_u128(3).to_string(),
        permission: Permission::Edit,
    }];
    assert!(!PasswordService::permission(&viewer, team, &record, false));
    record.grants = vec![Grant {
        kind: GranteeKind::Team,
        id: team.0.to_string(),
        permission: Permission::Edit,
    }];
    assert!(PasswordService::permission(&viewer, team, &record, true));
}

#[path = "fakes.rs"]
pub(crate) mod fakes;
use fakes::*;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use std::sync::atomic::{AtomicBool, Ordering};

#[tokio::test]
async fn metadata_never_decrypts_and_disclosure_checks_membership_grants_and_reauthentication() {
    let repository = Arc::new(FakeRepository::new());
    let provider = Arc::new(FakeProvider::new());
    let recent = Arc::new(FakeReauthentication {
        recent: AtomicBool::new(true),
    });
    let service = PasswordService {
        repository: repository.clone(),
        provider: provider.clone(),
        reauthentication: recent.clone(),
        availability: Arc::new(FakeAvailability),
    };
    let owner = Actor {
        user_id: MacroUserIdStr::parse_from_str("macro|owner@example.test")
            .expect("valid fixture")
            .into_owned(),
        session_token: None,
    };
    let stranger = Actor {
        user_id: MacroUserIdStr::parse_from_str("macro|stranger@example.test")
            .expect("valid fixture")
            .into_owned(),
        session_token: None,
    };
    let team = TeamId(Uuid::from_u128(1));
    repository
        .memberships
        .lock()
        .expect("fixture lock")
        .insert(owner.user_id.to_string(), vec![team]);
    repository
        .memberships
        .lock()
        .expect("fixture lock")
        .insert(stranger.user_id.to_string(), vec![team]);
    let operation = Uuid::now_v7();
    let metadata = service
        .create(
            &owner,
            team,
            WriteItem {
                operation_id: operation,
                name: "Work login".into(),
                kind: ItemKind::Login,
                url: None,
                folder_id: None,
                favorite: false,
                expected_version: None,
                values: SecretValues {
                    username: SecretString("login".into()),
                    password: SecretString("sensitive-test-marker".into()),
                    notes: SecretString(String::new()),
                    fields: vec![],
                },
            },
        )
        .await
        .expect("create");
    provider.reads.store(0, Ordering::SeqCst);
    let detail = service
        .get(&owner, team, metadata.id)
        .await
        .expect("metadata detail");
    let listed = service.list(&owner, team, "").await.expect("list");
    assert_eq!(provider.reads.load(Ordering::SeqCst), 0);
    assert!(
        !serde_json::to_string(&detail)
            .expect("metadata JSON")
            .contains("sensitive-test-marker")
    );
    assert!(
        !serde_json::to_string(&listed)
            .expect("list JSON")
            .contains("sensitive-test-marker")
    );
    assert!(matches!(
        service
            .reveal(&stranger, team, metadata.id, None, false)
            .await,
        Err(Error::NotFound)
    ));
    assert_eq!(provider.reads.load(Ordering::SeqCst), 0);
    assert!(matches!(
        service
            .reveal(&owner, TeamId(Uuid::from_u128(2)), metadata.id, None, false)
            .await,
        Err(Error::NotFound)
    ));
    recent.recent.store(false, Ordering::SeqCst);
    let identifier = service
        .username(&owner, team, metadata.id, true)
        .await
        .expect("identifier does not require recent reauthentication");
    assert_eq!(
        serde_json::to_value(identifier).expect("username JSON"),
        serde_json::json!({"username":"login","version":1})
    );
    assert!(matches!(
        service.username(&stranger, team, metadata.id, false).await,
        Err(Error::NotFound)
    ));
    assert!(matches!(
        service
            .username(&owner, TeamId(Uuid::from_u128(2)), metadata.id, false)
            .await,
        Err(Error::NotFound)
    ));
    assert!(matches!(
        service
            .reveal(&owner, team, metadata.id, Some(1), true)
            .await,
        Err(Error::ReauthenticationRequired)
    ));
    assert_eq!(provider.reads.load(Ordering::SeqCst), 0);
    recent.recent.store(true, Ordering::SeqCst);
    service
        .share(
            &owner,
            team,
            metadata.id,
            vec![Grant {
                kind: GranteeKind::User,
                id: stranger.user_id.to_string(),
                permission: Permission::View,
            }],
        )
        .await
        .expect("share");
    let duplicate = Grant {
        kind: GranteeKind::User,
        id: stranger.user_id.to_string(),
        permission: Permission::View,
    };
    service
        .share(
            &owner,
            team,
            metadata.id,
            vec![
                duplicate.clone(),
                duplicate,
                Grant {
                    kind: GranteeKind::Team,
                    id: team.0.to_string(),
                    permission: Permission::View,
                },
            ],
        )
        .await
        .expect("duplicate recipient facts");
    assert_eq!(
        service
            .get(&owner, team, metadata.id)
            .await
            .expect("detail count")
            .share_count,
        2
    );
    assert_eq!(
        service.list(&owner, team, "").await.expect("list count")[0].share_count,
        2
    );
    assert_eq!(
        service
            .username(&stranger, team, metadata.id, false)
            .await
            .expect("shared identifier")
            .username
            .0,
        "login"
    );
    assert!(matches!(
        service.share(&stranger, team, metadata.id, vec![]).await,
        Err(Error::NotFound)
    ));
    let disclosed = service
        .reveal(&stranger, team, metadata.id, Some(1), true)
        .await
        .expect("shared copy");
    assert_eq!(disclosed.values.password.0, "sensitive-test-marker");
    *provider.revoke_on_username.lock().expect("fixture lock") = Some(repository.clone());
    assert!(matches!(
        service.username(&stranger, team, metadata.id, false).await,
        Err(Error::NotFound)
    ));
    assert_eq!(
        service
            .get(&owner, team, metadata.id)
            .await
            .expect("revoked count")
            .share_count,
        0
    );
    repository
        .memberships
        .lock()
        .expect("fixture lock")
        .remove(stranger.user_id.as_ref());
    assert!(matches!(
        service
            .reveal(&stranger, team, metadata.id, None, false)
            .await,
        Err(Error::NotFound)
    ));
}

#[tokio::test]
async fn accepted_provider_write_recovers_metadata_and_deletion_remains_resumable() {
    let repository = Arc::new(FakeRepository::new());
    let provider = Arc::new(FakeProvider::new());
    let service = PasswordService {
        repository: repository.clone(),
        provider: provider.clone(),
        reauthentication: Arc::new(FakeReauthentication {
            recent: AtomicBool::new(true),
        }),
        availability: Arc::new(FakeAvailability),
    };
    let owner = Actor {
        user_id: MacroUserIdStr::parse_from_str("macro|owner@example.test")
            .expect("valid fixture")
            .into_owned(),
        session_token: None,
    };
    let team = TeamId(Uuid::from_u128(1));
    repository
        .memberships
        .lock()
        .expect("fixture lock")
        .insert(owner.user_id.to_string(), vec![team]);
    let operation = Uuid::now_v7();
    let command = || WriteItem {
        operation_id: operation,
        name: "Recoverable".into(),
        kind: ItemKind::Login,
        url: None,
        folder_id: None,
        favorite: false,
        expected_version: None,
        values: SecretValues {
            username: SecretString(String::new()),
            password: SecretString("private".into()),
            notes: SecretString(String::new()),
            fields: vec![],
        },
    };
    repository.fail_save.store(true, Ordering::SeqCst);
    assert!(matches!(
        service.create(&owner, team, command()).await,
        Err(Error::Unavailable)
    ));
    assert_eq!(provider.stored.lock().expect("fixture lock").len(), 1);
    repository.fail_save.store(false, Ordering::SeqCst);
    let metadata = service
        .create(&owner, team, command())
        .await
        .expect("retry recovers committed provider write");
    assert_eq!(metadata.version, 1);
    assert_eq!(provider.stored.lock().expect("fixture lock").len(), 1);
    provider.fail_delete.store(true, Ordering::SeqCst);
    assert!(matches!(
        service.delete(&owner, team, metadata.id).await,
        Err(Error::Unavailable)
    ));
    assert!(matches!(
        service.reveal(&owner, team, metadata.id, None, false).await,
        Err(Error::NotFound)
    ));
    provider.fail_delete.store(false, Ordering::SeqCst);
    service
        .delete(&owner, team, metadata.id)
        .await
        .expect("retry completes deletion");
    service
        .delete(&owner, team, metadata.id)
        .await
        .expect("completed deletion retry is idempotent");
    assert!(provider.stored.lock().expect("fixture lock").is_empty());
}

#[test]
fn login_urls_reject_credentials_before_the_metadata_index() {
    assert!(LoginUrl::try_from("https://example.com/login".to_string()).is_ok());
    assert!(LoginUrl::try_from("https://alice:secret@example.com".to_string()).is_err());
    assert!(LoginUrl::try_from("https://alice@example.com".to_string()).is_err());
    assert!(LoginUrl::try_from("javascript:alert(1)".to_string()).is_err());
    assert!(LoginUrl::try_from("file:///etc/passwd".to_string()).is_err());
}

#[tokio::test]
async fn cancelling_a_create_with_accepted_provider_values_erases_values_and_prevents_retry_resurrection()
 {
    let repository = Arc::new(FakeRepository::new());
    let provider = Arc::new(FakeProvider::new());
    let service = PasswordService {
        repository: repository.clone(),
        provider: provider.clone(),
        reauthentication: Arc::new(FakeReauthentication {
            recent: AtomicBool::new(true),
        }),
        availability: Arc::new(FakeAvailability),
    };
    let owner = Actor {
        user_id: MacroUserIdStr::parse_from_str("macro|owner@example.test")
            .expect("valid fixture")
            .into_owned(),
        session_token: None,
    };
    let stranger = Actor {
        user_id: MacroUserIdStr::parse_from_str("macro|stranger@example.test")
            .expect("valid fixture")
            .into_owned(),
        session_token: None,
    };
    let team = TeamId(Uuid::from_u128(1));
    repository
        .memberships
        .lock()
        .expect("fixture lock")
        .insert(owner.user_id.to_string(), vec![team]);
    repository
        .memberships
        .lock()
        .expect("fixture lock")
        .insert(stranger.user_id.to_string(), vec![team]);
    let operation = Uuid::now_v7();
    let command = || WriteItem {
        operation_id: operation,
        name: "Pending create".into(),
        kind: ItemKind::Login,
        url: None,
        folder_id: None,
        favorite: false,
        expected_version: None,
        values: SecretValues {
            username: SecretString(String::new()),
            password: SecretString("private".into()),
            notes: SecretString(String::new()),
            fields: vec![],
        },
    };
    repository.fail_save.store(true, Ordering::SeqCst);
    assert!(matches!(
        service.create(&owner, team, command()).await,
        Err(Error::Unavailable)
    ));
    repository.fail_save.store(false, Ordering::SeqCst);
    assert!(matches!(
        service.delete(&stranger, team, ItemId(operation)).await,
        Err(Error::Forbidden)
    ));
    service
        .delete(&owner, team, ItemId(operation))
        .await
        .expect("delete staged create");
    service
        .delete(&owner, team, ItemId(operation))
        .await
        .expect("cancelled create delete retry is idempotent");
    assert!(provider.stored.lock().expect("fixture lock").is_empty());
    assert!(service.create(&owner, team, command()).await.is_err());
    assert!(provider.stored.lock().expect("fixture lock").is_empty());
}

#[tokio::test]
async fn delayed_write_recovery_preserves_later_grant_revocation_and_metadata_edits() {
    let repository = Arc::new(FakeRepository::new());
    let provider = Arc::new(FakeProvider::new());
    let service = PasswordService {
        repository: repository.clone(),
        provider: provider.clone(),
        reauthentication: Arc::new(FakeReauthentication {
            recent: AtomicBool::new(true),
        }),
        availability: Arc::new(FakeAvailability),
    };
    let owner = Actor {
        user_id: MacroUserIdStr::parse_from_str("macro|owner@example.test")
            .expect("valid fixture")
            .into_owned(),
        session_token: None,
    };
    let viewer = Actor {
        user_id: MacroUserIdStr::parse_from_str("macro|viewer@example.test")
            .expect("valid fixture")
            .into_owned(),
        session_token: None,
    };
    let team = TeamId(Uuid::from_u128(1));
    repository
        .memberships
        .lock()
        .expect("fixture lock")
        .insert(owner.user_id.to_string(), vec![team]);
    repository
        .memberships
        .lock()
        .expect("fixture lock")
        .insert(viewer.user_id.to_string(), vec![team]);
    let operation = Uuid::now_v7();
    let item = service
        .create(
            &owner,
            team,
            WriteItem {
                operation_id: operation,
                name: "Initial".into(),
                kind: ItemKind::Login,
                url: None,
                folder_id: None,
                favorite: false,
                expected_version: None,
                values: SecretValues {
                    username: SecretString(String::new()),
                    password: SecretString("first".into()),
                    notes: SecretString(String::new()),
                    fields: vec![],
                },
            },
        )
        .await
        .expect("create");
    service
        .share(
            &owner,
            team,
            item.id,
            vec![Grant {
                kind: GranteeKind::User,
                id: viewer.user_id.to_string(),
                permission: Permission::View,
            }],
        )
        .await
        .expect("share");
    let mut staged = repository.get(team, item.id).await.expect("read snapshot");
    staged.metadata.version = 2;
    staged.metadata.name = "Delayed metadata".into();
    let update_operation = Uuid::now_v7();
    repository
        .stage(update_operation, &staged)
        .await
        .expect("stage");
    provider
        .write(
            team,
            item.id,
            1,
            update_operation,
            &SecretValues {
                username: SecretString(String::new()),
                password: SecretString("second".into()),
                notes: SecretString(String::new()),
                fields: vec![],
            },
        )
        .await
        .expect("accepted remote write");
    provider.reads.store(0, Ordering::SeqCst);
    service
        .share(&owner, team, item.id, vec![])
        .await
        .expect("revoke during pending metadata save");
    service
        .patch(
            &owner,
            team,
            item.id,
            PatchItem {
                name: "Later metadata".into(),
                kind: ItemKind::Login,
                url: None,
                folder_id: None,
                favorite: true,
                expected_version: 1,
            },
        )
        .await
        .expect("later metadata edit");
    assert_eq!(provider.reads.load(Ordering::SeqCst), 0);
    assert!(matches!(
        service.reveal(&viewer, team, item.id, None, false).await,
        Err(Error::NotFound)
    ));
    assert_eq!(provider.reads.load(Ordering::SeqCst), 0);
    let secret = service
        .reveal(&owner, team, item.id, None, false)
        .await
        .expect("authorized disclosure repairs interrupted metadata write");
    assert_eq!(secret.values.password.0, "second");
    let committed = repository.get(team, item.id).await.expect("reconciled");
    assert_eq!(committed.metadata.name, "Later metadata");
    assert_eq!(committed.metadata.version, 2);
    assert!(committed.grants.is_empty());
}

#[tokio::test]
async fn unique_totp_generations_isolate_late_writes_and_durable_cleanup_preserves_the_active_key()
{
    let repository = Arc::new(FakeRepository::new());
    let provider = Arc::new(FakeProvider::new());
    let service = PasswordService {
        repository: repository.clone(),
        provider: provider.clone(),
        reauthentication: Arc::new(FakeReauthentication {
            recent: AtomicBool::new(true),
        }),
        availability: Arc::new(FakeAvailability),
    };
    let owner = Actor {
        user_id: MacroUserIdStr::parse_from_str("macro|owner@example.test")
            .expect("valid fixture")
            .into_owned(),
        session_token: None,
    };
    let team = TeamId(Uuid::from_u128(1));
    repository
        .memberships
        .lock()
        .expect("fixture lock")
        .insert(owner.user_id.to_string(), vec![team]);
    let item = service
        .create(
            &owner,
            team,
            WriteItem {
                operation_id: Uuid::now_v7(),
                name: "TOTP lifecycle".into(),
                kind: ItemKind::Login,
                url: None,
                folder_id: None,
                favorite: false,
                expected_version: None,
                values: SecretValues {
                    username: SecretString(String::new()),
                    password: SecretString("private".into()),
                    notes: SecretString(String::new()),
                    fields: vec![],
                },
            },
        )
        .await
        .expect("create");
    let before_setup = repository.get(team, item.id).await.expect("record");
    let paused_key = TotpKeyId(Uuid::now_v7());
    repository
        .stage_totp(team, item.id, paused_key)
        .await
        .expect("paused enrollment");
    service
        .configure_totp(
            &owner,
            team,
            item.id,
            Some(SecretString("JBSWY3DPEHPK3PXP".into())),
        )
        .await
        .expect("first enrollment");
    let first = repository
        .get(team, item.id)
        .await
        .expect("record")
        .totp_key_id
        .expect("active first key");
    service
        .configure_totp(
            &owner,
            team,
            item.id,
            Some(SecretString("GEZDGNBVGY3TQOJQ".into())),
        )
        .await
        .expect("replacement enrollment");
    let second = repository
        .get(team, item.id)
        .await
        .expect("record")
        .totp_key_id
        .expect("active second key");
    assert_ne!(first, second);
    assert!(matches!(
        repository
            .activate_totp(team, item.id, paused_key, before_setup.revision)
            .await,
        Err(Error::Conflict)
    ));
    assert!(matches!(
        repository
            .retire_totp(team, item.id, Some(before_setup.revision))
            .await,
        Err(Error::Conflict)
    ));
    assert!(matches!(
        repository.retire_totp(team, item.id, None).await,
        Err(Error::Conflict)
    ));
    assert_eq!(
        repository
            .get(team, item.id)
            .await
            .expect("current record")
            .totp_key_id,
        Some(second)
    );
    provider
        .set_totp(team, first, &SecretString("JBSWY3DPEHPK3PXP".into()))
        .await
        .expect("late first setup");
    service
        .cleanup_expired_totp_enrollments()
        .await
        .expect("establish quarantine after release of the service lease");
    for entry in repository
        .enrollments
        .lock()
        .expect("fixture lock")
        .values_mut()
    {
        entry.3 = true;
    }
    provider.fail_delete.store(true, Ordering::SeqCst);
    assert_eq!(
        service
            .cleanup_expired_totp_enrollments()
            .await
            .expect("retryable failure"),
        0
    );
    assert!(
        repository
            .enrollments
            .lock()
            .expect("fixture lock")
            .contains_key(&first.0)
    );
    provider.fail_delete.store(false, Ordering::SeqCst);
    assert_eq!(
        service
            .cleanup_expired_totp_enrollments()
            .await
            .expect("retired cleanup"),
        2
    );
    assert!(
        !provider
            .totp_seeds
            .lock()
            .expect("fixture lock")
            .contains_key(&first.0)
    );
    assert!(
        provider
            .totp_seeds
            .lock()
            .expect("fixture lock")
            .contains_key(&second.0)
    );
    service
        .totp(&owner, team, item.id)
        .await
        .expect("replacement remains usable");
    service
        .configure_totp(&owner, team, item.id, None)
        .await
        .expect("remove");
    provider
        .set_totp(team, second, &SecretString("GEZDGNBVGY3TQOJQ".into()))
        .await
        .expect("late second setup");
    service
        .cleanup_expired_totp_enrollments()
        .await
        .expect("establish quarantine after release of the service lease");
    for entry in repository
        .enrollments
        .lock()
        .expect("fixture lock")
        .values_mut()
    {
        entry.3 = true;
    }
    assert!(
        service
            .cleanup_expired_totp_enrollments()
            .await
            .expect("removed cleanup")
            >= 1
    );
    assert!(provider.totp_seeds.lock().expect("fixture lock").is_empty());
    assert!(matches!(
        service.totp(&owner, team, item.id).await,
        Err(Error::NotFound)
    ));
    provider.fail_set.store(true, Ordering::SeqCst);
    assert!(matches!(
        service
            .configure_totp(
                &owner,
                team,
                item.id,
                Some(SecretString("JBSWY3DPEHPK3PXP".into()))
            )
            .await,
        Err(Error::Unavailable)
    ));
    provider.fail_set.store(false, Ordering::SeqCst);
    service
        .cleanup_expired_totp_enrollments()
        .await
        .expect("establish quarantine after release of the service lease");
    for entry in repository
        .enrollments
        .lock()
        .expect("fixture lock")
        .values_mut()
    {
        entry.3 = true;
    }
    assert!(
        service
            .cleanup_expired_totp_enrollments()
            .await
            .expect("uncommitted cleanup")
            >= 1
    );
    assert!(provider.totp_seeds.lock().expect("fixture lock").is_empty());
    service
        .configure_totp(
            &owner,
            team,
            item.id,
            Some(SecretString("JBSWY3DPEHPK3PXP".into())),
        )
        .await
        .expect("new enrollment");
    let third = repository
        .get(team, item.id)
        .await
        .expect("record")
        .totp_key_id
        .expect("active third key");
    service
        .delete(&owner, team, item.id)
        .await
        .expect("delete item");
    provider
        .set_totp(team, third, &SecretString("JBSWY3DPEHPK3PXP".into()))
        .await
        .expect("late third setup");
    service
        .cleanup_expired_totp_enrollments()
        .await
        .expect("establish quarantine after release of the service lease");
    for entry in repository
        .enrollments
        .lock()
        .expect("fixture lock")
        .values_mut()
    {
        entry.3 = true;
    }
    assert!(
        service
            .cleanup_expired_totp_enrollments()
            .await
            .expect("deleted cleanup")
            >= 1
    );
    assert!(provider.totp_seeds.lock().expect("fixture lock").is_empty());
    assert!(
        !repository
            .enrollments
            .lock()
            .expect("fixture lock")
            .is_empty()
    );
    assert!(
        repository
            .totp_cleanup_due()
            .await
            .expect("cleanup rescheduled")
            .is_empty()
    );
    assert!(matches!(
        service
            .configure_totp(
                &owner,
                team,
                item.id,
                Some(SecretString("JBSWY3DPEHPK3PXP".into()))
            )
            .await,
        Err(Error::NotFound)
    ));
}
