use super::*;

fn write(kind: ItemKind, expected_version: Option<i32>, operation_id: Uuid) -> WriteItem {
    WriteItem {
        private: true,
        operation_id,
        name: "Fixture credential".into(),
        kind,
        url: None,
        folder_id: None,
        favorite: false,
        expected_version,
        values: SecretValues {
            username: SecretString("synthetic account".into()),
            password: SecretString("synthetic private value".into()),
            notes: SecretString(String::new()),
            fields: vec![],
        },
    }
}

fn patch(kind: ItemKind, expected_version: i32) -> PatchItem {
    PatchItem {
        name: "Fixture credential".into(),
        kind,
        url: None,
        folder_id: None,
        favorite: false,
        expected_version,
    }
}

fn fixture() -> (
    PasswordService,
    Arc<FakeRepository>,
    Arc<FakeProvider>,
    Actor,
    TeamId,
) {
    let repository = Arc::new(FakeRepository::new());
    let provider = Arc::new(FakeProvider::new());
    let service = PasswordService {
        repository: repository.clone(),
        provider: provider.clone(),
        availability: Arc::new(FakeAvailability),
    };
    let owner = Actor {
        user_id: MacroUserIdStr::parse_from_str("macro|owner@example.test")
            .expect("valid fixture")
            .into_owned(),
    };
    let team = TeamId(Uuid::from_u128(1));
    repository
        .memberships
        .lock()
        .expect("fixture lock")
        .insert(owner.user_id.to_string(), vec![team]);
    (service, repository, provider, owner, team)
}

#[tokio::test]
async fn legacy_card_save_preserves_guidance_and_lost_clear_response_recovers_once() {
    let (service, repo, provider, owner, team) = fixture();
    let original = service
        .create(&owner, team, write(ItemKind::Card, None, Uuid::now_v7()))
        .await
        .expect("legacy card");
    assert!(
        service
            .use_when(&owner, team, original.id)
            .await
            .expect("read")
            .is_none()
    );

    let set = service
        .update_with_use_when(
            &owner,
            team,
            original.id,
            write(ItemKind::Card, Some(1), Uuid::now_v7()),
            Some(UseWhenChange::Set(SecretString("  Renewals only  ".into()))),
        )
        .await
        .expect("add guidance");
    assert_eq!(set.version, 2);
    assert!(
        !serde_json::to_string(&set)
            .expect("metadata")
            .contains("Renewals only")
    );
    let old_client = service
        .update(
            &owner,
            team,
            original.id,
            write(ItemKind::Card, Some(2), Uuid::now_v7()),
        )
        .await
        .expect("old client save");
    assert_eq!(old_client.version, 3);
    let calls = provider.calls.load(Ordering::SeqCst);
    let patched = service
        .patch(&owner, team, original.id, patch(ItemKind::Card, 3))
        .await
        .expect("same-kind patch");
    assert_eq!(patched.version, 3);
    assert_eq!(provider.calls.load(Ordering::SeqCst), calls);
    assert_eq!(
        service
            .use_when(&owner, team, original.id)
            .await
            .expect("read")
            .expect("guidance")
            .0,
        "Renewals only"
    );
    let disclosed = service
        .reveal(&owner, team, original.id, None, false)
        .await
        .expect("reveal");
    assert!(
        !serde_json::to_string(&disclosed)
            .expect("reveal")
            .contains("Renewals only")
    );

    let operation = Uuid::now_v7();
    repo.fail_save.store(true, Ordering::SeqCst);
    assert!(matches!(
        service
            .update_with_use_when(
                &owner,
                team,
                original.id,
                write(ItemKind::Card, Some(3), operation),
                Some(UseWhenChange::Clear)
            )
            .await,
        Err(Error::Unavailable)
    ));
    repo.fail_save.store(false, Ordering::SeqCst);
    let clear = service
        .update_with_use_when(
            &owner,
            team,
            original.id,
            write(ItemKind::Card, Some(3), operation),
            Some(UseWhenChange::Clear),
        )
        .await
        .expect("retry clear");
    assert_eq!(clear.version, 4);
    assert_eq!(
        provider
            .writes_completed
            .lock()
            .expect("fixture lock")
            .len(),
        4
    );
    assert!(
        service
            .use_when(&owner, team, original.id)
            .await
            .expect("read")
            .is_none()
    );
    assert!(matches!(
        service
            .update_with_use_when(
                &owner,
                team,
                original.id,
                write(ItemKind::Card, Some(3), Uuid::now_v7()),
                Some(UseWhenChange::Clear)
            )
            .await,
        Err(Error::Conflict)
    ));
}

