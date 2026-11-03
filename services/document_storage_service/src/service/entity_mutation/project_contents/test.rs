use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
};

use entity_access::domain::{
    models::{
        AccessLevel, BotAccessScope, BotId, CallChannelInfo, Entity as AccessEntity,
        EntityPermission, OwnerAccessLevel, TeamRole, UserTeamInfo,
    },
    ports::NoOpEntityAccessService,
};
use macro_user_id::{
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};
use uuid::Uuid;

use super::*;
use crate::service::entity_mutation::LifecycleError;

const USER: &str = "macro|owner@test.com";
const FOLDER_COPY: &str = "10000000-0000-0000-0000-00000000000c";

/// Grants owner access to everything except `denied`, and fails outright on
/// `unavailable`.
#[derive(Clone, Default)]
struct FakeAccess {
    denied: HashSet<&'static str>,
    unavailable: HashSet<&'static str>,
}

impl EntityAccessService for FakeAccess {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        if self.denied.contains(entity_id) {
            return Err(AccessError::Unauthorized);
        }
        if self.unavailable.contains(entity_id) {
            return Err(AccessError::internal("access store unavailable"));
        }
        EntityAccessReceipt::try_new_authenticated_user(
            MacroUserIdStr::try_from(USER.to_string()).unwrap(),
            AccessEntity {
                entity_id: entity_id.to_string(),
                entity_type,
            },
            EntityPermission::AccessLevel {
                access_level: AccessLevel::Owner,
            },
        )
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        bot_id: BotId,
        scope: BotAccessScope,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        NoOpEntityAccessService
            .generate_bot_entity_access_receipt(bot_id, scope, entity_id, entity_type)
            .await
    }

    async fn get_access_level(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        NoOpEntityAccessService
            .get_access_level(user_id, entity_id, entity_type)
            .await
    }

    async fn check_access(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
        required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        NoOpEntityAccessService
            .check_access(user_id, entity_id, entity_type, required_level)
            .await
    }

    async fn check_public_access(
        &self,
        entity_id: &str,
        entity_type: EntityType,
        required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        NoOpEntityAccessService
            .check_public_access(entity_id, entity_type, required_level)
            .await
    }

    async fn get_entity_permission(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
        user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        NoOpEntityAccessService
            .get_entity_permission(user_id, entity_id, entity_type, user_org_id)
            .await
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        NoOpEntityAccessService
            .get_crm_entity_permission_with_team(user_id, entity_id, entity_type)
            .await
    }

    async fn get_users_by_entity(
        &self,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        NoOpEntityAccessService
            .get_users_by_entity(entity_id, entity_type)
            .await
    }

    async fn get_call_channel(
        &self,
        call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        NoOpEntityAccessService.get_call_channel(call_id).await
    }

    async fn get_call_channel_by_channel_id(
        &self,
        channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        NoOpEntityAccessService
            .get_call_channel_by_channel_id(channel_id)
            .await
    }

    async fn get_user_team(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        NoOpEntityAccessService.get_user_team(user_id).await
    }
}

/// Duplicates into `<source>-copy`, records moves and deletions, and fails
/// every move when `moves_fail` is set.
#[derive(Default)]
struct FakeDomain {
    moves_fail: bool,
    moved: Mutex<Vec<(String, String)>>,
    deleted: Mutex<Vec<String>>,
}

impl DuplicateEntity for FakeDomain {
    type Receipt = ViewAccessLevel;

    async fn duplicate_entity(
        &self,
        entity: Entity<'static>,
        _receipt: EntityAccessReceipt<Self::Receipt>,
        _user_id: MacroUserIdStr<'static>,
        _display_name: Option<String>,
    ) -> Result<Vec<EntityMutationEffect>, EntityMutationErrorCode> {
        Ok(vec![EntityMutationEffect::updated(
            entity
                .entity_type
                .with_entity_string(format!("{}-copy", entity.entity_id)),
        )])
    }
}

impl MoveEntity for FakeDomain {
    type Receipt = OwnerAccessLevel;

    async fn move_entity(
        &self,
        request: MoveEntityRequest<Self::Receipt>,
    ) -> Result<Vec<EntityMutationEffect>, EntityMutationErrorCode> {
        let MoveEntityRequest::MoveToProject {
            entity, project_id, ..
        } = request
        else {
            panic!("copies are only moved into a project");
        };
        if self.moves_fail {
            return Err(EntityMutationErrorCode::internal(rootcause::report!(
                "move failed".to_string()
            )));
        }
        self.moved
            .lock()
            .unwrap()
            .push((entity.entity_id.to_string(), project_id));
        Ok(vec![EntityMutationEffect::updated(entity)])
    }
}

impl DeleteEntityPermanently for FakeDomain {
    type Receipt = OwnerAccessLevel;

    async fn delete_entity_permanently(
        &self,
        entity: Entity<'static>,
        _receipt: EntityAccessReceipt<Self::Receipt>,
    ) -> Result<Vec<EntityMutationEffect>, EntityMutationErrorCode> {
        self.deleted
            .lock()
            .unwrap()
            .push(entity.entity_id.to_string());
        Ok(vec![EntityMutationEffect::deleted(entity)])
    }
}

