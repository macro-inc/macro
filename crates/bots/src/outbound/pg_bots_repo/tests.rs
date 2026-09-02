use super::*;
use crate::domain::{
    models::{
        AgentChannelScope, BotChannelListCaller, BotChannelType, CreateAgentRequest,
        CreateBotRequest, CreateBotTokenRequest, CreateChannelScopedBotRequest, PatchBotRequest,
        UpdateAgentRequest,
    },
    ports::{BotError, BotService},
    service::BotServiceImpl,
};
use entity_access::domain::models::{
    Entity, EntityAccessReceipt, EntityPermission, EntityType, MemberParticipantRole,
    ParticipantRole,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_event_broker::{EventBrokerError, MacroEvent, MacroEventBroker, NoopMacroEventBroker};
use serde_json::{Value, json};
use sqlx::PgPool;
use std::sync::{Arc, Mutex};

const USER_OWNER: &str = "macro|bot-owner@example.com";
const USER_OTHER: &str = "macro|bot-other@example.com";
const TEAM_MEMBER: &str = "macro|bot-team-member@example.com";
const TEAM_ADMIN: &str = "macro|bot-team-admin@example.com";
const TEAM_OWNER: &str = "macro|bot-team-owner@example.com";
const TEAM_OTHER: &str = "macro|bot-team-other@example.com";
fn user_id(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(value.to_string()).expect("valid macro user id")
}

fn channel_member_receipt(
    caller: &str,
    channel_id: Uuid,
) -> EntityAccessReceipt<MemberParticipantRole> {
    EntityAccessReceipt::try_new_authenticated_user(
        user_id(caller),
        Entity {
            entity_id: channel_id.to_string(),
            entity_type: EntityType::Channel,
        },
        EntityPermission::ChannelRole {
            role: ParticipantRole::Member,
        },
    )
    .expect("member role satisfies channel membership")
}

fn create_req(handle: &str) -> CreateBotRequest {
    CreateBotRequest {
        team_id: None,
        name: "Datadog Alerts".to_string(),
        handle: handle.to_string(),
        description: Some("Posts alarm notifications".to_string()),
        avatar_url: None,
        has_agent: None,
    }
}

fn create_channel_scoped_req(handle: &str) -> CreateChannelScopedBotRequest {
    CreateChannelScopedBotRequest {
        team_id: None,
        name: "Datadog Alerts".to_string(),
        handle: handle.to_string(),
        description: Some("Posts alarm notifications".to_string()),
        avatar_url: None,
        token_label: Some("Webhook".to_string()),
        token_expires_at: None,
        has_agent: None,
    }
}

fn create_agent_req(handle: &str, channel_scope: AgentChannelScope) -> CreateAgentRequest {
    CreateAgentRequest {
        team_id: None,
        name: "Bug fixer".to_string(),
        handle: handle.to_string(),
        description: Some("Finds and fixes bugs".to_string()),
        avatar_url: Some("https://static.example/bug-fixer.png".to_string()),
        instructions: "Fix the root cause and add tests.".to_string(),
        harness: "cursor".to_string(),
        harness_id: None,
        default_model: "cursor-small".to_string(),
        channel_scope,
        channel_ids: Vec::new(),
    }
}

fn update_agent_req(handle: &str, channel_scope: AgentChannelScope) -> UpdateAgentRequest {
    UpdateAgentRequest {
        team_id: None,
        name: "Updated bug fixer".to_string(),
        handle: handle.to_string(),
        description: None,
        avatar_url: None,
        instructions: "Diagnose first, then make the smallest tested fix.".to_string(),
        harness: "in-memory".to_string(),
        harness_id: None,
        default_model: "claude-sonnet-4-5".to_string(),
        channel_scope,
        channel_ids: Vec::new(),
    }
}

fn service(pool: &PgPool) -> BotServiceImpl<PgBotsRepo, NoopMacroEventBroker> {
    BotServiceImpl::new(PgBotsRepo::new(pool.clone()), NoopMacroEventBroker)
}

#[derive(Clone, Debug)]
struct PublishedEvent {
    topic: &'static str,
    key: String,
    payload: Value,
}

#[derive(Clone, Default)]
struct RecordingEventBroker {
    published: Arc<Mutex<Vec<PublishedEvent>>>,
    fail_scheduling: bool,
}

impl RecordingEventBroker {
    fn failing() -> Self {
        Self {
            fail_scheduling: true,
            ..Self::default()
        }
    }

    fn events(&self) -> Vec<PublishedEvent> {
        self.published.lock().expect("event lock poisoned").clone()
    }

    fn clear(&self) {
        self.published.lock().expect("event lock poisoned").clear();
    }
}

impl MacroEventBroker for RecordingEventBroker {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        if self.fail_scheduling {
            return Err(EventBrokerError::Publish(
                "intentional scheduling failure".to_string(),
            ));
        }

        self.published
            .lock()
            .expect("event lock poisoned")
            .push(PublishedEvent {
                topic: event.topic(),
                key: event.key().to_string(),
                payload: serde_json::to_value(event.event())?,
            });
        Ok(tokio::spawn(async { Ok(()) }))
    }
}

fn recording_service(
    pool: &PgPool,
    broker: RecordingEventBroker,
) -> BotServiceImpl<PgBotsRepo, RecordingEventBroker> {
    BotServiceImpl::new(PgBotsRepo::new(pool.clone()), broker)
}

fn assert_event(event: &PublishedEvent, bot_id: BotId, event_type: &str, metadata: Value) {
    assert_eq!(event.topic, "macro.bots");
    assert_eq!(event.key, bot_id.to_string());
    assert_eq!(event.payload["schema_version"], 1);
    assert_eq!(event.payload["event_type"], event_type);
    assert_eq!(event.payload["metadata"], metadata);
}

fn assert_no_token_material(payload: &Value, known_token: Option<&str>) {
    let serialized = serde_json::to_string(payload).expect("event serializes");
    if let Some(known_token) = known_token {
        assert!(!serialized.contains(known_token));
    }
    for forbidden_field in [
        "token",
        "bot_token",
        "bearer_token",
        "token_id",
        "token_hash",
        "token_prefix",
        "token_label",
        "label",
        "token_expires_at",
        "expires_at",
        "last_used_at",
        "revoked_at",
    ] {
        assert!(!serialized.contains(&format!("\"{forbidden_field}\"")));
    }
}

