use std::sync::{Arc, Mutex};

use entity_access_management::domain::models::EntityAccessManagementError;
use macro_event_broker::{EventBrokerError, MacroEvent};
use model::chat::Chat;
use model_owner::Owner;

use super::*;
use crate::domain::models::ChatResponse;

pub(super) const CHAT_ID: &str = "3f6f8b0a-6f9f-4a3f-9c3a-2b1e5d4c7a90";
const NEW_CHAT_ID: &str = "0197f776-6e7b-7c69-a251-780ae754d3e4";
pub(super) const PROJECT_ID: &str = "c1a2b3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const OWNER: &str = "macro|owner@example.com";
const OTHER_USER: &str = "macro|other@example.com";
pub(super) const TEAM_ID: uuid::Uuid =
    uuid::Uuid::from_u128(0x7ea3_0000_0000_0000_0000_0000_0000_0001);

// -- Stub ChatRepo --

#[derive(Clone, Default)]
pub(super) struct StubChatRepo {
    metadata_project_id: Option<String>,
    /// Owner `get_metadata` reports; `None` is [`OWNER`].
    metadata_owner: Option<Owner>,
    metadata_deleted_at: Option<chrono::DateTime<chrono::Utc>>,
    metadata_missing: bool,
    team_default: Option<models_permissions::share_permission::TeamLinkShareDefault>,
    received_owners: Arc<Mutex<Vec<Owner>>>,
    received_share_permission: Arc<Mutex<Option<SharePermissionV2>>>,
    /// Facts returned by `get_team_share_facts`; `None` uses the owner-with-team default.
    team_share_facts: Option<TeamShareFacts>,
    team_share_facts_loads: Arc<Mutex<usize>>,
    received_patch: Arc<Mutex<Option<PatchChatRepoArgs>>>,
    permanently_deleted: Arc<Mutex<Vec<String>>>,
    fail_copy_chat: bool,
    fail_delete: bool,
    fail_permanently_delete: bool,
    fail_patch: bool,
    fail_patch_with_conflict: bool,
    fail_revert_delete: bool,
}

impl StubChatRepo {
    fn with_project() -> Self {
        Self {
            metadata_project_id: Some(PROJECT_ID.to_string()),
            ..Self::default()
        }
    }

    /// A chat in [`PROJECT_ID`] stored under `owner`, trashed at `deleted_at`.
    pub(super) fn storing(owner: Owner, deleted_at: Option<chrono::DateTime<chrono::Utc>>) -> Self {
        Self {
            metadata_owner: Some(owner),
            metadata_deleted_at: deleted_at,
            ..Self::with_project()
        }
    }

    pub(super) fn missing() -> Self {
        Self {
            metadata_missing: true,
            ..Self::default()
        }
    }

    pub(super) fn failing_permanent_delete(owner: Owner) -> Self {
        Self {
            fail_permanently_delete: true,
            ..Self::storing(owner, None)
        }
    }

    /// Chat ids `permanently_delete` removed, in call order.
    pub(super) fn permanently_deleted(&self) -> Vec<String> {
        self.permanently_deleted.lock().unwrap().clone()
    }

    fn with_team_share_facts(facts: TeamShareFacts) -> Self {
        Self {
            team_share_facts: Some(facts),
            ..Self::default()
        }
    }

    fn team_share_facts_loads(&self) -> usize {
        *self.team_share_facts_loads.lock().unwrap()
    }

    fn received_owners(&self) -> Vec<Owner> {
        self.received_owners.lock().unwrap().clone()
    }

    fn received_team_share(&self) -> Option<Option<AuthorizedTeamShareCommand>> {
        self.received_patch
            .lock()
            .unwrap()
            .as_ref()
            .map(|args| args.team_share.clone())
    }

    fn repo_err() -> ChatErr {
        ChatErr::Unknown(anyhow::anyhow!("intentional repo failure"))
    }
}

impl ChatRepo for StubChatRepo {
    async fn get_team_default_link_share(
        &self,
        owner: &Owner,
    ) -> Result<Option<models_permissions::share_permission::TeamLinkShareDefault>> {
        self.received_owners.lock().unwrap().push(owner.clone());
        Ok(self.team_default)
    }

