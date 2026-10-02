use super::*;
use crate::domain::sharing::{DatabaseSharingRepo, DatabaseSharingService};
use models_permissions::share_permission::channel_share_permission::{
    ChannelSharePermission, UpdateChannelSharePermission, UpdateOperation,
};
use models_permissions::share_permission::{LinkShare, UpdateSharePermissionRequestV2};

impl DatabaseSharingRepo for FakeRepo {
    type Error = FakeError;
    async fn channel_grants(
        &self,
        _: DatabaseId,
    ) -> Result<Vec<ChannelSharePermission>, Self::Error> {
        Ok(vec![])
    }
    async fn update_channel_grants(
        &self,
        _: DatabaseId,
        grants: &[UpdateChannelSharePermission],
    ) -> Result<bool, Self::Error> {
        self.0.lock().unwrap().share_updates.push(grants.to_vec());
        Ok(true)
    }
}

#[tokio::test]
async fn invalid_share_requests_are_rejected_before_persistence() {
    let seeded = seeded().await;
    let (world, svc, database_id) = (seeded.world, seeded.service, seeded.database_id);
    let valid = UpdateChannelSharePermission {
        channel_id: macro_uuid::generate_uuid_v7().to_string(),
        operation: UpdateOperation::Add,
        access_level: Some(models_permissions::share_permission::access_level::AccessLevel::View),
    };
    for invalid in [
        vec![UpdateChannelSharePermission {
            access_level: Some(
                models_permissions::share_permission::access_level::AccessLevel::Owner,
            ),
            ..valid.clone()
        }],
        vec![UpdateChannelSharePermission {
            access_level: None,
            ..valid.clone()
        }],
        vec![UpdateChannelSharePermission {
            channel_id: "not-a-channel".into(),
            ..valid.clone()
        }],
        vec![valid.clone(), valid.clone()],
    ] {
        let refused = svc
            .update_share_permissions(
                receipt(database_id, OWNER, AccessLevel::Owner),
                UpdateSharePermissionRequestV2 {
                    link_share: None,
                    link_share_access_level: None,
                    team_share_access_level: None,
                    channel_share_permissions: Some(invalid),
                },
            )
            .await;
        assert!(
            matches!(refused, Err(DatabaseError::InvalidSharing(_))),
            "{refused:?}"
        );
    }
    assert!(world.lock().unwrap().share_updates.is_empty());
    let permissions = svc
        .update_share_permissions(
            receipt(database_id, OWNER, AccessLevel::Owner),
            UpdateSharePermissionRequestV2 {
                link_share: None,
                link_share_access_level: None,
                team_share_access_level: None,
                channel_share_permissions: Some(vec![valid]),
            },
        )
        .await
        .unwrap();
    assert_eq!(permissions.id, database_id.to_string());
    assert_eq!(permissions.owner, OWNER);
    assert_eq!(world.lock().unwrap().share_updates.len(), 1);
    world.lock().unwrap().databases[0].trashed_at = Some(Utc::now());
    assert!(matches!(
        svc.update_share_permissions(
            receipt(database_id, OWNER, AccessLevel::Owner),
            UpdateSharePermissionRequestV2 {
                link_share: None,
                link_share_access_level: None,
                team_share_access_level: None,
                channel_share_permissions: Some(vec![]),
            },
        )
        .await,
        Err(DatabaseError::NotFound)
    ));
    assert_eq!(world.lock().unwrap().share_updates.len(), 1);
}

#[tokio::test]
async fn link_and_team_sharing_read_as_off_and_cannot_be_turned_on() {
    let seeded = seeded().await;
    let (world, svc, database_id) = (seeded.world, seeded.service, seeded.database_id);

    let permissions = svc
        .share_permissions(receipt(database_id, OWNER, AccessLevel::Owner))
        .await
        .unwrap();
    assert_eq!(
        serde_json::to_value(&permissions).unwrap(),
        serde_json::json!({
            "id": database_id.to_string(),
            "linkShare": null,
            "teamShareAccessLevel": null,
            "owner": OWNER,
            "channelSharePermissions": [],
        })
    );

    let link = svc
        .update_share_permissions(
            receipt(database_id, OWNER, AccessLevel::Owner),
            UpdateSharePermissionRequestV2 {
                link_share: Some(Some(LinkShare::Public)),
                link_share_access_level: None,
                team_share_access_level: None,
                channel_share_permissions: None,
            },
        )
        .await;
    assert!(
        matches!(
            &link,
            Err(DatabaseError::InvalidSharing(SharingError::LinkShare))
        ),
        "{link:?}"
    );
    let team = svc
        .update_share_permissions(
            receipt(database_id, OWNER, AccessLevel::Owner),
            UpdateSharePermissionRequestV2 {
                link_share: None,
                link_share_access_level: None,
                team_share_access_level: Some(Some(
                    models_permissions::share_permission::access_level::AccessLevel::Edit,
                )),
                channel_share_permissions: None,
            },
        )
        .await;
    assert!(
        matches!(
            &team,
            Err(DatabaseError::InvalidSharing(SharingError::TeamShare))
        ),
        "{team:?}"
    );

    // Turning off what is already off is a no-op, not a refusal.
    let unchanged = svc
        .update_share_permissions(
            receipt(database_id, OWNER, AccessLevel::Owner),
            UpdateSharePermissionRequestV2 {
                link_share: Some(None),
                link_share_access_level: Some(None),
                team_share_access_level: Some(None),
                channel_share_permissions: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(unchanged, permissions);
    assert_eq!(world.lock().unwrap().share_updates, vec![Vec::new()]);
}

#[tokio::test]
async fn sharing_changes_publish_a_sharing_changed_event() {
    let seeded = seeded().await;
    let (world, svc, database_id) = (seeded.world, seeded.service, seeded.database_id);
    world.lock().unwrap().broker_events.clear();

    svc.update_share_permissions(
        receipt(database_id, OWNER, AccessLevel::Owner),
        UpdateSharePermissionRequestV2 {
            link_share: None,
            link_share_access_level: None,
            team_share_access_level: None,
            channel_share_permissions: Some(vec![]),
        },
    )
    .await
    .unwrap();
    assert!(world.lock().unwrap().broker_events.is_empty());

    svc.update_share_permissions(
        receipt(database_id, OWNER, AccessLevel::Owner),
        UpdateSharePermissionRequestV2 {
            link_share: None,
            link_share_access_level: None,
            team_share_access_level: None,
            channel_share_permissions: Some(vec![UpdateChannelSharePermission {
                channel_id: "0199a000-0000-7000-8000-000000000001".into(),
                operation: UpdateOperation::Add,
                access_level: Some(
                    models_permissions::share_permission::access_level::AccessLevel::Edit,
                ),
            }]),
        },
    )
    .await
    .unwrap();

    let events = world.lock().unwrap().broker_events.clone();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0]["event_type"], "database.sharing_changed");
    assert_eq!(
        events[0]["metadata"],
        serde_json::json!({
            "database_id": database_id.to_string(),
            "attribution": { "actor": OWNER },
        })
    );
}