#[tokio::test]
async fn card_retyping_fences_a_delayed_set_and_preserves_the_credential() {
    let (service, repo, provider, owner, team) = fixture();
    let original = service
        .create(&owner, team, write(ItemKind::Card, None, Uuid::now_v7()))
        .await
        .expect("card");
    let operation = Uuid::now_v7();
    let mut staged = repo.get(team, original.id).await.expect("record");
    staged.metadata.version = 2;
    repo.stage(operation, &staged, &owner.user_id)
        .await
        .expect("old writer staged");

    let login = service
        .patch(&owner, team, original.id, patch(ItemKind::Login, 1))
        .await
        .expect("retype away");
    assert_eq!(login.version, 2);
    assert!(matches!(
        service.use_when(&owner, team, original.id).await,
        Err(Error::NotFound)
    ));
    let card = service
        .patch(&owner, team, original.id, patch(ItemKind::Card, 2))
        .await
        .expect("retype back");
    assert_eq!(card.version, 3);

    assert!(matches!(
        provider
            .write_with_use_when(
                team,
                original.id,
                1,
                operation,
                &write(ItemKind::Card, Some(1), operation).values,
                Some(&SecretString("Delayed advice".into()))
            )
            .await,
        Err(Error::Conflict)
    ));
    let values = provider
        .read(team, original.id, 3)
        .await
        .expect("retyped credential");
    assert_eq!(values.password.0, "synthetic private value");
    assert!(
        service
            .use_when(&owner, team, original.id)
            .await
            .expect("read")
            .is_none()
    );
}

#[tokio::test]
async fn card_retyping_fails_closed_on_missing_source_without_changing_metadata() {
    let (service, repo, provider, owner, team) = fixture();
    let original = service
        .create_with_use_when(
            &owner,
            team,
            write(ItemKind::Card, None, Uuid::now_v7()),
            Some(UseWhenChange::Set(SecretString("Renewals".into()))),
        )
        .await
        .expect("card");
    provider
        .stored
        .lock()
        .expect("fixture lock")
        .remove(&original.id.0);
    assert!(
        service
            .patch(&owner, team, original.id, patch(ItemKind::Login, 1))
            .await
            .is_err()
    );
    let unchanged = repo.get(team, original.id).await.expect("record");
    assert!(matches!(unchanged.metadata.kind, ItemKind::Card));
    assert_eq!(unchanged.metadata.version, 1);
}

