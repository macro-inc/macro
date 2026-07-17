use super::read_chat::ReadChat;
use ai_toolset::schema::generate_validated_input_schema;

#[test]
fn test_read_chat_schema_validation() {
    let result = generate_validated_input_schema::<ReadChat>();
    assert!(result.is_ok(), "{:?}", result);

    let validated = result.unwrap();
    assert_eq!(
        validated.name, "ReadChat",
        "Tool name should match the schemars title"
    );
    assert!(
        validated.description.contains("chat"),
        "Description should contain expected text"
    );
}

mod self_read_guard {
    use super::super::ChatToolContext;
    use crate::domain::models::{
        ChatErr, ChatResponse, CreateChatArgs, GetChatResponse, PatchChatArgs, Result,
    };
    use crate::domain::ports::ChatService;
    use crate::inbound::toolset::read_chat::ReadChat;
    use ai_toolset::tool_object::UserToolResponse;
    use ai_toolset::{AsyncTool, RequestContext, ServiceContext};
    use entity_access::domain::models::{
        AccessError, AccessLevel, BotId, CallChannelInfo, Entity, EntityAccessReceipt,
        EntityPermission, EntityType, RequiredPermission, UserTeamInfo,
    };
    use entity_access::domain::ports::EntityAccessService;
    use macro_user_id::lowercased::Lowercase;
    use macro_user_id::user_id::{MacroUserId, MacroUserIdStr};
    use uuid::Uuid;

    /// A [`ChatService`] that panics if any method is invoked — used to prove
    /// the self-read guard returns before ever touching the service.
    struct UnreachableChatService;

    impl ChatService for UnreachableChatService {
        async fn create(
            &self,
            _user_id: MacroUserIdStr<'static>,
            _args: CreateChatArgs,
        ) -> Result<String> {
            unreachable!("guard should short-circuit before calling the chat service")
        }

        async fn get_chat(
            &self,
            _entity_access_receipt: EntityAccessReceipt<
                entity_access::domain::models::ViewAccessLevel,
            >,
        ) -> Result<GetChatResponse> {
            unreachable!("guard should short-circuit before calling the chat service")
        }

        async fn copy_chat(
            &self,
            _entity_access_receipt: EntityAccessReceipt<
                entity_access::domain::models::ViewAccessLevel,
            >,
        ) -> Result<String> {
            unreachable!("guard should short-circuit before calling the chat service")
        }

        async fn delete(
            &self,
            _entity_access_receipt: EntityAccessReceipt<
                entity_access::domain::models::OwnerAccessLevel,
            >,
        ) -> Result<()> {
            unreachable!("guard should short-circuit before calling the chat service")
        }

        async fn permanently_delete(
            &self,
            _entity_access_receipt: EntityAccessReceipt<
                entity_access::domain::models::OwnerAccessLevel,
            >,
        ) -> Result<()> {
            unreachable!("guard should short-circuit before calling the chat service")
        }

        async fn patch(
            &self,
            _entity_access_receipt: EntityAccessReceipt<
                entity_access::domain::models::OwnerAccessLevel,
            >,
            _args: PatchChatArgs,
        ) -> Result<()> {
            unreachable!("guard should short-circuit before calling the chat service")
        }

        async fn revert_delete(
            &self,
            _entity_access_receipt: EntityAccessReceipt<
                entity_access::domain::models::OwnerAccessLevel,
            >,
        ) -> Result<()> {
            unreachable!("guard should short-circuit before calling the chat service")
        }

        async fn get_permissions(
            &self,
            _entity_access_receipt: EntityAccessReceipt<
                entity_access::domain::models::EditAccessLevel,
            >,
        ) -> Result<models_permissions::share_permission::SharePermissionV2> {
            unreachable!("guard should short-circuit before calling the chat service")
        }

        async fn update_tool_call(
            &self,
            _entity_access_receipt: EntityAccessReceipt<
                entity_access::domain::models::OwnerAccessLevel,
            >,
            _message_id: &str,
            _tool_call_id: &str,
            _new_args: serde_json::Value,
        ) -> Result<()> {
            unreachable!("guard should short-circuit before calling the chat service")
        }

        async fn update_tool_response(
            &self,
            _entity_access_receipt: EntityAccessReceipt<
                entity_access::domain::models::OwnerAccessLevel,
            >,
            _message_id: &str,
            _tool_call_id: &str,
            _response: UserToolResponse<serde_json::Value>,
        ) -> Result<()> {
            unreachable!("guard should short-circuit before calling the chat service")
        }

        async fn call_tool(
            &self,
            _entity_access_receipt: EntityAccessReceipt<
                entity_access::domain::models::OwnerAccessLevel,
            >,
            _message_id: &str,
            _tool_call_id: &str,
            _args: Option<serde_json::Value>,
        ) -> Result<serde_json::Value> {
            unreachable!("guard should short-circuit before calling the chat service")
        }

