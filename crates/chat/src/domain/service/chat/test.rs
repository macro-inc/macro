use std::sync::Mutex;

use agent::types::ChatMessageContent;
use attachment::FormattedParts;
use entity_access_management::domain::models::EntityAccessManagementError;
use macro_event_broker::{EventBrokerError, MacroEvent};
use model::chat::Chat;

use super::*;
use crate::domain::models::{ChatResponse, PatchChatMessageArgs};

const CHAT_ID: &str = "3f6f8b0a-6f9f-4a3f-9c3a-2b1e5d4c7a90";
const NEW_CHAT_ID: &str = "0197f776-6e7b-7c69-a251-780ae754d3e4";
const PROJECT_ID: &str = "c1a2b3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const OWNER: &str = "macro|owner@example.com";

// -- Stub ChatRepo --

#[derive(Clone, Default)]
struct StubChatRepo {
    metadata_project_id: Option<String>,
    fail_create: bool,
    fail_delete: bool,
    fail_patch: bool,
}

impl StubChatRepo {
    fn with_project() -> Self {
        Self {
            metadata_project_id: Some(PROJECT_ID.to_string()),
            ..Self::default()
        }
    }

    fn repo_err() -> ChatErr {
        ChatErr::Unknown(anyhow::anyhow!("intentional repo failure"))
    }
}

impl ChatRepo for StubChatRepo {
    async fn create(
        &self,
        _user_id: MacroUserIdStr<'static>,
        _args: CreateChatArgs,
    ) -> Result<String> {
        if self.fail_create {
            return Err(Self::repo_err());
        }
        Ok(CHAT_ID.to_string())
    }

    async fn get_chat(&self, _chat_id: &str) -> Result<ChatResponse> {
        unimplemented!("not exercised")
    }

    async fn get_metadata(&self, chat_id: &str) -> Result<Chat> {
        Ok(Chat {
            id: chat_id.to_string(),
            name: "Source Chat".to_string(),
            user_id: OWNER.to_string(),
            model: None,
            project_id: self.metadata_project_id.clone(),
            created_at: None,
            updated_at: None,
            token_count: None,
            is_persistent: true,
            deleted_at: None,
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
        _user_id: MacroUserIdStr<'static>,
        _source_chat_id: &str,
        _args: CopyChatArgs,
    ) -> Result<String> {
        Ok(NEW_CHAT_ID.to_string())
    }

    async fn revert_delete(&self, _chat_id: &str, _project_id: Option<&str>) -> Result<()> {
        Ok(())
    }

    async fn get_permissions(&self, _chat_id: &str) -> Result<SharePermissionV2> {
        unimplemented!("not exercised")
    }

    async fn delete(&self, _chat_id: &str) -> Result<()> {
        if self.fail_delete {
            return Err(Self::repo_err());
        }
        Ok(())
    }

    async fn permanently_delete(&self, _chat_id: &str) -> Result<()> {
        Ok(())
    }

    async fn patch(
        &self,
        _user_id: MacroUserIdStr<'static>,
        _chat_id: &str,
        _args: PatchChatArgs,
    ) -> Result<()> {
        if self.fail_patch {
            return Err(Self::repo_err());
        }
        Ok(())
    }

    async fn update_project_modified(&self, _project_id: &str) -> Result<()> {
        Ok(())
    }

    async fn patch_message(&self, _chat_id: &str, _args: PatchChatMessageArgs) -> Result<()> {
        unimplemented!("not exercised")
    }

    async fn get_message_content(
        &self,
        _chat_id: &str,
        _message_id: &str,
    ) -> Result<ChatMessageContent> {
        unimplemented!("not exercised")
    }

    async fn update_message_content(
        &self,
        _chat_id: &str,
        _message_id: &str,
        _content: &ChatMessageContent,
    ) -> Result<()> {
        unimplemented!("not exercised")
    }

    async fn store_resolved_message(
        &self,
        _message_id: &str,
        _parts: FormattedParts,
    ) -> Result<()> {
        unimplemented!("not exercised")
    }

    async fn get_resolved_message(&self, _message_id: &str) -> Result<FormattedParts> {
        unimplemented!("not exercised")
    }
}

// -- Stub EntityAccessManagementService --

#[derive(Clone)]
struct StubEntityAccessManagement;

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
struct PublishedChatEvent {
    topic: &'static str,
    key: String,
    envelope: serde_json::Value,
}

#[derive(Clone, Default)]
struct RecordingEventBroker {
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

    fn events(&self) -> Vec<PublishedChatEvent> {
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

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(OWNER.to_string()).expect("valid user id")
}

fn owner_receipt(chat_id: &str) -> EntityAccessReceipt<OwnerAccessLevel> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(owner(), chat_id, EntityType::Chat)
}

fn view_receipt(chat_id: &str) -> EntityAccessReceipt<ViewAccessLevel> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(owner(), chat_id, EntityType::Chat)
}

fn build_service<B: MacroEventBroker>(
    repo: StubChatRepo,
    event_broker: B,
) -> ChatServiceImpl<StubChatRepo, (), StubEntityAccessManagement, B> {
    ChatServiceImpl::new(
        repo,
        Arc::new(AsyncToolCollection::new()),
        (),
        StubEntityAccessManagement,
    )
    .with_event_broker(event_broker)
}

fn patch_args(share_permission_updated: bool) -> PatchChatArgs {
    let share_permission = share_permission_updated.then_some(
        models_permissions::share_permission::UpdateSharePermissionRequestV2 {
            is_public: Some(true),
            public_access_level: None,
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
async fn create_publishes_chat_created() {
    let broker = RecordingEventBroker::default();
    let service = build_service(StubChatRepo::default(), broker.clone());

    let chat_id = service
        .create(
            owner(),
            CreateChatArgs {
                name: "New Chat".to_string(),
                project_id: Some(PROJECT_ID.to_string()),
            },
        )
        .await
        .unwrap();
    assert_eq!(chat_id, CHAT_ID);

    let events = broker.events();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].topic, "macro.chats");
    assert_eq!(events[0].key, CHAT_ID);
    assert_eq!(events[0].envelope["event_type"], "chat.created");
    let metadata = &events[0].envelope["metadata"];
    assert_eq!(metadata["chat_id"], CHAT_ID);
    assert_eq!(metadata["owner"], OWNER);
    assert_eq!(metadata["name"], "New Chat");
    assert_eq!(metadata["project_id"], PROJECT_ID);
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
            fail_create: true,
            fail_delete: true,
            fail_patch: true,
            ..StubChatRepo::default()
        },
        broker.clone(),
    );

    assert!(
        service
            .create(
                owner(),
                CreateChatArgs {
                    name: "New Chat".to_string(),
                    project_id: None,
                },
            )
            .await
            .is_err()
    );
    assert!(service.delete(owner_receipt(CHAT_ID)).await.is_err());
    assert!(
        service
            .patch(owner_receipt(CHAT_ID), patch_args(false))
            .await
            .is_err()
    );

    assert!(broker.events().is_empty());
}

#[tokio::test]
async fn broker_scheduling_failure_does_not_fail_the_call() {
    let service = build_service(
        StubChatRepo::with_project(),
        RecordingEventBroker::failing(),
    );

    assert!(
        service
            .create(
                owner(),
                CreateChatArgs {
                    name: "New Chat".to_string(),
                    project_id: None,
                },
            )
            .await
            .is_ok()
    );
    assert!(service.delete(owner_receipt(CHAT_ID)).await.is_ok());
    assert!(
        service
            .patch(owner_receipt(CHAT_ID), patch_args(true))
            .await
            .is_ok()
    );
}