#[tokio::test]
async fn card_advisory_requires_current_human_view_and_edit_access() {
    let (service, repo, provider, owner, team) = fixture();
    let viewer = Actor {
        user_id: MacroUserIdStr::parse_from_str("macro|viewer@example.test")
            .expect("valid fixture")
            .into_owned(),
    };
    repo.memberships
        .lock()
        .expect("fixture lock")
        .insert(viewer.user_id.to_string(), vec![team]);
    let original = service
        .create_with_use_when(
            &owner,
            team,
            write(ItemKind::Card, None, Uuid::now_v7()),
            Some(UseWhenChange::Set(SecretString("Renewals".into()))),
        )
        .await
        .expect("card");
    assert!(matches!(
        service.use_when(&viewer, team, original.id).await,
        Err(Error::NotFound)
    ));
    service
        .share(
            &owner,
            team,
            original.id,
            vec![Grant {
                kind: GranteeKind::User,
                id: viewer.user_id.to_string(),
                permission: Permission::View,
            }],
        )
        .await
        .expect("share view");
    assert_eq!(
        service
            .use_when(&viewer, team, original.id)
            .await
            .expect("view")
            .expect("advisory")
            .0,
        "Renewals"
    );
    assert!(matches!(
        service
            .update_with_use_when(
                &viewer,
                team,
                original.id,
                write(ItemKind::Card, Some(1), Uuid::now_v7()),
                Some(UseWhenChange::Clear)
            )
            .await,
        Err(Error::NotFound)
    ));
    assert!(matches!(
        service
            .use_when(&owner, TeamId(Uuid::from_u128(2)), original.id)
            .await,
        Err(Error::NotFound)
    ));
    repo.agents
        .lock()
        .expect("fixture lock")
        .insert(viewer.user_id.to_string());
    assert!(matches!(
        service.use_when(&viewer, team, original.id).await,
        Err(Error::Forbidden)
    ));
    repo.agents
        .lock()
        .expect("fixture lock")
        .remove(viewer.user_id.as_ref());
    *provider.revoke_on_disclosure.lock().expect("fixture lock") = Some(repo.clone());
    assert!(matches!(
        service.use_when(&viewer, team, original.id).await,
        Err(Error::NotFound)
    ));
}

#[tokio::test]
async fn invalid_text_and_non_card_intent_never_stage_or_write() {
    let (service, repo, provider, owner, team) = fixture();
    for (kind, text) in [
        (ItemKind::Login, "Renewals".to_owned()),
        (ItemKind::Card, " ".to_owned()),
        (ItemKind::Card, "x".repeat(241)),
        (ItemKind::Card, "control\x00text".to_owned()),
    ] {
        assert!(matches!(
            service
                .create_with_use_when(
                    &owner,
                    team,
                    write(kind, None, Uuid::now_v7()),
                    Some(UseWhenChange::Set(SecretString(text)))
                )
                .await,
            Err(Error::Invalid)
        ));
    }
    assert!(repo.staged.lock().expect("fixture lock").is_empty());
    assert!(provider.stored.lock().expect("fixture lock").is_empty());
}

#[tokio::test]
async fn card_boundary_patch_losing_the_provider_cas_does_not_commit_kind() {
    let (service, repo, provider, owner, team) = fixture();
    let original = service
        .create(&owner, team, write(ItemKind::Card, None, Uuid::now_v7()))
        .await
        .expect("card");
    let gate = Arc::new(WriteGate::new());
    provider
        .write_gates
        .lock()
        .expect("fixture lock")
        .insert(original.id.0, gate.clone());
    let patch = service.patch(&owner, team, original.id, patch(ItemKind::Login, 1));
    let competing_write = async {
        gate.started.notified().await;
        let mut stored = provider.stored.lock().expect("fixture lock");
        let prior = stored.get_mut(&original.id.0).expect("card values");
        prior.0 = 2;
        gate.release.add_permits(1);
    };
    let (result, ()) = tokio::join!(patch, competing_write);
    assert!(matches!(result, Err(Error::Conflict)));
    let unchanged = repo.get(team, original.id).await.expect("record");
    assert!(matches!(unchanged.metadata.kind, ItemKind::Card));
    assert_eq!(unchanged.metadata.version, 1);
}

#[tokio::test]
async fn returning_to_card_after_retyping_does_not_restore_committed_guidance() {
    let (service, _, _, owner, team) = fixture();
    let original = service
        .create_with_use_when(
            &owner,
            team,
            write(ItemKind::Card, None, Uuid::now_v7()),
            Some(UseWhenChange::Set(SecretString("Renewals".into()))),
        )
        .await
        .expect("card");
    let login = service
        .patch(&owner, team, original.id, patch(ItemKind::Login, 1))
        .await
        .expect("retype via display patch");
    let card = service
        .update(
            &owner,
            team,
            original.id,
            write(ItemKind::Card, Some(login.version), Uuid::now_v7()),
        )
        .await
        .expect("retype via full save");
    assert_eq!(card.version, 3);
    assert!(
        service
            .use_when(&owner, team, original.id)
            .await
            .expect("read")
            .is_none()
    );
}