        async fn reject_tool_call(
            &self,
            _entity_access_receipt: EntityAccessReceipt<
                entity_access::domain::models::OwnerAccessLevel,
            >,
            _message_id: &str,
            _tool_call_id: &str,
        ) -> Result<()> {
            unreachable!("guard should short-circuit before calling the chat service")
        }
    }

    /// An [`EntityAccessService`] that panics if any method is invoked — used
    /// to prove the self-read guard returns before checking access.
    #[derive(Clone)]
    struct UnreachableAccessService;

    impl EntityAccessService for UnreachableAccessService {
        async fn generate_entity_access_receipt<T: RequiredPermission>(
            &self,
            _user_id: &MacroUserId<Lowercase<'_>>,
            _user_org_id: Option<i64>,
            _entity_id: &str,
            _entity_type: EntityType,
        ) -> std::result::Result<EntityAccessReceipt<T>, AccessError> {
            unreachable!("guard should short-circuit before checking access")
        }

        async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
            &self,
            _bot_id: BotId,
            _entity_id: &str,
            _entity_type: EntityType,
        ) -> std::result::Result<EntityAccessReceipt<T>, AccessError> {
            unreachable!("guard should short-circuit before checking access")
        }

        async fn get_access_level(
            &self,
            _user_id: Option<&MacroUserId<Lowercase<'_>>>,
            _entity_id: &str,
            _entity_type: EntityType,
        ) -> std::result::Result<Option<AccessLevel>, AccessError> {
            unreachable!("guard should short-circuit before checking access")
        }

        async fn check_access(
            &self,
            _user_id: Option<&MacroUserId<Lowercase<'_>>>,
            _entity_id: &str,
            _entity_type: EntityType,
            _required_level: AccessLevel,
        ) -> std::result::Result<AccessLevel, AccessError> {
            unreachable!("guard should short-circuit before checking access")
        }

        async fn check_public_access(
            &self,
            _entity_id: &str,
            _entity_type: EntityType,
            _required_level: AccessLevel,
        ) -> std::result::Result<AccessLevel, AccessError> {
            unreachable!("guard should short-circuit before checking access")
        }

        async fn get_entity_permission(
            &self,
            _user_id: Option<&MacroUserId<Lowercase<'_>>>,
            _entity_id: &str,
            _entity_type: EntityType,
            _user_org_id: Option<i64>,
        ) -> std::result::Result<EntityPermission, AccessError> {
            unreachable!("guard should short-circuit before checking access")
        }

        async fn get_crm_entity_permission_with_team(
            &self,
            _user_id: Option<&MacroUserId<Lowercase<'_>>>,
            _entity_id: &str,
            _entity_type: EntityType,
        ) -> std::result::Result<(EntityPermission, Uuid), AccessError> {
            unreachable!("guard should short-circuit before checking access")
        }

