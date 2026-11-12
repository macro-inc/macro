use super::test::fakes::*;
use super::*;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use std::sync::atomic::Ordering;

#[tokio::test]
async fn sharing_canonicalizes_recipient_identity_before_grants_are_persisted() {
    let repository = Arc::new(FakeRepository::new());
    let service = PasswordService {
        repository: repository.clone(),
        provider: Arc::new(FakeProvider::new()),
        availability: Arc::new(FakeAvailability),
    };
    let owner = Actor {
        user_id: MacroUserIdStr::parse_from_str("macro|owner@example.test")
            .unwrap()
            .into_owned(),
    };
    let viewer = Actor {
        user_id: MacroUserIdStr::parse_from_str("macro|viewer@example.test")
            .unwrap()
            .into_owned(),
    };
    let team = TeamId(Uuid::from_u128(1));
    for actor in [&owner, &viewer] {
        repository
            .memberships
            .lock()
            .unwrap()
            .insert(actor.user_id.to_string(), vec![team]);
    }
    let item = service
        .create(
            &owner,
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
        .unwrap();
    service
        .share(
            &owner,
            team,
            item.id,
            vec![Grant {
                kind: GranteeKind::User,
                id: "macro|VIEWER@EXAMPLE.TEST".into(),
                permission: Permission::View,
            }],
        )
        .await
        .unwrap();
    let grants = service.grants(&owner, team, item.id).await.unwrap();
    assert_eq!(grants[0].id, viewer.user_id.as_ref());
    assert_eq!(
        service.list(&viewer, team, "").await.unwrap()[0].id,
        item.id
    );
    assert_eq!(
        service
            .reveal(&viewer, team, item.id, None, false)
            .await
            .unwrap()
            .values
            .password
            .0
            .as_str(),
        "synthetic"
    );
}

struct Unavailable;
#[async_trait::async_trait]
impl Availability for Unavailable {
    async fn require_enabled(&self, _: &Actor) -> Result<(), Error> {
        self.require_service_enabled().await
    }
    async fn require_service_enabled(&self) -> Result<(), Error> {
        Err(Error::Unavailable)
    }
}

#[tokio::test]
async fn disabled_and_nonmember_calls_never_acquire_vault_lease_admission() {
    for enabled in [true, false] {
        let repository = Arc::new(FakeRepository::new());
        let service = PasswordService {
            repository: repository.clone(),
            provider: Arc::new(FakeProvider::new()),
            availability: if enabled {
                Arc::new(FakeAvailability)
            } else {
                Arc::new(Unavailable)
            },
        };
        let actor = Actor {
            user_id: MacroUserIdStr::parse_from_str("macro|member@example.test")
                .unwrap()
                .into_owned(),
        };
        let team = TeamId(Uuid::from_u128(1));
        let item = ItemId(Uuid::from_u128(2));
        if !enabled {
            repository
                .memberships
                .lock()
                .unwrap()
                .insert(actor.user_id.to_string(), vec![team]);
        }
        let results = [
            service
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
                            username: SecretString(String::new()),
                            password: SecretString(String::new()),
                            notes: SecretString(String::new()),
                            fields: vec![],
                        },
                    },
                )
                .await
                .map(|_| ()),
            service
                .update(
                    &actor,
                    team,
                    item,
                    WriteItem {
                        private: true,
                        operation_id: Uuid::now_v7(),
                        name: "Credential".into(),
                        kind: ItemKind::Login,
                        url: None,
                        folder_id: None,
                        favorite: false,
                        expected_version: Some(1),
                        values: SecretValues {
                            username: SecretString(String::new()),
                            password: SecretString(String::new()),
                            notes: SecretString(String::new()),
                            fields: vec![],
                        },
                    },
                )
                .await
                .map(|_| ()),
            service
                .patch(
                    &actor,
                    team,
                    item,
                    PatchItem {
                        name: "Credential".into(),
                        kind: ItemKind::Login,
                        url: None,
                        folder_id: None,
                        favorite: false,
                        expected_version: 1,
                    },
                )
                .await
                .map(|_| ()),
            service
                .reveal(&actor, team, item, None, false)
                .await
                .map(|_| ()),
            service.copy(&actor, team, item, None).await.map(|_| ()),
            service.share(&actor, team, item, vec![]).await,
            service.configure_totp(&actor, team, item, None).await,
            service.totp(&actor, team, item).await.map(|_| ()),
            service.username(&actor, team, item, true).await.map(|_| ()),
            service.delete(&actor, team, item).await,
            service
                .rename_folder(&actor, team, Uuid::from_u128(3), "Folder".into())
                .await
                .map(|_| ()),
            service
                .create_folder(&actor, team, "Folder".into(), None)
                .await
                .map(|_| ()),
            service
                .delete_folder(&actor, team, Uuid::from_u128(3))
                .await,
        ];
        for result in results {
            if enabled {
                assert!(matches!(result, Err(Error::NotFound)));
            } else {
                assert!(matches!(result, Err(Error::Unavailable)));
            }
        }
        assert_eq!(repository.lock_calls.load(Ordering::SeqCst), 0);
    }
}