    async fn get_chat(&self, _chat_id: &str) -> Result<ChatResponse> {
        unimplemented!("not exercised")
    }

    async fn get_metadata(&self, chat_id: &str) -> Result<Chat> {
        if self.metadata_missing {
            return Err(ChatErr::NotFound);
        }
        Ok(Chat {
            id: chat_id.to_string(),
            name: "Source Chat".to_string(),
            user_id: self
                .metadata_owner
                .clone()
                .unwrap_or_else(|| Owner::from_principal_str(OWNER).unwrap()),
            model: None,
            project_id: self.metadata_project_id.clone(),
            created_at: None,
            updated_at: None,
            token_count: None,
            is_persistent: true,
            deleted_at: self.metadata_deleted_at,
        })
    }

    async fn get_access_level(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _chat_id: &str,
    ) -> Result<models_permissions::share_permission::access_level::AccessLevel> {
        unimplemented!("not exercised")
    }

    async fn copy_chat(
        &self,
        owner: Owner,
        _source_chat_id: &str,
        _args: CopyChatArgs,
        share_permission: SharePermissionV2,
    ) -> Result<String> {
        if self.fail_copy_chat {
            return Err(Self::repo_err());
        }
        self.received_owners.lock().unwrap().push(owner);
        *self.received_share_permission.lock().unwrap() = Some(share_permission);
        Ok(NEW_CHAT_ID.to_string())
    }

    async fn revert_delete(&self, _chat_id: &str, _project_id: Option<&str>) -> Result<()> {
        if self.fail_revert_delete {
            return Err(Self::repo_err());
        }
        Ok(())
    }

    async fn get_permissions(&self, _chat_id: &str) -> Result<SharePermissionV2> {
        unimplemented!("not exercised")
    }

    async fn get_team_share_facts(&self, _chat_id: &str) -> Result<TeamShareFacts> {
        *self.team_share_facts_loads.lock().unwrap() += 1;
        Ok(self
            .team_share_facts
            .clone()
            .unwrap_or_else(|| team_share_facts(owner(), Some(TEAM_ID), 0)))
    }

    async fn delete(&self, _chat_id: &str) -> Result<()> {
        if self.fail_delete {
            return Err(Self::repo_err());
        }
        Ok(())
    }

    async fn permanently_delete(&self, chat_id: &str) -> Result<()> {
        if self.fail_permanently_delete {
            return Err(Self::repo_err());
        }
        self.permanently_deleted
            .lock()
            .unwrap()
            .push(chat_id.to_string());
        Ok(())
    }

    async fn patch(
        &self,
        _user_id: MacroUserIdStr<'static>,
        _chat_id: &str,
        args: PatchChatRepoArgs,
    ) -> Result<()> {
        if self.fail_patch {
            return Err(Self::repo_err());
        }
        if self.fail_patch_with_conflict {
            return Err(ChatErr::Conflict("stale team-share facts".to_string()));
        }
        *self.received_patch.lock().unwrap() = Some(args);
        Ok(())
    }

    async fn update_project_modified(&self, _project_id: &str) -> Result<()> {
        Ok(())
    }
}

// -- Stub EntityAccessManagementService --

#[derive(Clone)]
pub(super) struct StubEntityAccessManagement;

impl EntityAccessManagementService for StubEntityAccessManagement {
    async fn add_entity_to_project(
        &self,
        _entity_id: &uuid::Uuid,
        _entity_type: EntityType,
        _project_id: &uuid::Uuid,
    ) -> std::result::Result<(), EntityAccessManagementError> {
        Ok(())
    }

    async fn remove_entity_from_project(
        &self,
        _entity_id: &uuid::Uuid,
        _entity_type: EntityType,
        _old_project_id: &uuid::Uuid,
    ) -> std::result::Result<(), EntityAccessManagementError> {
        Ok(())
    }

    async fn move_project(
        &self,
        _project_id: &uuid::Uuid,
        _old_project_id: Option<&uuid::Uuid>,
        _new_project_id: Option<&uuid::Uuid>,
    ) -> std::result::Result<(), EntityAccessManagementError> {
        Ok(())
    }
}

// -- Recording event broker --