/// Records the documents deleted through the lifecycle port.
#[derive(Default)]
struct FakeLifecycle {
    deleted: Mutex<Vec<String>>,
}

impl EntityLifecycleService for FakeLifecycle {
    async fn update_thread_share_policy(
        &self,
        _actor: &EntityMutationActor,
        _entity: &Entity<'static>,
        _policy: models_permissions::share_permission::UpdateSharePermissionRequestV2,
    ) -> Result<Vec<Entity<'static>>, LifecycleError> {
        unreachable!("folder duplication never shares threads")
    }

    async fn restore_document(
        &self,
        _actor: &EntityMutationActor,
        _entity: &Entity<'static>,
    ) -> Result<Vec<Entity<'static>>, LifecycleError> {
        unreachable!("folder duplication never restores documents")
    }

    async fn delete_document_permanently(
        &self,
        _actor: &EntityMutationActor,
        entity: &Entity<'static>,
    ) -> Result<Vec<Entity<'static>>, LifecycleError> {
        self.deleted
            .lock()
            .unwrap()
            .push(entity.entity_id.to_string());
        Ok(Vec::new())
    }
}

type TestContents = DssProjectContents<FakeDomain, FakeDomain, FakeAccess, FakeLifecycle>;

fn contents(moves_fail: bool, access: FakeAccess) -> TestContents {
    DssProjectContents {
        documents: Arc::new(FakeDomain {
            moves_fail,
            ..FakeDomain::default()
        }),
        chats: Arc::new(FakeDomain {
            moves_fail,
            ..FakeDomain::default()
        }),
        access: Arc::new(access),
        lifecycle: Arc::new(FakeLifecycle::default()),
        actor: EntityMutationActor {
            user_id: MacroUserIdStr::try_from(USER.to_string()).unwrap(),
            organization_id: None,
        },
    }
}

fn view_receipt(entity_id: &str, entity_type: EntityType) -> EntityAccessReceipt<ViewAccessLevel> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(
        MacroUserIdStr::try_from(USER.to_string()).unwrap(),
        entity_id,
        entity_type,
    )
}

#[tokio::test]
async fn files_each_copy_in_the_folder_copy() {
    let contents = contents(false, FakeAccess::default());

    let document = contents
        .copy_into_project(
            view_receipt("document-1", EntityType::Document),
            "Plan".to_string(),
            FOLDER_COPY,
        )
        .await
        .unwrap();
    let chat = contents
        .copy_into_project(
            view_receipt("chat-1", EntityType::Chat),
            "Thread".to_string(),
            FOLDER_COPY,
        )
        .await
        .unwrap();

    assert_eq!(
        document,
        EntityType::Document.with_entity_string("document-1-copy".to_string())
    );
    assert_eq!(
        chat,
        EntityType::Chat.with_entity_string("chat-1-copy".to_string())
    );
    assert_eq!(
        *contents.documents.moved.lock().unwrap(),
        vec![("document-1-copy".to_string(), FOLDER_COPY.to_string())]
    );
    assert_eq!(
        *contents.chats.moved.lock().unwrap(),
        vec![("chat-1-copy".to_string(), FOLDER_COPY.to_string())]
    );
    assert!(contents.lifecycle.deleted.lock().unwrap().is_empty());
    assert!(contents.chats.deleted.lock().unwrap().is_empty());
}

#[tokio::test]
async fn deletes_a_copy_that_cannot_be_filed() {
    let contents = contents(true, FakeAccess::default());

    let document = contents
        .copy_into_project(
            view_receipt("document-1", EntityType::Document),
            "Plan".to_string(),
            FOLDER_COPY,
        )
        .await;
    let chat = contents
        .copy_into_project(
            view_receipt("chat-1", EntityType::Chat),
            "Thread".to_string(),
            FOLDER_COPY,
        )
        .await;

    assert!(matches!(
        document,
        Err(EntityMutationErrorCode::Internal(_))
    ));
    assert!(matches!(chat, Err(EntityMutationErrorCode::Internal(_))));
    assert_eq!(
        *contents.lifecycle.deleted.lock().unwrap(),
        vec!["document-1-copy".to_string()]
    );
    assert_eq!(
        *contents.chats.deleted.lock().unwrap(),
        vec!["chat-1-copy".to_string()]
    );
}

#[tokio::test]
async fn denied_access_skips_but_an_access_outage_fails() {
    let contents = contents(
        false,
        FakeAccess {
            denied: HashSet::from(["hidden", "locked-parent"]),
            unavailable: HashSet::from(["unreachable"]),
        },
    );

    let hidden = contents
        .view_receipt(&EntityType::Document.with_entity_string("hidden".to_string()))
        .await
        .unwrap();
    let visible = contents
        .view_receipt(&EntityType::Document.with_entity_string("visible".to_string()))
        .await
        .unwrap();
    let unreachable = contents
        .view_receipt(&EntityType::Document.with_entity_string("unreachable".to_string()))
        .await;

    assert!(hidden.is_none());
    assert!(visible.is_some());
    assert!(matches!(
        unreachable,
        Err(EntityMutationErrorCode::Internal(_))
    ));
    assert!(!contents.can_add_to_project("locked-parent").await.unwrap());
    assert!(contents.can_add_to_project(FOLDER_COPY).await.unwrap());
}