#[tokio::test]
async fn team_default_private_admin_and_departure_preserve_creator_and_values() {
    let repository = Arc::new(FakeRepository::new());
    let provider = Arc::new(FakeProvider::new());
    let service = PasswordService {
        repository: repository.clone(),
        provider: provider.clone(),
        availability: Arc::new(FakeAvailability),
    };
    let creator = Actor {
        user_id: MacroUserIdStr::parse_from_str("macro|creator@example.com")
            .unwrap()
            .into_owned(),
    };
    let admin = Actor {
        user_id: MacroUserIdStr::parse_from_str("macro|admin@example.com")
            .unwrap()
            .into_owned(),
    };
    let member = Actor {
        user_id: MacroUserIdStr::parse_from_str("macro|member@example.com")
            .unwrap()
            .into_owned(),
    };
    let team = TeamId(Uuid::now_v7());
    for actor in [&creator, &admin, &member] {
        repository
            .memberships
            .lock()
            .unwrap()
            .insert(actor.user_id.to_string(), vec![team]);
    }
    repository
        .admins
        .lock()
        .unwrap()
        .insert((admin.user_id.to_string(), team));
    for private in [false, true] {
        let item = service
            .create(
                &creator,
                team,
                WriteItem {
                    private,
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
            .unwrap();
        assert_eq!(item.shared_with_team, !private);
        assert!(item.can_manage);
        assert!(item.can_edit);
        let stored =
            serde_json::to_value(repository.records.lock().unwrap()[&item.id.0].clone()).unwrap();
        assert!(stored["metadata"].get("canManage").is_none());
        assert!(stored["metadata"].get("canEdit").is_none());
        assert!(stored["metadata"].get("sharedWithTeam").is_none());
        if private {
            assert!(matches!(
                service.get(&member, team, item.id).await,
                Err(Error::NotFound)
            ));
        } else {
            assert!(
                !service
                    .get(&member, team, item.id)
                    .await
                    .unwrap()
                    .can_manage
            );
        }
        let admin_view = service.get(&admin, team, item.id).await.unwrap();
        assert!(admin_view.can_manage);
        assert!(admin_view.can_edit);
        assert!(
            service
                .list(&admin, team, "")
                .await
                .unwrap()
                .iter()
                .any(|record| record.id == item.id)
        );
        let updated = service
            .update(
                &admin,
                team,
                item.id,
                WriteItem {
                    private: !private,
                    operation_id: Uuid::now_v7(),
                    name: "Updated".into(),
                    kind: ItemKind::Login,
                    url: None,
                    folder_id: None,
                    favorite: false,
                    expected_version: Some(item.version),
                    values: SecretValues {
                        username: SecretString("account".into()),
                        password: SecretString("synthetic".into()),
                        notes: SecretString(String::new()),
                        fields: vec![],
                    },
                },
            )
            .await
            .unwrap();
        assert_eq!(
            updated.shared_with_team, !private,
            "update must preserve existing grants"
        );
        service
            .configure_totp(
                &admin,
                team,
                item.id,
                Some(SecretString("JBSWY3DPEHPK3PXP".into())),
            )
            .await
            .unwrap();
        repository
            .memberships
            .lock()
            .unwrap()
            .remove(creator.user_id.as_ref());
        assert!(matches!(
            service.reveal(&creator, team, item.id, None, false).await,
            Err(Error::NotFound)
        ));
        assert!(provider.stored.lock().unwrap().contains_key(&item.id.0));
        assert_eq!(
            service
                .reveal(&admin, team, item.id, None, false)
                .await
                .unwrap()
                .values
                .password
                .0,
            "synthetic"
        );
        service
            .share(
                &admin,
                team,
                item.id,
                vec![Grant {
                    kind: GranteeKind::User,
                    id: member.user_id.to_string(),
                    permission: Permission::Edit,
                }],
            )
            .await
            .unwrap();
        assert!(
            !service
                .get(&member, team, item.id)
                .await
                .unwrap()
                .shared_with_team
        );
        assert_eq!(
            repository.records.lock().unwrap()[&item.id.0].user_id,
            creator.user_id
        );
        repository.admins.lock().unwrap().clear();
        assert!(matches!(
            service.reveal(&admin, team, item.id, None, false).await,
            Err(Error::NotFound)
        ));
        repository
            .admins
            .lock()
            .unwrap()
            .insert((admin.user_id.to_string(), team));
        repository
            .memberships
            .lock()
            .unwrap()
            .insert(creator.user_id.to_string(), vec![team]);
    }
}

#[tokio::test]
async fn canonical_agent_recipient_is_rejected_before_persisting_grants() {
    let repository = Arc::new(FakeRepository::new());
    let provider = Arc::new(FakeProvider::new());
    let service = PasswordService {
        repository: repository.clone(),
        provider,
        availability: Arc::new(FakeAvailability),
    };
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
    repository
        .memberships
        .lock()
        .unwrap()
        .insert("macro|agent@example.com".into(), vec![team]);
    repository
        .agents
        .lock()
        .unwrap()
        .insert("macro|agent@example.com".into());
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
                    username: SecretString(String::new()),
                    password: SecretString(String::new()),
                    notes: SecretString(String::new()),
                    fields: vec![],
                },
            },
        )
        .await
        .unwrap();
    assert!(matches!(
        service
            .share(
                &actor,
                team,
                item.id,
                vec![Grant {
                    kind: GranteeKind::User,
                    id: "macro|AGENT@EXAMPLE.COM".into(),
                    permission: Permission::Edit
                }]
            )
            .await,
        Err(Error::NotFound)
    ));
    assert!(
        repository.records.lock().unwrap()[&item.id.0]
            .grants
            .is_empty()
    );
}