#[derive(Clone, Debug, PartialEq)]
pub(super) struct PublishedChatEvent {
    topic: &'static str,
    pub(super) key: String,
    pub(super) envelope: serde_json::Value,
}

#[derive(Clone, Default)]
pub(super) struct RecordingEventBroker {
    events: Arc<Mutex<Vec<PublishedChatEvent>>>,
    fail_scheduling: bool,
}

impl RecordingEventBroker {
    fn failing() -> Self {
        Self {
            fail_scheduling: true,
            ..Self::default()
        }
    }

    pub(super) fn events(&self) -> Vec<PublishedChatEvent> {
        self.events.lock().unwrap().clone()
    }
}

impl MacroEventBroker for RecordingEventBroker {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> std::result::Result<
        tokio::task::JoinHandle<std::result::Result<(), EventBrokerError>>,
        EventBrokerError,
    > {
        if self.fail_scheduling {
            return Err(EventBrokerError::Publish(
                "intentional scheduling failure".to_string(),
            ));
        }

        self.events.lock().unwrap().push(PublishedChatEvent {
            topic: event.topic(),
            key: event.key().to_string(),
            envelope: serde_json::to_value(event.event())?,
        });

        Ok(tokio::spawn(async { Ok(()) }))
    }
}

// -- Helpers --

pub(super) fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(OWNER.to_string()).expect("valid user id")
}

fn owner_receipt(chat_id: &str) -> EntityAccessReceipt<OwnerAccessLevel> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(owner(), chat_id, EntityType::Chat)
}

fn view_receipt(chat_id: &str) -> EntityAccessReceipt<ViewAccessLevel> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(owner(), chat_id, EntityType::Chat)
}

pub(super) fn build_service<B: MacroEventBroker>(
    repo: StubChatRepo,
    event_broker: B,
) -> ChatServiceImpl<StubChatRepo, StubEntityAccessManagement, B> {
    ChatServiceImpl::new(repo, StubEntityAccessManagement).with_event_broker(event_broker)
}

fn patch_args(share_permission_updated: bool) -> PatchChatArgs {
    let share_permission = share_permission_updated.then_some(
        models_permissions::share_permission::UpdateSharePermissionRequestV2 {
            link_share: Some(Some(
                models_permissions::share_permission::LinkShare::Public,
            )),
            link_share_access_level: None,
            team_share_access_level: None,
            channel_share_permissions: None,
        },
    );

    PatchChatArgs {
        name: Some("Renamed Chat".to_string()),
        project_id: None,
        share_permission,
    }
}

// -- Tests --

#[tokio::test]
async fn copy_chat_resolves_share_permission_from_team_default() {
    use models_permissions::share_permission::access_level::AccessLevel;
    use models_permissions::share_permission::{LinkShare, TeamLinkShareDefault};

    let repo = StubChatRepo {
        team_default: Some(TeamLinkShareDefault(Some(LinkShare::Team))),
        ..StubChatRepo::default()
    };
    let service = build_service(repo.clone(), RecordingEventBroker::default());

    service.copy_chat(view_receipt(CHAT_ID)).await.unwrap();

    let permission = repo
        .received_share_permission
        .lock()
        .unwrap()
        .clone()
        .unwrap();
    assert_eq!(permission.link_share, Some(LinkShare::Team));
    assert_eq!(permission.link_share_access_level, Some(AccessLevel::View));
    assert_eq!(
        repo.received_owners(),
        vec![Owner::User(owner()), Owner::User(owner())]
    );
}

#[tokio::test]
async fn copy_chat_publishes_chat_copied_keyed_by_new_chat() {
    let broker = RecordingEventBroker::default();
    let service = build_service(StubChatRepo::default(), broker.clone());

    let new_chat_id = service.copy_chat(view_receipt(CHAT_ID)).await.unwrap();
    assert_eq!(new_chat_id, NEW_CHAT_ID);

    let events = broker.events();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].key, NEW_CHAT_ID);
    assert_eq!(events[0].envelope["event_type"], "chat.copied");
    let metadata = &events[0].envelope["metadata"];
    assert_eq!(metadata["chat_id"], NEW_CHAT_ID);
    assert_eq!(metadata["source_chat_id"], CHAT_ID);
    assert_eq!(metadata["owner"], OWNER);
    assert_eq!(metadata["name"], "Source Chat Copy");
}