        async fn get_users_by_entity(
            &self,
            _entity_id: &str,
            _entity_type: EntityType,
        ) -> std::result::Result<Vec<MacroUserIdStr<'static>>, AccessError> {
            unreachable!("guard should short-circuit before checking access")
        }

        async fn get_call_channel(
            &self,
            _call_id: &sqlx::types::Uuid,
        ) -> std::result::Result<Option<CallChannelInfo>, AccessError> {
            unreachable!("guard should short-circuit before checking access")
        }

        async fn get_call_channel_by_channel_id(
            &self,
            _channel_id: &sqlx::types::Uuid,
        ) -> std::result::Result<Option<CallChannelInfo>, AccessError> {
            unreachable!("guard should short-circuit before checking access")
        }

        async fn get_user_team(
            &self,
            _user_id: &MacroUserId<Lowercase<'_>>,
        ) -> std::result::Result<Option<UserTeamInfo>, AccessError> {
            unreachable!("guard should short-circuit before checking access")
        }
    }

    /// A [`ChatService`] that returns a canned successful response, so tests
    /// unrelated to the self-read guard can exercise the happy path.
    struct StubChatService;

    impl ChatService for StubChatService {
        async fn create(
            &self,
            _user_id: MacroUserIdStr<'static>,
            _args: CreateChatArgs,
        ) -> Result<String> {
            Err(ChatErr::Unknown(anyhow::anyhow!("not used by this test")))
        }

        async fn get_chat(
            &self,
            entity_access_receipt: EntityAccessReceipt<
                entity_access::domain::models::ViewAccessLevel,
            >,
        ) -> Result<GetChatResponse> {
            #[allow(deprecated)]
            let chat_id = entity_access_receipt.entity().entity_id.clone();
            Ok(GetChatResponse {
                chat: ChatResponse {
                    id: chat_id,
                    user_id: "macro|test@example.com".to_string(),
                    project_id: None,
                    name: "Other Chat".to_string(),
                    messages: Vec::new(),
                    model: None,
                    created_at: None,
                    updated_at: None,
                },
                user_access_level: AccessLevel::Owner,
            })
        }

        async fn copy_chat(
            &self,
            _entity_access_receipt: EntityAccessReceipt<
                entity_access::domain::models::ViewAccessLevel,
            >,
        ) -> Result<String> {
            Err(ChatErr::Unknown(anyhow::anyhow!("not used by this test")))
        }

        async fn delete(
            &self,
            _entity_access_receipt: EntityAccessReceipt<
                entity_access::domain::models::OwnerAccessLevel,
            >,
        ) -> Result<()> {
            Err(ChatErr::Unknown(anyhow::anyhow!("not used by this test")))
        }

        async fn permanently_delete(
            &self,
            _entity_access_receipt: EntityAccessReceipt<
                entity_access::domain::models::OwnerAccessLevel,
            >,
        ) -> Result<()> {
            Err(ChatErr::Unknown(anyhow::anyhow!("not used by this test")))
        }

        async fn patch(
            &self,
            _entity_access_receipt: EntityAccessReceipt<
                entity_access::domain::models::OwnerAccessLevel,
            >,
            _args: PatchChatArgs,
        ) -> Result<()> {
            Err(ChatErr::Unknown(anyhow::anyhow!("not used by this test")))
        }

        async fn revert_delete(
            &self,
            _entity_access_receipt: EntityAccessReceipt<
                entity_access::domain::models::OwnerAccessLevel,
            >,
        ) -> Result<()> {
            Err(ChatErr::Unknown(anyhow::anyhow!("not used by this test")))
        }

        async fn get_permissions(
            &self,
            _entity_access_receipt: EntityAccessReceipt<
                entity_access::domain::models::EditAccessLevel,
            >,
        ) -> Result<models_permissions::share_permission::SharePermissionV2> {
            Err(ChatErr::Unknown(anyhow::anyhow!("not used by this test")))
        }

        async fn update_tool_call(
            &self,
            _entity_access_receipt: EntityAccessReceipt<
                entity_access::domain::models::OwnerAccessLevel,
            >,
            _message_id: &str,
            _tool_call_id: &str,
            _new_args: serde_json::Value,
        ) -> Result<()> {
            Err(ChatErr::Unknown(anyhow::anyhow!("not used by this test")))
        }

        async fn update_tool_response(
            &self,
            _entity_access_receipt: EntityAccessReceipt<
                entity_access::domain::models::OwnerAccessLevel,
            >,
            _message_id: &str,
            _tool_call_id: &str,
            _response: UserToolResponse<serde_json::Value>,
        ) -> Result<()> {
            Err(ChatErr::Unknown(anyhow::anyhow!("not used by this test")))
        }

        async fn call_tool(
            &self,
            _entity_access_receipt: EntityAccessReceipt<
                entity_access::domain::models::OwnerAccessLevel,
            >,
            _message_id: &str,
            _tool_call_id: &str,
            _args: Option<serde_json::Value>,
        ) -> Result<serde_json::Value> {
            Err(ChatErr::Unknown(anyhow::anyhow!("not used by this test")))
        }

        async fn reject_tool_call(
            &self,
            _entity_access_receipt: EntityAccessReceipt<
                entity_access::domain::models::OwnerAccessLevel,
            >,
            _message_id: &str,
            _tool_call_id: &str,
        ) -> Result<()> {
            Err(ChatErr::Unknown(anyhow::anyhow!("not used by this test")))
        }
    }

    /// An [`EntityAccessService`] that always grants owner-level access, so
    /// tests unrelated to the self-read guard can exercise the happy path.
    #[derive(Clone)]
    struct StubAccessService;

    impl EntityAccessService for StubAccessService {
        async fn generate_entity_access_receipt<T: RequiredPermission>(
            &self,
            _user_id: &MacroUserId<Lowercase<'_>>,
            _user_org_id: Option<i64>,
            entity_id: &str,
            entity_type: EntityType,
        ) -> std::result::Result<EntityAccessReceipt<T>, AccessError> {
            EntityAccessReceipt::try_new_authenticated_user(
                MacroUserIdStr::try_from("macro|test@example.com".to_string()).unwrap(),
                Entity {
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
            _bot_id: BotId,
            entity_id: &str,
            entity_type: EntityType,
        ) -> std::result::Result<EntityAccessReceipt<T>, AccessError> {
            EntityAccessReceipt::try_new_authenticated_user(
                MacroUserIdStr::try_from("macro|test@example.com".to_string()).unwrap(),
                Entity {
                    entity_id: entity_id.to_string(),
                    entity_type,
                },
                EntityPermission::AccessLevel {
                    access_level: AccessLevel::Owner,
                },
            )
        }

        async fn get_access_level(
            &self,
            _user_id: Option<&MacroUserId<Lowercase<'_>>>,
            _entity_id: &str,
            _entity_type: EntityType,
        ) -> std::result::Result<Option<AccessLevel>, AccessError> {
            Ok(Some(AccessLevel::Owner))
        }

        async fn check_access(
            &self,
            _user_id: Option<&MacroUserId<Lowercase<'_>>>,
            _entity_id: &str,
            _entity_type: EntityType,
            _required_level: AccessLevel,
        ) -> std::result::Result<AccessLevel, AccessError> {
            Ok(AccessLevel::Owner)
        }

        async fn check_public_access(
            &self,
            _entity_id: &str,
            _entity_type: EntityType,
            _required_level: AccessLevel,
        ) -> std::result::Result<AccessLevel, AccessError> {
            Ok(AccessLevel::Owner)
        }

        async fn get_entity_permission(
            &self,
            _user_id: Option<&MacroUserId<Lowercase<'_>>>,
            _entity_id: &str,
            _entity_type: EntityType,
            _user_org_id: Option<i64>,
        ) -> std::result::Result<EntityPermission, AccessError> {
            Ok(EntityPermission::AccessLevel {
                access_level: AccessLevel::Owner,
            })
        }

        async fn get_crm_entity_permission_with_team(
            &self,
            _user_id: Option<&MacroUserId<Lowercase<'_>>>,
            _entity_id: &str,
            _entity_type: EntityType,
        ) -> std::result::Result<(EntityPermission, Uuid), AccessError> {
            unimplemented!("stub does not support CRM entity access")
        }

        async fn get_users_by_entity(
            &self,
            _entity_id: &str,
            _entity_type: EntityType,
        ) -> std::result::Result<Vec<MacroUserIdStr<'static>>, AccessError> {
            Ok(vec![])
        }

        async fn get_call_channel(
            &self,
            _call_id: &sqlx::types::Uuid,
        ) -> std::result::Result<Option<CallChannelInfo>, AccessError> {
            unimplemented!()
        }

        async fn get_call_channel_by_channel_id(
            &self,
            _channel_id: &sqlx::types::Uuid,
        ) -> std::result::Result<Option<CallChannelInfo>, AccessError> {
            unimplemented!()
        }

        async fn get_user_team(
            &self,
            _user_id: &MacroUserId<Lowercase<'_>>,
        ) -> std::result::Result<Option<UserTeamInfo>, AccessError> {
            unimplemented!()
        }
    }

    fn request_context() -> RequestContext {
        RequestContext::new(MacroUserIdStr::try_from("macro|test@example.com".to_string()).unwrap())
    }

    #[tokio::test]
    async fn blocks_reading_the_currently_running_chat() {
        let self_chat_id = Uuid::new_v4();
        let tool = ReadChat {
            chat_id: self_chat_id.to_string(),
        };
        let context = ServiceContext(ChatToolContext {
            service: std::sync::Arc::new(UnreachableChatService),
            entity_access_service: std::sync::Arc::new(UnreachableAccessService),
            self_chat_id: Some(self_chat_id),
        });

        let result = tool.call(context, request_context()).await;

        let err = result.expect_err("reading the running chat should be refused");
        assert!(
            err.description.contains("currently running"),
            "error should tell the model this is its own chat: {}",
            err.description
        );
    }

    #[tokio::test]
    async fn allows_reading_a_different_chat() {
        let self_chat_id = Uuid::new_v4();
        let other_chat_id = Uuid::new_v4();
        let tool = ReadChat {
            chat_id: other_chat_id.to_string(),
        };
        let context = ServiceContext(ChatToolContext {
            service: std::sync::Arc::new(StubChatService),
            entity_access_service: std::sync::Arc::new(StubAccessService),
            self_chat_id: Some(self_chat_id),
        });

        let result = tool.call(context, request_context()).await;

        assert!(result.is_ok(), "{:?}", result.err());
        assert_eq!(result.unwrap().chat_id, other_chat_id.to_string());
    }

    #[tokio::test]
    async fn allows_reading_any_chat_outside_a_chat_session() {
        let chat_id = Uuid::new_v4();
        let tool = ReadChat {
            chat_id: chat_id.to_string(),
        };
        let context = ServiceContext(ChatToolContext {
            service: std::sync::Arc::new(StubChatService),
            entity_access_service: std::sync::Arc::new(StubAccessService),
            self_chat_id: None,
        });

        let result = tool.call(context, request_context()).await;

        assert!(result.is_ok(), "{:?}", result.err());
    }
}
