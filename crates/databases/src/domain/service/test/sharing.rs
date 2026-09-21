use super::*;
use crate::domain::sharing::{DatabaseSharingRepo, DatabaseSharingService};
use models_permissions::share_permission::channel_share_permission::{
    ChannelSharePermission, UpdateChannelSharePermission, UpdateOperation,
};

impl DatabaseSharingRepo for FakeRepo {
    type Err = FakeError;
    async fn channel_grants(
        &self,
        _: DatabaseId,
    ) -> Result<Vec<ChannelSharePermission>, Self::Err> {
        Ok(vec![])
    }
    async fn update_channel_grants(
        &self,
        _: DatabaseId,
        grants: &[UpdateChannelSharePermission],
    ) -> Result<bool, Self::Err> {
        self.0.lock().unwrap().share_updates.push(grants.to_vec());
        Ok(true)
    }
}

#[tokio::test]
async fn invalid_share_requests_are_rejected_before_persistence() {
    let (world, svc, database_id, _) = seeded().await;
    let valid = UpdateChannelSharePermission {
        channel_id: macro_uuid::generate_uuid_v7().to_string(),
        operation: UpdateOperation::Add,
        access_level: Some(models_permissions::share_permission::access_level::AccessLevel::View),
    };
    for invalid in [
        UpdateChannelSharePermission {
            access_level: Some(
                models_permissions::share_permission::access_level::AccessLevel::Owner,
            ),
            ..valid.clone()
        },
        UpdateChannelSharePermission {
            access_level: None,
            ..valid.clone()
        },
        UpdateChannelSharePermission {
            channel_id: "not-a-channel".into(),
            ..valid.clone()
        },
    ] {
        assert!(matches!(
            svc.update_share_permissions(
                receipt(database_id, OWNER, AccessLevel::Owner),
                vec![invalid]
            )
            .await,
            Err(DatabaseError::InvalidSchemaOperation(_))
        ));
    }
    assert!(
        svc.update_share_permissions(
            receipt(database_id, OWNER, AccessLevel::Owner),
            vec![valid.clone(), valid.clone()]
        )
        .await
        .is_err()
    );
    assert!(world.lock().unwrap().share_updates.is_empty());
    svc.update_share_permissions(receipt(database_id, OWNER, AccessLevel::Owner), vec![valid])
        .await
        .unwrap();
    assert_eq!(world.lock().unwrap().share_updates.len(), 1);
    world.lock().unwrap().databases[0].trashed_at = Some(Utc::now());
    assert!(matches!(
        svc.update_share_permissions(receipt(database_id, OWNER, AccessLevel::Owner), vec![])
            .await,
        Err(DatabaseError::NotFound)
    ));
    assert_eq!(world.lock().unwrap().share_updates.len(), 1);
}