#[tokio::test]
async fn copy_chat_by_bot_receipt_is_rejected() {
    let repo = StubChatRepo::default();
    let broker = RecordingEventBroker::default();
    let service = build_service(repo.clone(), broker.clone());
    let receipt = EntityAccessReceipt::<ViewAccessLevel>::dangerously_assert_bot(
        bot_id::BotId::TEST_A.into_storage_id(),
        entity_access::domain::models::BotReceiptScope::Team { team_id: TEAM_ID },
        CHAT_ID,
        EntityType::Chat,
    );

    let result = service.copy_chat(receipt).await;

    assert!(matches!(
        result,
        Err(ChatErr::Access(AccessError::Unauthorized))
    ));
    assert!(repo.received_owners().is_empty());
    assert!(broker.events().is_empty());
}

#[tokio::test]
async fn delete_publishes_chat_deleted() {
    let broker = RecordingEventBroker::default();
    let service = build_service(StubChatRepo::with_project(), broker.clone());

    service.delete(owner_receipt(CHAT_ID)).await.unwrap();

    let events = broker.events();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].key, CHAT_ID);
    assert_eq!(events[0].envelope["event_type"], "chat.deleted");
    let metadata = &events[0].envelope["metadata"];
    assert_eq!(metadata["chat_id"], CHAT_ID);
    assert_eq!(metadata["actor_user_id"], OWNER);
    assert_eq!(metadata["project_id"], PROJECT_ID);
}

#[tokio::test]
async fn delete_with_internal_receipt_has_no_actor() {
    let broker = RecordingEventBroker::default();
    let service = build_service(StubChatRepo::default(), broker.clone());
    let receipt = EntityAccessReceipt::<OwnerAccessLevel>::dangerously_assert_internal_user(
        CHAT_ID,
        EntityType::Chat,
    );

    service.delete(receipt).await.unwrap();

    let events = broker.events();
    assert_eq!(events.len(), 1);
    let metadata = &events[0].envelope["metadata"];
    assert!(metadata["actor_user_id"].is_null());
    assert!(metadata["project_id"].is_null());
}

#[tokio::test]
async fn permanently_delete_publishes_chat_permanently_deleted() {
    let broker = RecordingEventBroker::default();
    let service = build_service(StubChatRepo::with_project(), broker.clone());

    service
        .permanently_delete(owner_receipt(CHAT_ID))
        .await
        .unwrap();

    let events = broker.events();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].key, CHAT_ID);
    assert_eq!(events[0].envelope["event_type"], "chat.permanently_deleted");
    let metadata = &events[0].envelope["metadata"];
    assert_eq!(metadata["actor_user_id"], OWNER);
    assert_eq!(metadata["project_id"], PROJECT_ID);
}

#[tokio::test]
async fn revert_delete_publishes_chat_restored() {
    let broker = RecordingEventBroker::default();
    let service = build_service(StubChatRepo::with_project(), broker.clone());

    service.revert_delete(owner_receipt(CHAT_ID)).await.unwrap();

    let events = broker.events();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].key, CHAT_ID);
    assert_eq!(events[0].envelope["event_type"], "chat.restored");
    let metadata = &events[0].envelope["metadata"];
    assert_eq!(metadata["actor_user_id"], OWNER);
    assert_eq!(metadata["project_id"], PROJECT_ID);
}

#[tokio::test]
async fn patch_publishes_chat_updated_with_share_permission_updated() {
    let broker = RecordingEventBroker::default();
    let service = build_service(StubChatRepo::with_project(), broker.clone());

    service
        .patch(owner_receipt(CHAT_ID), patch_args(true))
        .await
        .unwrap();

    let events = broker.events();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].key, CHAT_ID);
    assert_eq!(events[0].envelope["event_type"], "chat.updated");
    let metadata = &events[0].envelope["metadata"];
    assert_eq!(metadata["chat_id"], CHAT_ID);
    assert_eq!(metadata["actor_user_id"], OWNER);
    assert_eq!(metadata["name"], "Renamed Chat");
    assert_eq!(metadata["previous_project_id"], PROJECT_ID);
    assert!(metadata["project_id"].is_null());
    assert_eq!(metadata["share_permission_updated"], true);
    // The share permission payload itself is never published.
    assert!(metadata.get("share_permission").is_none());
}

