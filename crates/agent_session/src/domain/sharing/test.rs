use super::*;
use entity_access::domain::models::{Entity, EntityPermission};
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::{
    LinkShare, channel_share_permission::UpdateChannelSharePermission,
};
use std::sync::{Arc, Mutex};

const OWNER: &str = "macro|owner@example.com";
type SavedUpdate = (
    UpdateSharePermissionRequestV2,
    Option<AuthorizedTeamShareCommand>,
);

#[derive(Clone)]
struct Repo {
    id: AgentSessionId,
    writes: Arc<Mutex<Vec<SavedUpdate>>>,
}

impl Repo {
    fn new() -> Self {
        Self {
            id: AgentSessionId::new(),
            writes: Default::default(),
        }
    }
}

impl SessionSharingRepo for Repo {
    async fn permissions(&self, _: AgentSessionId) -> Result<SharePermissionV2> {
        Ok(SharePermissionV2 {
            id: self.id.to_string(),
            owner: OWNER.into(),
            link_share: None,
            link_share_access_level: None,
            team_share_access_level: None,
            channel_share_permissions: None,
        })
    }

    async fn team_share_facts(&self, _: AgentSessionId) -> Result<TeamShareFacts> {
        Ok(TeamShareFacts {
            entity: EntityType::AgentSession.with_entity_string(self.id.to_string()),
            owner: user(OWNER).into(),
            owner_team_id: Some(macro_uuid::generate_uuid_v7()),
            current: None,
            revision: 0,
        })
    }

    async fn update_permissions(
        &self,
        id: AgentSessionId,
        request: UpdateSharePermissionRequestV2,
        command: Option<AuthorizedTeamShareCommand>,
    ) -> Result<SharePermissionV2> {
        self.writes.lock().unwrap().push((request, command));
        self.permissions(id).await
    }
}

fn user(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(value.to_string()).unwrap()
}

fn entity(id: AgentSessionId, entity_type: EntityType) -> Entity {
    Entity {
        entity_type,
        entity_id: id.to_string(),
    }
}

fn owner_access(id: AgentSessionId, owner: &str) -> EntityAccessReceipt<OwnerAccessLevel> {
    EntityAccessReceipt::try_new_authenticated_user(
        user(owner),
        entity(id, EntityType::AgentSession),
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner,
        },
    )
    .unwrap()
}

fn request() -> UpdateSharePermissionRequestV2 {
    UpdateSharePermissionRequestV2 {
        link_share: None,
        link_share_access_level: None,
        team_share_access_level: None,
        channel_share_permissions: None,
    }
}

#[tokio::test]
async fn rejects_owner_grants_before_writing() {
    let repo = Repo::new();
    let service = SessionSharingService::new(repo.clone());
    for change in [
        UpdateSharePermissionRequestV2 {
            link_share: Some(Some(LinkShare::Public)),
            link_share_access_level: Some(Some(AccessLevel::Owner)),
            ..request()
        },
        UpdateSharePermissionRequestV2 {
            channel_share_permissions: Some(vec![UpdateChannelSharePermission {
                channel_id: macro_uuid::generate_uuid_v7().to_string(),
                operation: UpdateOperation::Replace,
                access_level: Some(AccessLevel::Owner),
            }]),
            ..request()
        },
    ] {
        assert!(matches!(
            service
                .update_permissions(&owner_access(repo.id, OWNER), change)
                .await,
            Err(AgentSessionError::InvalidSharing(_))
        ));
    }
    assert!(repo.writes.lock().unwrap().is_empty());
}

#[tokio::test]
async fn validates_channel_identity_and_required_access_level() {
    let repo = Repo::new();
    let service = SessionSharingService::new(repo.clone());
    for (channel_id, access_level) in [
        ("invalid".into(), Some(AccessLevel::View)),
        (macro_uuid::generate_uuid_v7().to_string(), None),
    ] {
        let change = UpdateSharePermissionRequestV2 {
            channel_share_permissions: Some(vec![UpdateChannelSharePermission {
                channel_id,
                operation: UpdateOperation::Add,
                access_level,
            }]),
            ..request()
        };
        assert!(matches!(
            service
                .update_permissions(&owner_access(repo.id, OWNER), change)
                .await,
            Err(AgentSessionError::InvalidSharing(_))
        ));
    }
    assert!(repo.writes.lock().unwrap().is_empty());
}

#[tokio::test]
async fn rejects_a_receipt_for_another_entity() {
    let repo = Repo::new();
    let service = SessionSharingService::new(repo.clone());
    let access = EntityAccessReceipt::dangerously_assert_internal_user(
        &repo.id.to_string(),
        EntityType::Document,
    );
    assert!(matches!(
        service.update_permissions(&access, request()).await,
        Err(AgentSessionError::Forbidden)
    ));
    assert!(repo.writes.lock().unwrap().is_empty());
}

#[tokio::test]
async fn team_sharing_requires_actual_owner_and_preserves_omission() {
    let repo = Repo::new();
    let service = SessionSharingService::new(repo.clone());
    let change = UpdateSharePermissionRequestV2 {
        team_share_access_level: Some(Some(AccessLevel::Edit)),
        ..request()
    };
    assert!(matches!(
        service
            .update_permissions(
                &owner_access(repo.id, "macro|other@example.com"),
                change.clone()
            )
            .await,
        Err(AgentSessionError::Forbidden)
    ));
    assert!(repo.writes.lock().unwrap().is_empty());
    service
        .update_permissions(&owner_access(repo.id, OWNER), change)
        .await
        .unwrap();
    service
        .update_permissions(&owner_access(repo.id, OWNER), request())
        .await
        .unwrap();
    let writes = repo.writes.lock().unwrap();
    assert_eq!(
        writes[0].1.as_ref().unwrap().target().unwrap().level,
        TeamShareLevel::Edit
    );
    assert!(writes[1].1.is_none());
}

#[tokio::test]
async fn forwards_explicit_link_and_channel_downgrades() {
    let repo = Repo::new();
    let service = SessionSharingService::new(repo.clone());
    let change = UpdateSharePermissionRequestV2 {
        link_share: Some(None),
        link_share_access_level: Some(None),
        channel_share_permissions: Some(vec![UpdateChannelSharePermission {
            channel_id: macro_uuid::generate_uuid_v7().to_string(),
            operation: UpdateOperation::Replace,
            access_level: Some(AccessLevel::View),
        }]),
        ..request()
    };
    service
        .update_permissions(&owner_access(repo.id, OWNER), change.clone())
        .await
        .unwrap();
    assert_eq!(repo.writes.lock().unwrap()[0].0, change);
}

#[tokio::test]
async fn effective_owner_access_does_not_substitute_for_the_session_owner() {
    let repo = Repo::new();
    let service = SessionSharingService::new(repo.clone());
    let public = UpdateSharePermissionRequestV2 {
        link_share: Some(Some(LinkShare::Public)),
        ..request()
    };
    for access in [
        owner_access(repo.id, "macro|other@example.com"),
        EntityAccessReceipt::dangerously_assert_internal_user(
            &repo.id.to_string(),
            EntityType::AgentSession,
        ),
    ] {
        assert!(matches!(
            service.update_permissions(&access, public.clone()).await,
            Err(AgentSessionError::Forbidden)
        ));
    }
    assert!(repo.writes.lock().unwrap().is_empty());
}
