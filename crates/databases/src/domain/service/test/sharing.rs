use super::*;
use crate::domain::sharing::{DatabaseSharingRepo, DatabaseSharingService, SharingWrite};
use model_owner::Owner;
use models_permissions::share_permission::access_level::AccessLevel as ShareAccessLevel;
use models_permissions::share_permission::channel_share_permission::{
    ChannelSharePermission, UpdateChannelSharePermission, UpdateOperation,
};
use models_permissions::share_permission::team_share::{
    AuthorizedTeamShareCommand, TeamShareFacts,
};
use models_permissions::share_permission::{LinkShare, UpdateSharePermissionRequestV2};

const TEAM: Uuid = Uuid::from_u128(0x0199a000_0000_7000_8000_00000000aa01);

impl DatabaseSharingRepo for FakeRepo {
    type Error = FakeError;
    async fn channel_grants(
        &self,
        _: DatabaseId,
    ) -> Result<Vec<ChannelSharePermission>, Self::Error> {
        Ok(vec![])
    }
    async fn team_share_level(
        &self,
        _: DatabaseId,
    ) -> Result<Option<ShareAccessLevel>, Self::Error> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .team_share
            .map(|grant| grant.level.into()))
    }
    async fn team_share_facts(
        &self,
        database_id: DatabaseId,
    ) -> Result<TeamShareFacts, Self::Error> {
        let world = self.0.lock().unwrap();
        let database = world
            .databases
            .iter()
            .find(|database| database.id == database_id)
            .ok_or(FakeError)?;
        Ok(TeamShareFacts {
            entity: EntityType::Database.with_entity_string(database_id.to_string()),
            owner: Owner::from_principal_str(&database.owner_id).map_err(|_| FakeError)?,
            owner_team_id: world.owner_team,
            current: world.team_share,
            revision: world.team_share_revision,
        })
    }
    async fn update_sharing(
        &self,
        database_id: DatabaseId,
        grants: &[UpdateChannelSharePermission],
        team_share: Option<&AuthorizedTeamShareCommand>,
    ) -> Result<SharingWrite, Self::Error> {
        let mut world = self.0.lock().unwrap();
        if world
            .databases
            .iter()
            .any(|database| database.id == database_id && database.trashed_at.is_some())
        {
            return Ok(SharingWrite::Gone);
        }
        if let Some(command) = team_share {
            if world.team_share_goes_stale {
                return Ok(SharingWrite::Changed);
            }
            world.team_share = command.target();
            world.team_share_revision = command.next_revision();
        }
        world.share_updates.push(grants.to_vec());
        Ok(SharingWrite::Written)
    }
}

/// Changes only the team share.
fn team_share(level: Option<ShareAccessLevel>) -> UpdateSharePermissionRequestV2 {
    UpdateSharePermissionRequestV2 {
        link_share: None,
        link_share_access_level: None,
        team_share_access_level: Some(level),
        channel_share_permissions: None,
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
async fn link_sharing_reads_as_off_and_cannot_be_turned_on() {
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
async fn the_owner_shares_a_database_with_their_team_and_stops_sharing_it() {
    let seeded = seeded().await;
    let (world, svc, database_id) = (seeded.world, seeded.service, seeded.database_id);
    world.lock().unwrap().owner_team = Some(TEAM);
    world.lock().unwrap().broker_events.clear();

    let shared = svc
        .update_share_permissions(
            receipt(database_id, OWNER, AccessLevel::Owner),
            team_share(Some(ShareAccessLevel::Edit)),
        )
        .await
        .unwrap();
    assert_eq!(shared.team_share_access_level, Some(ShareAccessLevel::Edit));
    assert_eq!(
        svc.share_permissions(receipt(database_id, OWNER, AccessLevel::Owner))
            .await
            .unwrap()
            .team_share_access_level,
        Some(ShareAccessLevel::Edit)
    );
    assert_eq!(
        world.lock().unwrap().team_share,
        Some(
            models_permissions::share_permission::team_share::TeamShareGrant {
                team_id: TEAM,
                level: models_permissions::share_permission::team_share::TeamShareLevel::Edit,
            }
        )
    );
    assert_eq!(world.lock().unwrap().broker_events.len(), 1);

    let downgraded = svc
        .update_share_permissions(
            receipt(database_id, OWNER, AccessLevel::Owner),
            team_share(Some(ShareAccessLevel::View)),
        )
        .await
        .unwrap();
    assert_eq!(
        downgraded.team_share_access_level,
        Some(ShareAccessLevel::View)
    );

    let unshared = svc
        .update_share_permissions(
            receipt(database_id, OWNER, AccessLevel::Owner),
            team_share(None),
        )
        .await
        .unwrap();
    assert_eq!(unshared.team_share_access_level, None);
    assert_eq!(world.lock().unwrap().team_share, None);
    assert_eq!(world.lock().unwrap().team_share_revision, 3);
    assert_eq!(world.lock().unwrap().broker_events.len(), 3);
}

#[tokio::test]
async fn team_shares_are_refused_unless_the_owner_can_share_with_a_team() {
    let seeded = seeded().await;
    let (world, svc, database_id) = (seeded.world, seeded.service, seeded.database_id);

    let no_team = svc
        .update_share_permissions(
            receipt(database_id, OWNER, AccessLevel::Owner),
            team_share(Some(ShareAccessLevel::Edit)),
        )
        .await;
    assert!(
        matches!(
            &no_team,
            Err(DatabaseError::InvalidSharing(SharingError::NoTeam))
        ),
        "{no_team:?}"
    );

    world.lock().unwrap().owner_team = Some(TEAM);
    let ownership = svc
        .update_share_permissions(
            receipt(database_id, OWNER, AccessLevel::Owner),
            team_share(Some(ShareAccessLevel::Owner)),
        )
        .await;
    assert!(
        matches!(
            &ownership,
            Err(DatabaseError::InvalidSharing(
                SharingError::InvalidTeamLevel
            ))
        ),
        "{ownership:?}"
    );

    // Owner access through a grant is not ownership.
    let not_owner = svc
        .update_share_permissions(
            receipt(database_id, VIEWER, AccessLevel::Owner),
            team_share(Some(ShareAccessLevel::Edit)),
        )
        .await;
    assert!(
        matches!(&not_owner, Err(DatabaseError::Unauthorized)),
        "{not_owner:?}"
    );

    world.lock().unwrap().team_share_goes_stale = true;
    let stale = svc
        .update_share_permissions(
            receipt(database_id, OWNER, AccessLevel::Owner),
            team_share(Some(ShareAccessLevel::Edit)),
        )
        .await;
    assert!(
        matches!(
            &stale,
            Err(DatabaseError::InvalidSharing(SharingError::Changed))
        ),
        "{stale:?}"
    );
    assert_eq!(world.lock().unwrap().team_share, None);
    assert!(world.lock().unwrap().share_updates.is_empty());
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