#[tokio::test]
async fn patch_without_share_permission_reports_flag_false() {
    let broker = RecordingEventBroker::default();
    let service = build_service(StubChatRepo::default(), broker.clone());

    service
        .patch(owner_receipt(CHAT_ID), patch_args(false))
        .await
        .unwrap();

    let events = broker.events();
    assert_eq!(events.len(), 1);
    assert_eq!(
        events[0].envelope["metadata"]["share_permission_updated"],
        false
    );
}

#[tokio::test]
async fn failing_repo_calls_emit_no_events() {
    let broker = RecordingEventBroker::default();
    let service = build_service(
        StubChatRepo {
            fail_copy_chat: true,
            fail_delete: true,
            fail_permanently_delete: true,
            fail_patch: true,
            fail_revert_delete: true,
            ..StubChatRepo::default()
        },
        broker.clone(),
    );

    assert!(service.copy_chat(view_receipt(CHAT_ID)).await.is_err());
    assert!(service.delete(owner_receipt(CHAT_ID)).await.is_err());
    assert!(
        service
            .permanently_delete(owner_receipt(CHAT_ID))
            .await
            .is_err()
    );
    assert!(
        service
            .patch(owner_receipt(CHAT_ID), patch_args(false))
            .await
            .is_err()
    );
    assert!(service.revert_delete(owner_receipt(CHAT_ID)).await.is_err());

    assert!(broker.events().is_empty());
}

#[tokio::test]
async fn broker_scheduling_failure_does_not_fail_the_call() {
    let service = build_service(
        StubChatRepo::with_project(),
        RecordingEventBroker::failing(),
    );

    assert!(service.copy_chat(view_receipt(CHAT_ID)).await.is_ok());
    assert!(service.delete(owner_receipt(CHAT_ID)).await.is_ok());
    assert!(
        service
            .permanently_delete(owner_receipt(CHAT_ID))
            .await
            .is_ok()
    );
    assert!(
        service
            .patch(owner_receipt(CHAT_ID), patch_args(true))
            .await
            .is_ok()
    );
    assert!(service.revert_delete(owner_receipt(CHAT_ID)).await.is_ok());
}

// -- Team sharing --

use models_permissions::share_permission::access_level::AccessLevel as ShareAccessLevel;
use models_permissions::share_permission::team_share::{
    AuthorizedTeamShareCommand, TeamShareFacts, TeamShareLevel,
};

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_string()).expect("valid user id")
}

fn team_share_facts(
    owner: MacroUserIdStr<'static>,
    owner_team_id: Option<uuid::Uuid>,
    revision: i64,
) -> TeamShareFacts {
    TeamShareFacts {
        entity: EntityType::Chat.with_entity_str(CHAT_ID),
        owner: owner.into(),
        owner_team_id,
        current: None,
        revision,
    }
}

fn team_share_args(level: Option<ShareAccessLevel>) -> PatchChatArgs {
    PatchChatArgs {
        name: None,
        project_id: None,
        share_permission: Some(
            models_permissions::share_permission::UpdateSharePermissionRequestV2 {
                link_share: None,
                link_share_access_level: None,
                team_share_access_level: Some(level),
                channel_share_permissions: None,
            },
        ),
    }
}

#[tokio::test]
async fn patch_without_team_share_field_does_not_load_facts_or_send_command() {
    let repo = StubChatRepo::default();
    let service = build_service(repo.clone(), RecordingEventBroker::default());

    service
        .patch(owner_receipt(CHAT_ID), patch_args(true))
        .await
        .unwrap();

    assert_eq!(repo.team_share_facts_loads(), 0);
    assert_eq!(repo.received_team_share(), Some(None));
}

