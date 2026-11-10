use super::test::fakes::*;
use super::*;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use std::sync::atomic::{AtomicBool, Ordering};

#[tokio::test]
async fn sharing_canonicalizes_recipient_identity_before_grants_are_persisted() {
    let repository = Arc::new(FakeRepository::new());
    let service = PasswordService {
        repository: repository.clone(),
        provider: Arc::new(FakeProvider::new()),
        reauthentication: Arc::new(FakeReauthentication {
            recent: AtomicBool::new(true),
        }),
        availability: Arc::new(FakeAvailability),
    };
    let owner = Actor {
        user_id: MacroUserIdStr::parse_from_str("macro|owner@example.test")
            .unwrap()
            .into_owned(),
        session_token: None,
    };
    let viewer = Actor {
        user_id: MacroUserIdStr::parse_from_str("macro|viewer@example.test")
            .unwrap()
            .into_owned(),
        session_token: None,
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
            reauthentication: Arc::new(FakeReauthentication {
                recent: AtomicBool::new(true),
            }),
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
            session_token: None,
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
                .create_folder(&actor, team, "Folder".into())
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
