use super::{
    ChannelToolContext, ReadChannelMessageContext, ReadChannelMessages, ReadChannelThread,
    channel_mutation_error, channel_name,
    create_channel::{CreateChannel, NewChannelType},
    manage_channel_participants::{ManageChannelParticipants, ParticipantAction},
    parse_participants,
    rename_channel::RenameChannel,
};
use crate::domain::{
    models::{
        AddParticipantsRequest, ChannelMetadata, ChannelType, CreateChannelRequest,
        CreateChannelResponse, PatchChannelRequest, RemoveParticipantsRequest, Sender,
    },
    ports::{ChannelMutationErr, ChannelService},
};
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, schema::generate_validated_input_schema,
};
use entity_access::domain::{
    models::{
        AccessError, AccessLevel, BotAccessScope, CallChannelInfo, EntityAccessReceipt,
        EntityPermission, EntityType, RequiredPermission, TeamRole, UserTeamInfo,
    },
    ports::{EntityAccessService, NoOpEntityAccessService},
};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId, user_id::MacroUserIdStr};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};
use uuid::Uuid;

const TEST_USER_ID: &str = "macro|channel-owner@example.com";

fn user_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(TEST_USER_ID.to_string()).expect("valid macro user id")
}

type CreatedChannelCall = (Sender, Option<i64>, CreateChannelRequest);
type PatchChannelCall = (Sender, Uuid, PatchChannelRequest);
type AddParticipantsCall = (Sender, Uuid, AddParticipantsRequest);
type RemoveParticipantsCall = (Sender, Uuid, RemoveParticipantsRequest);

#[derive(Clone, Default)]
struct ToolTestChannelService {
    created: Arc<Mutex<Option<CreatedChannelCall>>>,
    created_id: Option<Uuid>,
    create_error: Option<String>,
    patches: Arc<Mutex<Vec<PatchChannelCall>>>,
    patch_error: Option<String>,
    adds: Arc<Mutex<Vec<AddParticipantsCall>>>,
    removes: Arc<Mutex<Vec<RemoveParticipantsCall>>>,
    metadata_name: Option<String>,
}

impl ChannelService for ToolTestChannelService {
    async fn get_channel_messages(
        &self,
        _channel_id: Uuid,
        _query: models_pagination::Query<Uuid, models_pagination::CreatedAt, ()>,
        _direction: crate::domain::models::MessagePageDirection,
        _limit: u16,
        _filters: &crate::domain::models::ChannelMessageFilters,
        _notification_user_id: Option<MacroUserIdStr<'static>>,
    ) -> Result<
        crate::domain::ports::ChannelMessagesQueryResult,
        crate::domain::ports::ChannelMessagesErr,
    > {
        unimplemented!("read path unused by mutation tools")
    }

    async fn get_channel_attachments(
        &self,
        _channel_id: Uuid,
        _query: models_pagination::Query<Uuid, models_pagination::CreatedAt, ()>,
        _limit: u16,
        _attachment_type: Option<crate::domain::models::ChannelAttachmentType>,
    ) -> Result<
        crate::domain::ports::ChannelAttachmentsPage,
        crate::domain::ports::ChannelMessagesErr,
    > {
        unimplemented!("read path unused by mutation tools")
    }

    async fn get_channel_participants(
        &self,
        _channel_id: Uuid,
    ) -> Result<
        Vec<crate::domain::models::ChannelParticipant>,
        crate::domain::ports::ChannelMessagesErr,
    > {
        unimplemented!("read path unused by mutation tools")
    }

    async fn get_channel_metadata(
        &self,
        _channel_id: Uuid,
        _viewer_user_id: MacroUserIdStr<'static>,
    ) -> Result<ChannelMetadata, crate::domain::ports::ChannelMessagesErr> {
        Ok(ChannelMetadata {
            channel_type: ChannelType::Private,
            channel_name: self
                .metadata_name
                .clone()
                .unwrap_or_else(|| "Previous".to_string()),
        })
    }

    async fn get_attachment_references(
        &self,
        _entity_type: String,
        _entity_id: String,
        _user_id: String,
    ) -> Result<
        Vec<crate::domain::models::AttachmentEntityReference>,
        crate::domain::ports::ChannelMessagesErr,
    > {
        unimplemented!("read path unused by mutation tools")
    }