#[tokio::test]
async fn patch_with_team_share_level_forwards_authorized_command() {
    let repo = StubChatRepo::default();
    let broker = RecordingEventBroker::default();
    let service = build_service(repo.clone(), broker.clone());

    service
        .patch(
            owner_receipt(CHAT_ID),
            team_share_args(Some(ShareAccessLevel::Edit)),
        )
        .await
        .unwrap();

    let command = repo
        .received_team_share()
        .flatten()
        .expect("repo receives an authorized command");
    assert_eq!(
        command.expected(),
        &team_share_facts(owner(), Some(TEAM_ID), 0)
    );
    let grant = command.target().expect("explicit level sets a grant");
    assert_eq!(grant.team_id, TEAM_ID);
    assert_eq!(grant.level, TeamShareLevel::Edit);
    assert_eq!(command.next_revision(), 1);
    let events = broker.events();
    assert_eq!(events.len(), 1);
    assert_eq!(
        events[0].envelope["metadata"]["share_permission_updated"],
        true
    );
}

#[tokio::test]
async fn patch_with_team_share_null_forwards_clear_command() {
    let repo = StubChatRepo::default();
    let service = build_service(repo.clone(), RecordingEventBroker::default());

    service
        .patch(owner_receipt(CHAT_ID), team_share_args(None))
        .await
        .unwrap();

    let command = repo
        .received_team_share()
        .flatten()
        .expect("clearing still produces a command");
    assert!(command.target().is_none());
    assert_eq!(command.next_revision(), 1);
}

#[tokio::test]
async fn patch_team_share_by_non_owner_returns_unauthorized_and_publishes_nothing() {
    // The receipt carries effective Owner access, but the persisted owner is someone else.
    let repo =
        StubChatRepo::with_team_share_facts(team_share_facts(user(OTHER_USER), Some(TEAM_ID), 0));
    let broker = RecordingEventBroker::default();
    let service = build_service(repo.clone(), broker.clone());

    let result = service
        .patch(
            owner_receipt(CHAT_ID),
            team_share_args(Some(ShareAccessLevel::View)),
        )
        .await;

    assert!(matches!(
        result,
        Err(ChatErr::Access(AccessError::Unauthorized))
    ));
    assert_eq!(repo.received_team_share(), None, "repo patch must not run");
    assert!(broker.events().is_empty());
}

#[tokio::test]
async fn patch_team_share_owner_level_returns_bad_request() {
    let repo = StubChatRepo::default();
    let service = build_service(repo.clone(), RecordingEventBroker::default());

    let result = service
        .patch(
            owner_receipt(CHAT_ID),
            team_share_args(Some(ShareAccessLevel::Owner)),
        )
        .await;

    assert!(matches!(result, Err(ChatErr::BadRequest(_))));
    assert_eq!(repo.received_team_share(), None);
}

#[tokio::test]
async fn patch_team_share_without_owner_team_returns_bad_request() {
    let repo = StubChatRepo::with_team_share_facts(team_share_facts(owner(), None, 0));
    let service = build_service(repo.clone(), RecordingEventBroker::default());

    let result = service
        .patch(
            owner_receipt(CHAT_ID),
            team_share_args(Some(ShareAccessLevel::Edit)),
        )
        .await;

    assert!(matches!(result, Err(ChatErr::BadRequest(_))));
    assert_eq!(repo.received_team_share(), None);
}

#[tokio::test]
async fn patch_team_share_exhausted_revision_returns_conflict() {
    let repo =
        StubChatRepo::with_team_share_facts(team_share_facts(owner(), Some(TEAM_ID), i64::MAX));
    let service = build_service(repo.clone(), RecordingEventBroker::default());

    let result = service
        .patch(
            owner_receipt(CHAT_ID),
            team_share_args(Some(ShareAccessLevel::Edit)),
        )
        .await;

    assert!(matches!(result, Err(ChatErr::Conflict(_))));
    assert_eq!(repo.received_team_share(), None);
}

#[tokio::test]
async fn patch_repo_conflict_does_not_publish_event() {
    let repo = StubChatRepo {
        fail_patch_with_conflict: true,
        ..StubChatRepo::default()
    };
    let broker = RecordingEventBroker::default();
    let service = build_service(repo, broker.clone());

    let result = service
        .patch(
            owner_receipt(CHAT_ID),
            team_share_args(Some(ShareAccessLevel::Edit)),
        )
        .await;

    assert!(matches!(result, Err(ChatErr::Conflict(_))));
    assert!(broker.events().is_empty());
}