#[tokio::test]
async fn omitted_private_choice_defaults_to_team_edit_sharing() {
    let repository = Arc::new(FakeRepository::new());
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
        provider: Arc::new(FakeProvider::new()),
        availability: Arc::new(FakeAvailability),
    };
    let command:WriteItem=serde_json::from_value(serde_json::json!({
        "operationId":Uuid::now_v7(),"name":"Credential","kind":"login","url":null,"folderId":null,"favorite":false,
        "expectedVersion":null,"values":{"username":"","password":"","notes":"","fields":[]}
    })).unwrap();
    let item = service.create(&actor, team, command).await.unwrap();
    assert!(item.shared_with_team);
    let records = repository.records.lock().unwrap();
    let grants = &records[&item.id.0].grants;
    assert_eq!(grants.len(), 1);
    assert!(matches!(grants[0].kind, GranteeKind::Team));
    assert_eq!(grants[0].id, team.0.to_string());
    assert_eq!(grants[0].permission, Permission::Edit);
}

#[tokio::test]
async fn can_edit_reflects_current_grants_without_grant_management() {
    let repository = Arc::new(FakeRepository::new());
    let service = PasswordService {
        repository: repository.clone(),
        provider: Arc::new(FakeProvider::new()),
        availability: Arc::new(FakeAvailability),
    };
    let creator = Actor {
        user_id: MacroUserIdStr::parse_from_str("macro|creator@example.com")
            .unwrap()
            .into_owned(),
    };
    let recipient = Actor {
        user_id: MacroUserIdStr::parse_from_str("macro|recipient@example.com")
            .unwrap()
            .into_owned(),
    };
    let team = TeamId(Uuid::now_v7());
    for actor in [&creator, &recipient] {
        repository
            .memberships
            .lock()
            .unwrap()
            .insert(actor.user_id.to_string(), vec![team]);
    }
    let item = service
        .create(
            &creator,
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
        .unwrap();
    assert!(item.can_edit);

    for kind in [GranteeKind::User, GranteeKind::Team] {
        // The final view grant also checks that downgrading edit access changes the response.
        for permission in [Permission::View, Permission::Edit, Permission::View] {
            service
                .share(
                    &creator,
                    team,
                    item.id,
                    vec![Grant {
                        id: match kind {
                            GranteeKind::User => recipient.user_id.to_string(),
                            GranteeKind::Team => team.0.to_string(),
                        },
                        kind: kind.clone(),
                        permission,
                    }],
                )
                .await
                .unwrap();
            let editable = permission == Permission::Edit;
            let detail = service.get(&recipient, team, item.id).await.unwrap();
            assert_eq!(detail.can_edit, editable);
            assert!(!detail.can_manage);
            let listed = service.list(&recipient, team, "").await.unwrap();
            assert_eq!(listed[0].can_edit, editable);
            service
                .reveal(&recipient, team, item.id, None, false)
                .await
                .unwrap();
            service.copy(&recipient, team, item.id, None).await.unwrap();

            let patch = service
                .patch(
                    &recipient,
                    team,
                    item.id,
                    PatchItem {
                        name: "Edited".into(),
                        kind: ItemKind::Login,
                        url: None,
                        folder_id: None,
                        favorite: false,
                        expected_version: item.version,
                    },
                )
                .await;
            let enrollment = service
                .configure_totp(
                    &recipient,
                    team,
                    item.id,
                    Some(SecretString("JBSWY3DPEHPK3PXP".into())),
                )
                .await;
            if editable {
                patch.unwrap();
                enrollment.unwrap();
                assert!(matches!(
                    service.share(&recipient, team, item.id, vec![]).await,
                    Err(Error::Forbidden)
                ));
                assert!(matches!(
                    service.delete(&recipient, team, item.id).await,
                    Err(Error::Forbidden)
                ));
            } else {
                assert!(matches!(patch, Err(Error::NotFound)));
                assert!(matches!(enrollment, Err(Error::NotFound)));
            }
        }
    }
}