    async fn get_channel_messages_around(
        &self,
        _channel_id: Uuid,
        _message_id: Uuid,
        _limit: u16,
    ) -> Result<
        crate::domain::ports::ChannelMessagesQueryResult,
        crate::domain::ports::ChannelMessagesErr,
    > {
        unimplemented!("read path unused by mutation tools")
    }

    async fn get_thread_replies(
        &self,
        _channel_id: Uuid,
        _message_id: Uuid,
    ) -> Result<Vec<crate::domain::models::ThreadReply>, crate::domain::ports::ChannelMessagesErr>
    {
        unimplemented!("read path unused by mutation tools")
    }

    async fn create_channel(
        &self,
        actor: Sender,
        actor_org_id: Option<i64>,
        req: CreateChannelRequest,
    ) -> Result<CreateChannelResponse, ChannelMutationErr> {
        if let Some(message) = &self.create_error {
            return Err(ChannelMutationErr::BadRequest(message.clone()));
        }
        *self.created.lock().expect("create lock") = Some((actor, actor_org_id, req));
        Ok(CreateChannelResponse {
            id: self.created_id.unwrap_or_else(Uuid::new_v4).to_string(),
        })
    }

    async fn patch_channel(
        &self,
        actor: Sender,
        channel_id: Uuid,
        req: PatchChannelRequest,
    ) -> Result<(), ChannelMutationErr> {
        if let Some(message) = &self.patch_error {
            return Err(ChannelMutationErr::BadRequest(message.clone()));
        }
        self.patches
            .lock()
            .expect("patch lock")
            .push((actor, channel_id, req));
        Ok(())
    }

    async fn add_participants(
        &self,
        actor: Sender,
        channel_id: Uuid,
        req: AddParticipantsRequest,
    ) -> Result<(), ChannelMutationErr> {
        self.adds
            .lock()
            .expect("add lock")
            .push((actor, channel_id, req));
        Ok(())
    }

    async fn remove_participants(
        &self,
        actor: Sender,
        channel_id: Uuid,
        req: RemoveParticipantsRequest,
    ) -> Result<(), ChannelMutationErr> {
        self.removes
            .lock()
            .expect("remove lock")
            .push((actor, channel_id, req));
        Ok(())
    }
}

#[derive(Clone, Copy)]
enum ReceiptFail {
    Unauthorized,
    NotFound,
}

#[derive(Clone)]
struct ToolTestAccessService {
    receipt_error: Option<ReceiptFail>,
    team: Option<UserTeamInfo>,
    receipt_calls: Arc<AtomicUsize>,
}

impl Default for ToolTestAccessService {
    fn default() -> Self {
        Self {
            receipt_error: None,
            team: None,
            receipt_calls: Arc::new(AtomicUsize::new(0)),
        }
    }
}