async fn insert_user(pool: &PgPool, user_id: &str) -> anyhow::Result<()> {
    let macro_user_id = Uuid::new_v4();
    let email = user_id.strip_prefix("macro|").unwrap_or(user_id);
    let stripe_customer_id = format!("stripe_{macro_user_id}");

    sqlx::query(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(macro_user_id)
    .bind(email)
    .bind(email)
    .bind(stripe_customer_id)
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO "User" (id, email, macro_user_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(user_id)
    .bind(email)
    .bind(macro_user_id)
    .execute(pool)
    .await?;

    Ok(())
}

async fn insert_team_user(
    pool: &PgPool,
    team_id: Uuid,
    user_id: &str,
    role: &str,
) -> anyhow::Result<()> {
    insert_user(pool, user_id).await?;
    sqlx::query!(
        r#"
        INSERT INTO team (id, name, owner_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO NOTHING
        "#,
        team_id,
        "Platform",
        user_id,
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        r#"
        INSERT INTO team_user (user_id, team_id, team_role)
        VALUES ($1, $2, $3::text::team_role)
        ON CONFLICT (user_id, team_id) DO NOTHING
        "#,
        user_id,
        team_id,
        role,
    )
    .execute(pool)
    .await?;

    Ok(())
}

async fn insert_channel(pool: &PgPool, channel_id: Uuid) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO comms_channels (id, name, channel_type, owner_id)
        VALUES ($1, $2, 'private'::comms_channel_type, $3)
        "#,
    )
    .bind(channel_id)
    .bind("alarms")
    .bind(USER_OWNER)
    .execute(pool)
    .await?;

    Ok(())
}

async fn insert_channel_member(
    pool: &PgPool,
    channel_id: Uuid,
    user_id: &str,
) -> anyhow::Result<()> {
    insert_channel(pool, channel_id).await?;
    sqlx::query!(
        r#"
        INSERT INTO comms_channel_participants (channel_id, user_id, role, left_at)
        VALUES ($1, $2, 'member'::comms_participant_role, NULL)
        "#,
        channel_id,
        user_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn active_channel_participant_count(
    pool: &PgPool,
    channel_id: Uuid,
    bot_id: BotId,
) -> anyhow::Result<i64> {
    let count = sqlx::query_scalar(
        r#"
        SELECT COUNT(*) AS "count!"
        FROM comms_channel_participants
        WHERE channel_id = $1
          AND user_id = $2
          AND left_at IS NULL
        "#,
    )
    .bind(channel_id)
    .bind(principal_id(bot_id))
    .fetch_one(pool)
    .await?;

    Ok(count)
}

async fn token_last_used_at(
    pool: &PgPool,
    token_id: Uuid,
) -> anyhow::Result<Option<chrono::DateTime<chrono::Utc>>> {
    let last_used_at = sqlx::query_scalar(
        r#"
        SELECT last_used_at
        FROM bot_tokens
        WHERE id = $1
        "#,
    )
    .bind(token_id)
    .fetch_one(pool)
    .await?;

    Ok(last_used_at)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn bot_active_in_channel_returns_true_for_active_membership(
    pool: PgPool,
) -> anyhow::Result<()> {
    let channel_id = Uuid::new_v4();
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    insert_channel(&pool, channel_id).await?;
    let repo = PgBotsRepo::new(pool);
    repo.add_bot_to_channel(channel_id, bot_id).await?;

    assert!(repo.bot_active_in_channel(channel_id, bot_id).await?);

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn bot_active_in_channel_returns_false_for_non_member(pool: PgPool) -> anyhow::Result<()> {
    let channel_id = Uuid::new_v4();
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    insert_channel(&pool, channel_id).await?;
    let repo = PgBotsRepo::new(pool);

    assert!(!repo.bot_active_in_channel(channel_id, bot_id).await?);

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn bot_active_in_channel_returns_false_for_soft_deleted_membership(
    pool: PgPool,
) -> anyhow::Result<()> {
    let channel_id = Uuid::new_v4();
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    insert_channel(&pool, channel_id).await?;
    let repo = PgBotsRepo::new(pool);
    repo.add_bot_to_channel(channel_id, bot_id).await?;
    assert!(repo.remove_bot_from_channel(channel_id, bot_id).await?);

    assert!(!repo.bot_active_in_channel(channel_id, bot_id).await?);

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_user_owned_bot_records_user_owner(pool: PgPool) -> anyhow::Result<()> {
    let service = service(&pool);

    let bot = service
        .create_bot(user_id(USER_OWNER), create_req("datadog"))
        .await?;

    assert_eq!(bot.kind, BotKind::Owned);
    assert_eq!(
        bot.owner,
        Some(BotOwner::User {
            user_id: USER_OWNER.to_string(),
        })
    );
    assert_eq!(bot.created_by.as_deref(), Some(USER_OWNER));
    assert_eq!(bot.handle, "datadog");
    assert!(!bot.has_agent);

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn created_agent_round_trips_every_agent_field(pool: PgPool) -> anyhow::Result<()> {
    let service = service(&pool);
    let created = service
        .create_agent(
            user_id(USER_OWNER),
            create_agent_req("bug-fixer", AgentChannelScope::All),
        )
        .await?;

    assert!(created.bot.has_agent);
    assert_eq!(created.bot.handle, "bug-fixer");
    assert_eq!(created.instructions, "Fix the root cause and add tests.");
    assert_eq!(created.harness, "cursor");
    assert_eq!(created.default_model, "cursor-small");
    assert_eq!(created.channel_scope, AgentChannelScope::All);
    assert!(created.channel_ids.is_empty());

    let listed = service.list_agents(user_id(USER_OWNER)).await?;
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].bot.id, created.bot.id);
    assert_eq!(listed[0].instructions, created.instructions);
    assert_eq!(listed[0].harness, created.harness);
    assert_eq!(listed[0].default_model, created.default_model);

    let fetched = PgBotsRepo::new(pool.clone())
        .get_agent(created.bot.id)
        .await?
        .expect("created agent should be addressable by bot id");
    assert_eq!(fetched.bot.id, created.bot.id);
    assert_eq!(fetched.instructions, created.instructions);
    assert_eq!(fetched.harness, created.harness);
    assert_eq!(fetched.default_model, created.default_model);

    assert!(service.list_agents(user_id(USER_OTHER)).await?.is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_team_agent_requires_membership_not_admin(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::new_v4();
    insert_team_user(&pool, team_id, TEAM_MEMBER, "member").await?;
    let service = service(&pool);
    let mut request = create_agent_req("member-agent", AgentChannelScope::All);
    request.team_id = Some(team_id);

    let created = service
        .create_agent(user_id(TEAM_MEMBER), request.clone())
        .await?;
    assert_eq!(created.bot.owner, Some(BotOwner::Team { team_id }));
    assert_eq!(created.bot.created_by.as_deref(), Some(TEAM_MEMBER));

    request.handle = "outsider-agent".to_string();
    let error = service
        .create_agent(user_id(TEAM_OTHER), request)
        .await
        .expect_err("a non-member must not create a team agent");
    assert!(matches!(error, BotError::Unauthorized));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn updated_agent_replaces_every_field_and_selected_channel(
    pool: PgPool,
) -> anyhow::Result<()> {
    let first = Uuid::new_v4();
    let second = Uuid::new_v4();
    insert_channel_member(&pool, first, USER_OWNER).await?;
    insert_channel_member(&pool, second, USER_OWNER).await?;
    let service = service(&pool);
    let mut create = create_agent_req("bug-fixer", AgentChannelScope::Selected);
    create.channel_ids = vec![first];
    let created = service.create_agent(user_id(USER_OWNER), create).await?;

    let mut update = update_agent_req("updated-fixer", AgentChannelScope::Selected);
    update.channel_ids = vec![second];
    let updated = service
        .update_agent(user_id(USER_OWNER), created.bot.id, update)
        .await?;

    assert_eq!(updated.bot.name, "Updated bug fixer");
    assert_eq!(updated.bot.handle, "updated-fixer");
    assert_eq!(updated.bot.description, None);
    assert_eq!(updated.bot.avatar_url, None);
    assert_eq!(
        updated.instructions,
        "Diagnose first, then make the smallest tested fix."
    );
    assert_eq!(updated.harness, "in-memory");
    assert_eq!(updated.default_model, "claude-sonnet-4-5");
    assert_eq!(updated.channel_ids, vec![second]);
    assert_eq!(
        active_channel_participant_count(&pool, first, created.bot.id).await?,
        0
    );
    assert_eq!(
        active_channel_participant_count(&pool, second, created.bot.id).await?,
        1
    );

    let listed = service.list_agents(user_id(USER_OWNER)).await?;
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].bot.handle, "updated-fixer");
    assert_eq!(listed[0].channel_ids, vec![second]);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_member_creator_can_change_agent_share_between_private_and_team(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::new_v4();
    insert_team_user(&pool, team_id, TEAM_MEMBER, "member").await?;
    let service = service(&pool);
    let created = service
        .create_agent(
            user_id(TEAM_MEMBER),
            create_agent_req("share-fixer", AgentChannelScope::All),
        )
        .await?;

    let mut make_team = update_agent_req("share-fixer", AgentChannelScope::All);
    make_team.team_id = Some(team_id);
    let team_agent = service
        .update_agent(user_id(TEAM_MEMBER), created.bot.id, make_team)
        .await?;
    assert_eq!(team_agent.bot.owner, Some(BotOwner::Team { team_id }));

    let make_private = update_agent_req("share-fixer", AgentChannelScope::All);
    let private_agent = service
        .update_agent(user_id(TEAM_MEMBER), created.bot.id, make_private)
        .await?;
    assert_eq!(
        private_agent.bot.owner,
        Some(BotOwner::User {
            user_id: TEAM_MEMBER.to_string(),
        })
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_member_can_update_team_agent_but_cannot_make_it_private(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::new_v4();
    insert_team_user(&pool, team_id, TEAM_ADMIN, "admin").await?;
    insert_team_user(&pool, team_id, TEAM_MEMBER, "member").await?;
    let service = service(&pool);
    let mut create = create_agent_req("team-fixer", AgentChannelScope::All);
    create.team_id = Some(team_id);
    let created = service.create_agent(user_id(TEAM_ADMIN), create).await?;

    let mut update = update_agent_req("changed-by-member", AgentChannelScope::All);
    update.team_id = Some(team_id);
    let updated = service
        .update_agent(user_id(TEAM_MEMBER), created.bot.id, update)
        .await?;
    assert_eq!(updated.bot.handle, "changed-by-member");
    assert_eq!(updated.bot.owner, Some(BotOwner::Team { team_id }));

    let error = service
        .update_agent(
            user_id(TEAM_MEMBER),
            created.bot.id,
            update_agent_req("made-private-by-member", AgentChannelScope::All),
        )
        .await
        .expect_err("only the creator may make a team agent private");
    assert!(matches!(error, BotError::Unauthorized));

    let listed = service.list_agents(user_id(TEAM_ADMIN)).await?;
    assert_eq!(listed[0].bot.handle, "changed-by-member");
    assert_eq!(listed[0].bot.owner, Some(BotOwner::Team { team_id }));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn selected_agent_is_created_atomically_in_authorized_channels(
    pool: PgPool,
) -> anyhow::Result<()> {
    let first = Uuid::new_v4();
    let second = Uuid::new_v4();
    insert_channel_member(&pool, first, USER_OWNER).await?;
    insert_channel_member(&pool, second, USER_OWNER).await?;
    let service = service(&pool);
    let mut request = create_agent_req("channel-fixer", AgentChannelScope::Selected);
    request.channel_ids = vec![first, second];

    let created = service.create_agent(user_id(USER_OWNER), request).await?;
    assert_eq!(created.channel_ids, vec![first, second]);
    assert_eq!(
        active_channel_participant_count(&pool, first, created.bot.id).await?,
        1
    );
    assert_eq!(
        active_channel_participant_count(&pool, second, created.bot.id).await?,
        1
    );

    let listed = service.list_agents(user_id(USER_OWNER)).await?;
    assert_eq!(listed[0].channel_ids.len(), 2);
    assert!(listed[0].channel_ids.contains(&first));
    assert!(listed[0].channel_ids.contains(&second));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn selected_agent_rejects_channels_the_caller_cannot_access(
    pool: PgPool,
) -> anyhow::Result<()> {
    let channel_id = Uuid::new_v4();
    insert_channel(&pool, channel_id).await?;
    let service = service(&pool);
    let mut request = create_agent_req("unauthorized-fixer", AgentChannelScope::Selected);
    request.channel_ids = vec![channel_id];

    let error = service
        .create_agent(user_id(USER_OTHER), request)
        .await
        .expect_err("a non-member must not create an agent in the channel");
    assert!(matches!(error, BotError::Unauthorized));
    assert!(service.list_agents(user_id(USER_OTHER)).await?.is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_bot_stores_requested_has_agent(pool: PgPool) -> anyhow::Result<()> {
    let service = service(&pool);
    let mut request = create_req("agent-bot");
    request.has_agent = Some(true);

    let bot = service.create_bot(user_id(USER_OWNER), request).await?;

    assert!(bot.has_agent);
    assert!(
        service
            .get_bot(user_id(USER_OWNER), bot.id)
            .await?
            .has_agent
    );

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn patch_bot_toggles_has_agent_and_leaves_it_unchanged_when_omitted(
    pool: PgPool,
) -> anyhow::Result<()> {
    let service = service(&pool);
    let bot = service
        .create_bot(user_id(USER_OWNER), create_req("agent-toggle"))
        .await?;
    assert!(!bot.has_agent);

    let enabled = service
        .patch_bot(
            user_id(USER_OWNER),
            bot.id,
            PatchBotRequest {
                name: None,
                handle: None,
                description: None,
                avatar_url: None,
                has_agent: Some(true),
            },
        )
        .await?;
    assert!(enabled.has_agent);

    let renamed = service
        .patch_bot(
            user_id(USER_OWNER),
            bot.id,
            PatchBotRequest {
                name: Some("Renamed".to_string()),
                handle: None,
                description: None,
                avatar_url: None,
                has_agent: None,
            },
        )
        .await?;
    assert_eq!(renamed.name, "Renamed");
    assert!(renamed.has_agent);

    let disabled = service
        .patch_bot(
            user_id(USER_OWNER),
            bot.id,
            PatchBotRequest {
                name: None,
                handle: None,
                description: None,
                avatar_url: None,
                has_agent: Some(false),
            },
        )
        .await?;
    assert!(!disabled.has_agent);

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_team_owned_bot_requires_team_admin_or_owner(pool: PgPool) -> anyhow::Result<()> {
    let service = service(&pool);
    let team_id = Uuid::new_v4();
    insert_team_user(&pool, team_id, TEAM_OWNER, "owner").await?;
    insert_team_user(&pool, team_id, TEAM_ADMIN, "admin").await?;
    insert_team_user(&pool, team_id, TEAM_MEMBER, "member").await?;

    for (creator, handle) in [(TEAM_OWNER, "team-owner"), (TEAM_ADMIN, "team-admin")] {
        let mut req = create_req(handle);
        req.team_id = Some(team_id);

        let bot = service.create_bot(user_id(creator), req).await?;
        assert_eq!(bot.owner, Some(BotOwner::Team { team_id }));
    }

    let mut req = create_req("team-member");
    req.team_id = Some(team_id);
    let err = service
        .create_bot(user_id(TEAM_MEMBER), req.clone())
        .await
        .expect_err("ordinary team member must not create a team-owned bot");
    assert!(matches!(err, BotError::Unauthorized));

    let err = service
        .create_bot(user_id(TEAM_OTHER), req)
        .await
        .expect_err("non-team member must not create a team-owned bot");
    assert!(matches!(err, BotError::Unauthorized));

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_creator_or_team_owner_can_delete_team_bots(pool: PgPool) -> anyhow::Result<()> {
    let service = service(&pool);
    let team_id = Uuid::new_v4();
    insert_team_user(&pool, team_id, TEAM_OWNER, "owner").await?;
    insert_team_user(&pool, team_id, TEAM_ADMIN, "admin").await?;
    insert_team_user(&pool, team_id, TEAM_MEMBER, "member").await?;

    let mut admin_bot_request = create_req("admin-team-bot");
    admin_bot_request.team_id = Some(team_id);
    let admin_bot = service
        .create_bot(user_id(TEAM_ADMIN), admin_bot_request)
        .await?;

    let member_delete = service.delete_bot(user_id(TEAM_MEMBER), admin_bot.id).await;
    assert!(matches!(member_delete, Err(BotError::Unauthorized)));
    service
        .delete_bot(user_id(TEAM_OWNER), admin_bot.id)
        .await?;

    let mut owner_bot_request = create_req("owner-team-bot");
    owner_bot_request.team_id = Some(team_id);
    let owner_bot = service
        .create_bot(user_id(TEAM_OWNER), owner_bot_request)
        .await?;

    let admin_delete = service.delete_bot(user_id(TEAM_ADMIN), owner_bot.id).await;
    assert!(matches!(admin_delete, Err(BotError::Unauthorized)));

    let mut member_agent_request = create_agent_req("member-team-agent", AgentChannelScope::All);
    member_agent_request.team_id = Some(team_id);
    let member_agent = service
        .create_agent(user_id(TEAM_MEMBER), member_agent_request)
        .await?;

    let admin_delete = service
        .delete_bot(user_id(TEAM_ADMIN), member_agent.bot.id)
        .await;
    assert!(matches!(admin_delete, Err(BotError::Unauthorized)));
    service
        .delete_bot(user_id(TEAM_MEMBER), member_agent.bot.id)
        .await?;

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_team_owned_channel_scoped_bot_requires_team_admin(
    pool: PgPool,
) -> anyhow::Result<()> {
    let service = service(&pool);
    let team_id = Uuid::new_v4();
    let channel_id = Uuid::new_v4();
    insert_team_user(&pool, team_id, TEAM_ADMIN, "admin").await?;
    insert_team_user(&pool, team_id, TEAM_MEMBER, "member").await?;
    insert_channel(&pool, channel_id).await?;

    let mut req = create_channel_scoped_req("team-scoped-channel");
    req.team_id = Some(team_id);

    let err = service
        .create_channel_scoped_bot(user_id(TEAM_MEMBER), channel_id, req.clone())
        .await
        .expect_err("ordinary team member must not create a team-owned channel-scoped bot");
    assert!(matches!(err, BotError::Unauthorized));

    let created = service
        .create_channel_scoped_bot(user_id(TEAM_ADMIN), channel_id, req)
        .await?;
    assert_eq!(created.bot.owner, Some(BotOwner::Team { team_id }));

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn add_remove_channel_bot_requires_bot_usability_and_soft_removes(
    pool: PgPool,
) -> anyhow::Result<()> {
    let service = service(&pool);
    let channel_id = Uuid::new_v4();
    insert_channel(&pool, channel_id).await?;

    let bot = service
        .create_bot(user_id(USER_OWNER), create_req("ops-alerts"))
        .await?;

    let err = service
        .add_bot_to_channel(channel_member_receipt(USER_OTHER, channel_id), bot.id)
        .await
        .expect_err("non-owner must not add someone else's bot");
    assert!(matches!(err, BotError::Unauthorized));

    service
        .add_bot_to_channel(channel_member_receipt(USER_OWNER, channel_id), bot.id)
        .await?;

    let active_count: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*) AS "count!"
        FROM comms_channel_participants
        WHERE channel_id = $1
          AND user_id = $2
          AND left_at IS NULL
        "#,
    )
    .bind(channel_id)
    .bind(principal_id(bot.id))
    .fetch_one(&pool)
    .await?;
    assert_eq!(active_count, 1);

    let err = service
        .remove_bot_from_channel(user_id(USER_OTHER), channel_id, bot.id)
        .await
        .expect_err("non-owner must not remove someone else's bot");
    assert!(matches!(err, BotError::Unauthorized));

    service
        .remove_bot_from_channel(user_id(USER_OWNER), channel_id, bot.id)
        .await?;

    let left_at: Option<chrono::DateTime<chrono::Utc>> = sqlx::query_scalar(
        r#"
        SELECT left_at
        FROM comms_channel_participants
        WHERE channel_id = $1 AND user_id = $2
        "#,
    )
    .bind(channel_id)
    .bind(principal_id(bot.id))
    .fetch_one(&pool)
    .await?;

    assert!(left_at.is_some());
    assert!(service.list_channel_bots(channel_id).await?.is_empty());

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_bot_channels_requires_manageable_bot_and_returns_only_active_channels(
    pool: PgPool,
) -> anyhow::Result<()> {
    let service = service(&pool);
    let active_channel_id = Uuid::new_v4();
    let removed_channel_id = Uuid::new_v4();
    insert_channel(&pool, active_channel_id).await?;
    insert_channel(&pool, removed_channel_id).await?;

    let bot = service
        .create_bot(user_id(USER_OWNER), create_req("channel-list"))
        .await?;
    let empty_bot = service
        .create_bot(user_id(USER_OWNER), create_req("empty-channel-list"))
        .await?;

    let err = service
        .list_bot_channels(BotChannelListCaller::User(user_id(USER_OTHER)), bot.id)
        .await
        .expect_err("non-owner must not list someone else's bot channels");
    assert!(matches!(err, BotError::Unauthorized));

    let empty_channels = service
        .list_bot_channels(
            BotChannelListCaller::User(user_id(USER_OWNER)),
            empty_bot.id,
        )
        .await?;
    assert!(empty_channels.is_empty());

    service
        .add_bot_to_channel(
            channel_member_receipt(USER_OWNER, removed_channel_id),
            bot.id,
        )
        .await?;
    service
        .remove_bot_from_channel(user_id(USER_OWNER), removed_channel_id, bot.id)
        .await?;
    service
        .add_bot_to_channel(
            channel_member_receipt(USER_OWNER, active_channel_id),
            bot.id,
        )
        .await?;

    let channels = service
        .list_bot_channels(BotChannelListCaller::User(user_id(USER_OWNER)), bot.id)
        .await?;

    assert_eq!(channels.len(), 1);
    assert_eq!(channels[0].channel_id, active_channel_id);
    assert_eq!(channels[0].name.as_deref(), Some("alarms"));
    assert_eq!(channels[0].channel_type, BotChannelType::Private);
    assert!(channels[0].joined_at <= chrono::Utc::now());

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_channel_scoped_bot_creates_bot_participant_and_token(
    pool: PgPool,
) -> anyhow::Result<()> {
    let service = service(&pool);
    let channel_id = Uuid::new_v4();
    insert_channel(&pool, channel_id).await?;

    let created = service
        .create_channel_scoped_bot(
            user_id(USER_OWNER),
            channel_id,
            CreateChannelScopedBotRequest {
                has_agent: Some(true),
                ..create_channel_scoped_req("scoped-alerts")
            },
        )
        .await?;

    assert_eq!(created.bot.kind, BotKind::Owned);
    assert_eq!(created.bot.handle, "scoped-alerts");
    assert!(created.bot.has_agent);
    assert_eq!(created.bot.created_by.as_deref(), Some(USER_OWNER));
    assert_eq!(created.token.bot_id, created.bot.id);
    assert_eq!(created.token.label.as_deref(), Some("Webhook"));
    assert_eq!(
        created.token.token_prefix,
        bot_token::token_prefix(&created.bot_token)
    );
    assert_ne!(created.token.token_prefix, created.bot_token);
    assert_eq!(
        active_channel_participant_count(&pool, channel_id, created.bot.id).await?,
        1
    );

    let authenticated = service
        .authenticate_channel_token(channel_id, &created.bot_token)
        .await?;
    assert_eq!(authenticated.bot_id, created.bot.id);
    assert_eq!(authenticated.kind, BotKind::Owned);
    assert!(token_last_used_at(&pool, created.token.id).await?.is_some());

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn authenticate_channel_token_rejects_wrong_channel_without_marking_used(
    pool: PgPool,
) -> anyhow::Result<()> {
    let service = service(&pool);
    let channel_id = Uuid::new_v4();
    let other_channel_id = Uuid::new_v4();
    insert_channel(&pool, channel_id).await?;
    insert_channel(&pool, other_channel_id).await?;

    let created = service
        .create_channel_scoped_bot(
            user_id(USER_OWNER),
            channel_id,
            create_channel_scoped_req("wrong-channel"),
        )
        .await?;

    let err = service
        .authenticate_channel_token(other_channel_id, &created.bot_token)
        .await
        .expect_err("channel-scoped token must not authenticate for another channel");

    assert!(matches!(err, BotError::Unauthorized));
    assert!(token_last_used_at(&pool, created.token.id).await?.is_none());

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn authenticate_channel_token_rejects_revoked_token(pool: PgPool) -> anyhow::Result<()> {
    let service = service(&pool);
    let channel_id = Uuid::new_v4();
    insert_channel(&pool, channel_id).await?;

    let created = service
        .create_channel_scoped_bot(
            user_id(USER_OWNER),
            channel_id,
            create_channel_scoped_req("revoked-scoped"),
        )
        .await?;

    service
        .revoke_token(user_id(USER_OWNER), created.bot.id, created.token.id)
        .await?;

    let err = service
        .authenticate_channel_token(channel_id, &created.bot_token)
        .await
        .expect_err("revoked channel-scoped token must not authenticate");

    assert!(matches!(err, BotError::Unauthorized));
    assert!(token_last_used_at(&pool, created.token.id).await?.is_none());

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn authenticate_channel_token_rejects_removed_channel_membership(
    pool: PgPool,
) -> anyhow::Result<()> {
    let service = service(&pool);
    let channel_id = Uuid::new_v4();
    insert_channel(&pool, channel_id).await?;

    let created = service
        .create_channel_scoped_bot(
            user_id(USER_OWNER),
            channel_id,
            create_channel_scoped_req("removed-scoped"),
        )
        .await?;

    service
        .remove_bot_from_channel(user_id(USER_OWNER), channel_id, created.bot.id)
        .await?;

    let err = service
        .authenticate_channel_token(channel_id, &created.bot_token)
        .await
        .expect_err("removed bot participant must not authenticate");

    assert!(matches!(err, BotError::Unauthorized));
    assert!(token_last_used_at(&pool, created.token.id).await?.is_none());

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn revoke_token_prevents_future_authentication(pool: PgPool) -> anyhow::Result<()> {
    let service = service(&pool);
    let bot = service
        .create_bot(user_id(USER_OWNER), create_req("pagerduty"))
        .await?;

    let created = service
        .create_token(
            user_id(USER_OWNER),
            bot.id,
            CreateBotTokenRequest {
                label: Some("Datadog".to_string()),
                expires_at: None,
            },
        )
        .await?;

    assert_eq!(
        created.token.token_prefix,
        bot_token::token_prefix(&created.bearer_token)
    );
    assert_ne!(created.token.token_prefix, created.bearer_token);

    let authenticated = service.authenticate_token(&created.bearer_token).await?;
    assert_eq!(authenticated.bot_id, bot.id);
    assert_eq!(authenticated.kind, BotKind::Owned);

    service
        .revoke_token(user_id(USER_OWNER), bot.id, created.token.id)
        .await?;

    let err = service
        .authenticate_token(&created.bearer_token)
        .await
        .expect_err("revoked token must not authenticate");
    assert!(matches!(err, BotError::Unauthorized));

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_tokens_returns_prefix_not_raw_secret(pool: PgPool) -> anyhow::Result<()> {
    let service = service(&pool);
    let bot = service
        .create_bot(user_id(USER_OWNER), create_req("listed-token"))
        .await?;

    let created = service
        .create_token(
            user_id(USER_OWNER),
            bot.id,
            CreateBotTokenRequest {
                label: Some("Listable".to_string()),
                expires_at: None,
            },
        )
        .await?;

    let tokens = service.list_tokens(user_id(USER_OWNER), bot.id).await?;

    assert_eq!(tokens.len(), 1);
    assert_eq!(tokens[0].id, created.token.id);
    assert_eq!(tokens[0].bot_id, bot.id);
    assert_eq!(tokens[0].token_prefix, created.token.token_prefix);
    assert_ne!(tokens[0].token_prefix, created.bearer_token);
    assert_eq!(tokens[0].label.as_deref(), Some("Listable"));

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn authenticate_channel_token_accepts_migrated_uuid_token(
    pool: PgPool,
) -> anyhow::Result<()> {
    let service = service(&pool);
    let channel_id = Uuid::new_v4();
    insert_channel(&pool, channel_id).await?;

    let bot = service
        .create_bot(user_id(USER_OWNER), create_req("migrated-uuid-token"))
        .await?;
    service
        .add_bot_to_channel(channel_member_receipt(USER_OWNER, channel_id), bot.id)
        .await?;

    let token_id = Uuid::new_v4();
    let raw_token = Uuid::new_v4().to_string();
    let hashed = bot_token::HashedBotToken::from_raw(&raw_token);
    sqlx::query(
        r#"
        INSERT INTO bot_tokens (id, bot_id, token_hash, token_prefix, label)
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(token_id)
    .bind(bot.id.as_uuid())
    .bind(&hashed.hash[..])
    .bind(&hashed.prefix)
    .bind("migrated row")
    .execute(&pool)
    .await?;

    let authenticated = service
        .authenticate_channel_token(channel_id, &raw_token)
        .await?;

    assert_eq!(authenticated.bot_id, bot.id);
    assert_eq!(authenticated.kind, BotKind::Owned);
    assert!(token_last_used_at(&pool, token_id).await?.is_some());

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn rust_token_hash_matches_postgres_digest(pool: PgPool) -> anyhow::Result<()> {
    let raw = "mbot_aabbccddeeff_aabbccddeeffsecret";
    let rust_hash = bot_token::hash_token(raw);
    let postgres_hash =
        sqlx::query_scalar!(r#"SELECT digest(convert_to($1, 'UTF8'), 'sha256')"#, raw,)
            .fetch_one(&pool)
            .await?
            .expect("pgcrypto digest returns bytea");

    assert_eq!(rust_hash.as_slice(), postgres_hash.as_slice());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn lifecycle_creation_publishes_exact_sanitized_events(pool: PgPool) -> anyhow::Result<()> {
    let broker = RecordingEventBroker::default();
    let service = recording_service(&pool, broker.clone());
    let user_bot = service
        .create_bot(user_id(USER_OWNER), create_req("event-user"))
        .await?;

    let team_id = Uuid::new_v4();
    insert_team_user(&pool, team_id, TEAM_ADMIN, "admin").await?;
    let mut team_request = create_req("event-team");
    team_request.team_id = Some(team_id);
    let team_bot = service
        .create_bot(user_id(TEAM_ADMIN), team_request)
        .await?;

    let channel_id = Uuid::new_v4();
    insert_channel(&pool, channel_id).await?;
    let channel_bot = service
        .create_channel_scoped_bot(
            user_id(USER_OWNER),
            channel_id,
            create_channel_scoped_req("event-channel"),
        )
        .await?;

    let events = broker.events();
    assert_eq!(events.len(), 3);
    assert_event(
        &events[0],
        user_bot.id,
        "bot.created",
        json!({
            "bot_id": user_bot.id,
            "kind": "owned",
            "owner": { "type": "user", "user_id": USER_OWNER },
            "name": user_bot.name,
            "handle": user_bot.handle,
            "description": user_bot.description,
            "avatar_url": user_bot.avatar_url,
            "created_by_user_id": USER_OWNER,
            "channel_id": null,
            "created_at": user_bot.created_at,
        }),
    );
    assert_event(
        &events[1],
        team_bot.id,
        "bot.created",
        json!({
            "bot_id": team_bot.id,
            "kind": "owned",
            "owner": { "type": "team", "team_id": team_id },
            "name": team_bot.name,
            "handle": team_bot.handle,
            "description": team_bot.description,
            "avatar_url": team_bot.avatar_url,
            "created_by_user_id": TEAM_ADMIN,
            "channel_id": null,
            "created_at": team_bot.created_at,
        }),
    );
    assert_event(
        &events[2],
        channel_bot.bot.id,
        "bot.created",
        json!({
            "bot_id": channel_bot.bot.id,
            "kind": "owned",
            "owner": { "type": "user", "user_id": USER_OWNER },
            "name": channel_bot.bot.name,
            "handle": channel_bot.bot.handle,
            "description": channel_bot.bot.description,
            "avatar_url": channel_bot.bot.avatar_url,
            "created_by_user_id": USER_OWNER,
            "channel_id": channel_id,
            "created_at": channel_bot.bot.created_at,
        }),
    );
    for event in &events {
        assert_no_token_material(&event.payload, Some(&channel_bot.bot_token));
    }

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn patch_and_delete_publish_requested_fields_and_team_owner(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::new_v4();
    insert_team_user(&pool, team_id, TEAM_ADMIN, "admin").await?;
    let broker = RecordingEventBroker::default();
    let service = recording_service(&pool, broker.clone());
    let mut create_request = create_req("event-mutations");
    create_request.team_id = Some(team_id);
    let bot = service
        .create_bot(user_id(TEAM_ADMIN), create_request)
        .await?;
    broker.clear();

    let patch_request = PatchBotRequest {
        name: Some("Renamed alerts".to_string()),
        handle: None,
        description: Some("Replacement description".to_string()),
        avatar_url: None,
        has_agent: None,
    };
    let patched = service
        .patch_bot(user_id(TEAM_ADMIN), bot.id, patch_request)
        .await?;

    let events = broker.events();
    assert_eq!(events.len(), 1);
    assert_event(
        &events[0],
        bot.id,
        "bot.updated",
        json!({
            "bot_id": bot.id,
            "owner": { "type": "team", "team_id": team_id },
            "actor_user_id": TEAM_ADMIN,
            "name": "Renamed alerts",
            "handle": null,
            "description": "Replacement description",
            "avatar_url": null,
            "updated_at": patched.updated_at,
        }),
    );
    assert_no_token_material(&events[0].payload, None);

    broker.clear();
    service.delete_bot(user_id(TEAM_ADMIN), bot.id).await?;
    let events = broker.events();
    assert_eq!(events.len(), 1);
    assert_event(
        &events[0],
        bot.id,
        "bot.deleted",
        json!({
            "bot_id": bot.id,
            "owner": { "type": "team", "team_id": team_id },
            "actor_user_id": TEAM_ADMIN,
        }),
    );
    assert_no_token_material(&events[0].payload, None);

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn non_lifecycle_and_failed_operations_do_not_publish(pool: PgPool) -> anyhow::Result<()> {
    let broker = RecordingEventBroker::default();
    let service = recording_service(&pool, broker.clone());
    let channel_id = Uuid::new_v4();
    insert_channel(&pool, channel_id).await?;
    let bot = service
        .create_bot(user_id(USER_OWNER), create_req("event-exclusions"))
        .await?;
    broker.clear();

    service.list_bots(user_id(USER_OWNER)).await?;
    service.get_bot(user_id(USER_OWNER), bot.id).await?;
    service.list_channel_bots(channel_id).await?;
    service
        .add_bot_to_channel(channel_member_receipt(USER_OWNER, channel_id), bot.id)
        .await?;
    service
        .list_bot_channels(BotChannelListCaller::User(user_id(USER_OWNER)), bot.id)
        .await?;
    service
        .remove_bot_from_channel(user_id(USER_OWNER), channel_id, bot.id)
        .await?;

    let token = service
        .create_token(
            user_id(USER_OWNER),
            bot.id,
            CreateBotTokenRequest {
                label: Some("No event".to_string()),
                expires_at: None,
            },
        )
        .await?;
    service.list_tokens(user_id(USER_OWNER), bot.id).await?;
    service.authenticate_token(&token.bearer_token).await?;
    service
        .revoke_token(user_id(USER_OWNER), bot.id, token.token.id)
        .await?;

    let unauthorized = service
        .patch_bot(
            user_id(USER_OTHER),
            bot.id,
            PatchBotRequest {
                name: Some("Forbidden".to_string()),
                handle: None,
                description: None,
                avatar_url: None,
                has_agent: None,
            },
        )
        .await;
    assert!(matches!(unauthorized, Err(BotError::Unauthorized)));

    let missing = service
        .delete_bot(user_id(USER_OWNER), BotId::new_from_uuid(Uuid::new_v4()))
        .await;
    assert!(matches!(missing, Err(BotError::NotFound(_))));

    let repository_failure = service
        .create_channel_scoped_bot(
            user_id(USER_OWNER),
            Uuid::new_v4(),
            create_channel_scoped_req("missing-channel"),
        )
        .await;
    assert!(matches!(repository_failure, Err(BotError::Repo(_))));
    assert!(broker.events().is_empty());

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn scheduling_failures_do_not_change_successful_mutations(
    pool: PgPool,
) -> anyhow::Result<()> {
    let service = recording_service(&pool, RecordingEventBroker::failing());
    let channel_id = Uuid::new_v4();
    insert_channel(&pool, channel_id).await?;
    let channel_bot = service
        .create_channel_scoped_bot(
            user_id(USER_OWNER),
            channel_id,
            create_channel_scoped_req("scoped-schedule-failure"),
        )
        .await?;
    assert_eq!(channel_bot.bot.handle, "scoped-schedule-failure");

    let bot = service
        .create_bot(user_id(USER_OWNER), create_req("event-schedule-failure"))
        .await?;
    let patched = service
        .patch_bot(
            user_id(USER_OWNER),
            bot.id,
            PatchBotRequest {
                name: Some("Still succeeds".to_string()),
                handle: None,
                description: None,
                avatar_url: None,
                has_agent: None,
            },
        )
        .await?;
    assert_eq!(patched.name, "Still succeeds");
    service.delete_bot(user_id(USER_OWNER), bot.id).await?;

    Ok(())
}

async fn insert_harness(
    pool: &PgPool,
    owner_user_id: Option<&str>,
    team_id: Option<Uuid>,
) -> anyhow::Result<HarnessId> {
    let harness_id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO harnesses (id, name, owner_user_id, team_id, created_by)
        VALUES ($1, 'test harness', $2, $3, $4)
        "#,
        harness_id,
        owner_user_id,
        team_id,
        owner_user_id.unwrap_or(USER_OWNER),
    )
    .execute(pool)
    .await?;
    Ok(HarnessId::new_from_uuid(harness_id))
}

fn macrod_agent_req(handle: &str, harness_id: Option<HarnessId>) -> CreateAgentRequest {
    CreateAgentRequest {
        harness: "macrod".to_string(),
        harness_id,
        ..create_agent_req(handle, AgentChannelScope::All)
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn macrod_agents_require_a_registered_usable_harness(pool: PgPool) -> anyhow::Result<()> {
    let service = service(&pool);
    insert_user(&pool, USER_OWNER).await?;
    insert_user(&pool, USER_OTHER).await?;

    // The slug and the binding travel together.
    let missing_id = service
        .create_agent(user_id(USER_OWNER), macrod_agent_req("macrod-agent", None))
        .await;
    assert!(matches!(missing_id, Err(BotError::BadRequest(_))));

    let mut mismatched = create_agent_req("mismatched-agent", AgentChannelScope::All);
    mismatched.harness_id = Some(HarnessId::new_from_uuid(Uuid::new_v4()));
    let mismatched = service.create_agent(user_id(USER_OWNER), mismatched).await;
    assert!(matches!(mismatched, Err(BotError::BadRequest(_))));

    // An unknown harness id is rejected.
    let unknown = service
        .create_agent(
            user_id(USER_OWNER),
            macrod_agent_req(
                "unknown-harness",
                Some(HarnessId::new_from_uuid(Uuid::new_v4())),
            ),
        )
        .await;
    assert!(matches!(unknown, Err(BotError::BadRequest(_))));

    // The owner binds their own private harness; a stranger cannot.
    let private_harness = insert_harness(&pool, Some(USER_OWNER), None).await?;
    let agent = service
        .create_agent(
            user_id(USER_OWNER),
            macrod_agent_req("my-macrod-agent", Some(private_harness)),
        )
        .await?;
    assert_eq!(agent.harness, "macrod");
    assert_eq!(agent.harness_id, Some(private_harness));

    let stranger = service
        .create_agent(
            user_id(USER_OTHER),
            macrod_agent_req("stolen-harness", Some(private_harness)),
        )
        .await;
    assert!(matches!(stranger, Err(BotError::Unauthorized)));

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_harnesses_back_member_agents_but_not_team_agents_on_private_harnesses(
    pool: PgPool,
) -> anyhow::Result<()> {
    let service = service(&pool);
    insert_user(&pool, USER_OWNER).await?;
    let team_id = Uuid::new_v4();
    insert_team_user(&pool, team_id, TEAM_OWNER, "owner").await?;
    insert_team_user(&pool, team_id, TEAM_MEMBER, "member").await?;
    let team_harness = insert_harness(&pool, None, Some(team_id)).await?;

    // A member's private agent may run on the team harness.
    let member_agent = service
        .create_agent(
            user_id(TEAM_MEMBER),
            macrod_agent_req("member-on-team-harness", Some(team_harness)),
        )
        .await?;
    assert_eq!(member_agent.harness_id, Some(team_harness));

    // A team agent may run on the team's own harness.
    let mut team_agent = macrod_agent_req("team-on-team-harness", Some(team_harness));
    team_agent.team_id = Some(team_id);
    let team_agent = service
        .create_agent(user_id(TEAM_MEMBER), team_agent)
        .await?;
    assert_eq!(team_agent.harness_id, Some(team_harness));

    // A non-member cannot use the team harness.
    insert_user(&pool, USER_OTHER).await?;
    let outsider = service
        .create_agent(
            user_id(USER_OTHER),
            macrod_agent_req("outsider-on-team-harness", Some(team_harness)),
        )
        .await;
    assert!(matches!(outsider, Err(BotError::Unauthorized)));

    // A team agent must never run on a private harness.
    let private_harness = insert_harness(&pool, Some(TEAM_MEMBER), None).await?;
    let mut team_on_private = macrod_agent_req("team-on-private-harness", Some(private_harness));
    team_on_private.team_id = Some(team_id);
    let team_on_private = service
        .create_agent(user_id(TEAM_MEMBER), team_on_private)
        .await;
    assert!(matches!(team_on_private, Err(BotError::Unauthorized)));

    // Updates re-check the binding: moving the member's agent onto their own
    // private harness works, and clearing the slug clears the binding.
    let mut update = update_agent_req("member-on-team-harness", AgentChannelScope::All);
    update.harness = "macrod".to_string();
    update.harness_id = Some(private_harness);
    let updated = service
        .update_agent(user_id(TEAM_MEMBER), member_agent.bot.id, update)
        .await?;
    assert_eq!(updated.harness_id, Some(private_harness));

    let mut cleared = update_agent_req("member-on-team-harness", AgentChannelScope::All);
    cleared.harness = "in-memory".to_string();
    let cleared = service
        .update_agent(user_id(TEAM_MEMBER), member_agent.bot.id, cleared)
        .await?;
    assert_eq!(cleared.harness_id, None);

    Ok(())
}