impl EntityAccessService for ToolTestAccessService {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        self.receipt_calls.fetch_add(1, Ordering::SeqCst);
        if let Some(error) = self.receipt_error {
            return Err(match error {
                ReceiptFail::Unauthorized => AccessError::Unauthorized,
                ReceiptFail::NotFound => AccessError::NotFound("missing"),
            });
        }
        Ok(EntityAccessReceipt::dangerously_assert_authenticated_user(
            user_id(),
            entity_id,
            entity_type,
        ))
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        _bot_id: entity_access::domain::models::BotId,
        _scope: BotAccessScope,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn get_access_level(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn get_entity_permission(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn get_users_by_entity(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn get_call_channel(
        &self,
        _call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn get_user_team(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        Ok(self.team)
    }
}

#[test]
fn read_channel_messages_schema_is_valid() {
    let result = generate_validated_input_schema::<ReadChannelMessages>();
    assert!(result.is_ok(), "{result:?}");
    let validated = result.unwrap();
    assert_eq!(validated.name, "ReadChannelMessages");
    assert!(
        validated
            .description
            .contains("Read a small structured window")
    );
}

#[test]
fn read_channel_message_context_schema_is_valid() {
    let result = generate_validated_input_schema::<ReadChannelMessageContext>();
    assert!(result.is_ok(), "{result:?}");
    let validated = result.unwrap();
    assert_eq!(validated.name, "ReadChannelMessageContext");
    assert!(
        validated
            .description
            .contains("Read the local channel and thread context")
    );
}

#[test]
fn read_channel_thread_schema_is_valid() {
    let result = generate_validated_input_schema::<ReadChannelThread>();
    assert!(result.is_ok(), "{result:?}");
    let validated = result.unwrap();
    assert_eq!(validated.name, "ReadChannelThread");
    assert!(validated.description.contains("Read"));
}

#[test]
fn create_channel_schema_is_valid() {
    let result = generate_validated_input_schema::<CreateChannel>();
    assert!(result.is_ok(), "{result:?}");
    let validated = result.unwrap();
    assert_eq!(validated.name, "CreateChannel");
    assert!(validated.description.contains("private or team"));
}

#[test]
fn rename_channel_schema_is_valid() {
    let result = generate_validated_input_schema::<RenameChannel>();
    assert!(result.is_ok(), "{result:?}");
    let validated = result.unwrap();
    assert_eq!(validated.name, "RenameChannel");
    assert!(validated.description.contains("Rename"));
}

#[test]
fn manage_channel_participants_schema_is_valid() {
    let result = generate_validated_input_schema::<ManageChannelParticipants>();
    assert!(result.is_ok(), "{result:?}");
    let validated = result.unwrap();
    assert_eq!(validated.name, "ManageChannelParticipants");
    assert!(validated.description.contains("Add or remove"));
}

#[test]
fn channel_name_trims_and_rejects_empty() {
    assert_eq!(channel_name("  Planning  ").expect("trimmed"), "Planning");
    assert_eq!(
        channel_name("   ").expect_err("empty").description,
        "channel name must not be empty"
    );
    assert!(
        channel_name(&"n".repeat(256))
            .expect_err("too long")
            .description
            .contains("255")
    );
}

#[test]
fn parse_participants_accepts_ids_and_emails_and_dedupes() {
    let parsed = parse_participants(&[
        "macro|ana@acme.com".to_string(),
        "bo@acme.com".to_string(),
        "  macro|ana@acme.com  ".to_string(),
    ])
    .expect("valid participants");
    assert_eq!(
        parsed
            .iter()
            .map(|id| id.as_ref().to_string())
            .collect::<Vec<_>>(),
        vec!["macro|ana@acme.com", "macro|bo@acme.com"]
    );
}

#[test]
fn parse_participants_reports_every_invalid_entry() {
    let error = parse_participants(&["not-an-id".to_string(), "".to_string()])
        .expect_err("invalid participants");
    assert!(error.description.contains("participants[0]"));
    assert!(error.description.contains("participants[1]"));
}

#[test]
fn mutation_errors_are_actionable_without_exposing_repository_details() {
    let missing = channel_mutation_error(
        "rename the channel",
        ChannelMutationErr::NotFound("channel not found".to_string()),
    );
    assert_eq!(missing.description, "channel not found");

    let repository = channel_mutation_error(
        "rename the channel",
        ChannelMutationErr::Repo(anyhow::anyhow!("database password leaked")),
    );
    assert_eq!(repository.description, "failed to rename the channel");
}

#[tokio::test]
async fn create_private_channel_does_not_resolve_a_team() {
    let channel_id = Uuid::new_v4();
    let service = ToolTestChannelService {
        created_id: Some(channel_id),
        ..ToolTestChannelService::default()
    };
    let created = service.created.clone();
    let context = ChannelToolContext::new(service, NoOpEntityAccessService);

    let response = CreateChannel {
        name: "  Planning  ".to_string(),
        channel_type: NewChannelType::Private,
        participants: vec!["bo@acme.com".to_string()],
    }
    .call(ServiceContext(context), RequestContext::new(user_id()))
    .await
    .expect("private create does not need entity access");

    assert_eq!(response.channel_id, channel_id);
    assert_eq!(response.name, "Planning");
    assert_eq!(response.channel_type, NewChannelType::Private);
    assert_eq!(response.participants, vec!["macro|bo@acme.com"]);
    let (actor, org_id, req) = created
        .lock()
        .expect("create lock")
        .clone()
        .expect("called");
    assert_eq!(actor.as_user(), Some(&user_id()));
    assert_eq!(org_id, None);
    assert_eq!(req.channel_type, ChannelType::Private);
    assert_eq!(req.team_id, None);
    assert!(!req.auto_join_team);
    assert_eq!(req.name.as_deref(), Some("Planning"));
}

#[tokio::test]
async fn create_team_channel_injects_the_caller_when_participants_are_empty() {
    let team_id = Uuid::new_v4();
    let service = ToolTestChannelService::default();
    let created = service.created.clone();
    let context = ChannelToolContext::new(
        service,
        ToolTestAccessService {
            team: Some(UserTeamInfo {
                team_id,
                role: TeamRole::Member,
            }),
            ..ToolTestAccessService::default()
        },
    );

    let response = CreateChannel {
        name: "Team Sync".to_string(),
        channel_type: NewChannelType::Team,
        participants: Vec::new(),
    }
    .call(ServiceContext(context), RequestContext::new(user_id()))
    .await
    .expect("team create injects the caller");

    assert_eq!(response.participants, vec![TEST_USER_ID]);
    let (_, _, req) = created
        .lock()
        .expect("create lock")
        .clone()
        .expect("called");
    assert_eq!(req.channel_type, ChannelType::Team);
    assert_eq!(req.team_id, Some(team_id));
    assert!(req.participants.contains(&user_id()));
}

#[tokio::test]
async fn create_team_channel_fails_when_the_user_has_no_team() {
    let service = ToolTestChannelService::default();
    let created = service.created.clone();
    let context = ChannelToolContext::new(service, ToolTestAccessService::default());

    let error = CreateChannel {
        name: "Team Sync".to_string(),
        channel_type: NewChannelType::Team,
        participants: Vec::new(),
    }
    .call(ServiceContext(context), RequestContext::new(user_id()))
    .await
    .expect_err("team create without a team");

    assert!(error.description.contains("not a member of a team"));
    assert!(created.lock().expect("create lock").is_none());
}

#[tokio::test]
async fn create_channel_rejects_an_empty_name() {
    let context =
        ChannelToolContext::new(ToolTestChannelService::default(), NoOpEntityAccessService);

    let error = CreateChannel {
        name: "   ".to_string(),
        channel_type: NewChannelType::Private,
        participants: Vec::new(),
    }
    .call(ServiceContext(context), RequestContext::new(user_id()))
    .await
    .expect_err("empty name");

    assert_eq!(error.description, "channel name must not be empty");
}

#[tokio::test]
async fn create_channel_surfaces_domain_errors() {
    let context = ChannelToolContext::new(
        ToolTestChannelService {
            create_error: Some("participants must be a non-empty list of 'macro|<email>'".into()),
            ..ToolTestChannelService::default()
        },
        NoOpEntityAccessService,
    );

    let error = CreateChannel {
        name: "Planning".to_string(),
        channel_type: NewChannelType::Private,
        participants: Vec::new(),
    }
    .call(ServiceContext(context), RequestContext::new(user_id()))
    .await
    .expect_err("domain error");

    assert!(
        error
            .description
            .contains("participants must be a non-empty list")
    );
}

#[tokio::test]
async fn rename_channel_requires_admin_and_patches_only_the_name() {
    let channel_id = Uuid::new_v4();
    let service = ToolTestChannelService {
        metadata_name: Some("Old Name".to_string()),
        ..ToolTestChannelService::default()
    };
    let patches = service.patches.clone();
    let access = ToolTestAccessService::default();
    let receipt_calls = access.receipt_calls.clone();
    let context = ChannelToolContext::new(service, access);

    let response = RenameChannel {
        channel_id,
        name: "  New Name  ".to_string(),
    }
    .call(ServiceContext(context), RequestContext::new(user_id()))
    .await
    .expect("admin can rename");

    assert_eq!(response.name, "New Name");
    assert_eq!(response.previous_name.as_deref(), Some("Old Name"));
    assert_eq!(receipt_calls.load(Ordering::SeqCst), 1);
    let (actor, patched_id, req) = patches.lock().expect("patch lock").pop().expect("patched");
    assert_eq!(actor.as_user(), Some(&user_id()));
    assert_eq!(patched_id, channel_id);
    assert_eq!(req.channel_name.as_deref(), Some("New Name"));
    assert_eq!(req.convert_to_team_channel, None);
    assert_eq!(req.auto_join_team, None);
}

#[tokio::test]
async fn rename_channel_rejects_non_admins() {
    let context = ChannelToolContext::new(
        ToolTestChannelService::default(),
        ToolTestAccessService {
            receipt_error: Some(ReceiptFail::Unauthorized),
            ..ToolTestAccessService::default()
        },
    );

    let error = RenameChannel {
        channel_id: Uuid::new_v4(),
        name: "New Name".to_string(),
    }
    .call(ServiceContext(context), RequestContext::new(user_id()))
    .await
    .expect_err("non-admin");

    assert_eq!(
        error.description,
        "you need channel admin access to rename this channel"
    );
}

#[tokio::test]
async fn rename_channel_surfaces_dm_rename_rejection() {
    let context = ChannelToolContext::new(
        ToolTestChannelService {
            patch_error: Some("cannot change channel_name for direct message channels".into()),
            ..ToolTestChannelService::default()
        },
        ToolTestAccessService::default(),
    );

    let error = RenameChannel {
        channel_id: Uuid::new_v4(),
        name: "Nope".to_string(),
    }
    .call(ServiceContext(context), RequestContext::new(user_id()))
    .await
    .expect_err("dm rename");

    assert_eq!(
        error.description,
        "cannot change channel_name for direct message channels"
    );
}

#[tokio::test]
async fn manage_participants_adds_canonical_ids() {
    let channel_id = Uuid::new_v4();
    let service = ToolTestChannelService::default();
    let adds = service.adds.clone();
    let context = ChannelToolContext::new(service, ToolTestAccessService::default());

    let response = ManageChannelParticipants {
        channel_id,
        action: ParticipantAction::Add,
        participants: vec!["bo@acme.com".to_string()],
    }
    .call(ServiceContext(context), RequestContext::new(user_id()))
    .await
    .expect("member can add");

    assert_eq!(response.action, ParticipantAction::Add);
    assert_eq!(response.participants, vec!["macro|bo@acme.com"]);
    let (actor, added_id, req) = adds.lock().expect("add lock").pop().expect("added");
    assert_eq!(actor.as_user(), Some(&user_id()));
    assert_eq!(added_id, channel_id);
    assert!(
        req.participants
            .contains(&MacroUserIdStr::try_from_email("bo@acme.com").expect("email"))
    );
}

#[tokio::test]
async fn manage_participants_canonicalizes_remove_ids() {
    let channel_id = Uuid::new_v4();
    let service = ToolTestChannelService::default();
    let removes = service.removes.clone();
    let context = ChannelToolContext::new(service, ToolTestAccessService::default());

    ManageChannelParticipants {
        channel_id,
        action: ParticipantAction::Remove,
        participants: vec!["bo@acme.com".to_string()],
    }
    .call(ServiceContext(context), RequestContext::new(user_id()))
    .await
    .expect("member can remove");

    let (_, _, req) = removes.lock().expect("remove lock").pop().expect("removed");
    assert_eq!(req.participants, vec!["macro|bo@acme.com"]);
}

#[tokio::test]
async fn manage_participants_rejects_an_empty_list_before_the_service() {
    let service = ToolTestChannelService::default();
    let adds = service.adds.clone();
    let context = ChannelToolContext::new(service, ToolTestAccessService::default());

    let error = ManageChannelParticipants {
        channel_id: Uuid::new_v4(),
        action: ParticipantAction::Add,
        participants: Vec::new(),
    }
    .call(ServiceContext(context), RequestContext::new(user_id()))
    .await
    .expect_err("empty list");

    assert!(error.description.contains("must not be empty"));
    assert!(adds.lock().expect("add lock").is_empty());
}

#[tokio::test]
async fn manage_participants_requires_membership() {
    let context =
        ChannelToolContext::new(ToolTestChannelService::default(), NoOpEntityAccessService);

    let error = ManageChannelParticipants {
        channel_id: Uuid::new_v4(),
        action: ParticipantAction::Add,
        participants: vec!["bo@acme.com".to_string()],
    }
    .call(ServiceContext(context), RequestContext::new(user_id()))
    .await
    .expect_err("NoOp rejects membership");

    assert_eq!(error.description, "failed to verify channel membership");
}

#[tokio::test]
async fn manage_participants_distinguishes_missing_channels() {
    let context = ChannelToolContext::new(
        ToolTestChannelService::default(),
        ToolTestAccessService {
            receipt_error: Some(ReceiptFail::NotFound),
            ..ToolTestAccessService::default()
        },
    );

    let error = ManageChannelParticipants {
        channel_id: Uuid::new_v4(),
        action: ParticipantAction::Remove,
        participants: vec!["bo@acme.com".to_string()],
    }
    .call(ServiceContext(context), RequestContext::new(user_id()))
    .await
    .expect_err("missing channel");

    assert_eq!(error.description, "channel not found");
}
