use super::*;
use crate::domain::{
    models::{
        BotChannelType, CreateBotRequest, CreateBotTokenRequest, CreateChannelScopedBotRequest,
    },
    ports::{BotError, BotService},
    service::BotServiceImpl,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

const USER_OWNER: &str = "macro|bot-owner@example.com";
const USER_OTHER: &str = "macro|bot-other@example.com";
const TEAM_MEMBER: &str = "macro|bot-team-member@example.com";
const TEAM_OTHER: &str = "macro|bot-team-other@example.com";

fn user_id(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(value.to_string()).expect("valid macro user id")
}

fn create_req(handle: &str) -> CreateBotRequest {
    CreateBotRequest {
        team_id: None,
        name: "Datadog Alerts".to_string(),
        handle: handle.to_string(),
        description: Some("Posts alarm notifications".to_string()),
        avatar_url: None,
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
    }
}

fn service(pool: &PgPool) -> BotServiceImpl<PgBotsRepo> {
    BotServiceImpl::new(PgBotsRepo::new(pool.clone()))
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

async fn insert_team_member(pool: &PgPool, team_id: Uuid, member_id: &str) -> anyhow::Result<()> {
    insert_user(pool, member_id).await?;
    sqlx::query(
        r#"
        INSERT INTO team (id, name, owner_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(team_id)
    .bind("Platform")
    .bind(member_id)
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO team_user (user_id, team_id, team_role)
        VALUES ($1, $2, 'member'::team_role)
        ON CONFLICT (user_id, team_id) DO NOTHING
        "#,
    )
    .bind(member_id)
    .bind(team_id)
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

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_team_owned_bot_requires_team_membership(pool: PgPool) -> anyhow::Result<()> {
    let service = service(&pool);
    let team_id = Uuid::new_v4();
    insert_team_member(&pool, team_id, TEAM_MEMBER).await?;

    let mut req = create_req("team-datadog");
    req.team_id = Some(team_id);

    let bot = service
        .create_bot(user_id(TEAM_MEMBER), req.clone())
        .await?;

    assert_eq!(bot.owner, Some(BotOwner::Team { team_id }));

    let err = service
        .create_bot(user_id(TEAM_OTHER), req)
        .await
        .expect_err("non-team member must not create team-owned bot");

    assert!(matches!(err, BotError::Unauthorized));

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
        .add_bot_to_channel(user_id(USER_OTHER), channel_id, bot.id)
        .await
        .expect_err("non-owner must not add someone else's bot");
    assert!(matches!(err, BotError::Unauthorized));

    service
        .add_bot_to_channel(user_id(USER_OWNER), channel_id, bot.id)
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
        .list_bot_channels(user_id(USER_OTHER), bot.id)
        .await
        .expect_err("non-owner must not list someone else's bot channels");
    assert!(matches!(err, BotError::Unauthorized));

    let empty_channels = service
        .list_bot_channels(user_id(USER_OWNER), empty_bot.id)
        .await?;
    assert!(empty_channels.is_empty());

    service
        .add_bot_to_channel(user_id(USER_OWNER), removed_channel_id, bot.id)
        .await?;
    service
        .remove_bot_from_channel(user_id(USER_OWNER), removed_channel_id, bot.id)
        .await?;
    service
        .add_bot_to_channel(user_id(USER_OWNER), active_channel_id, bot.id)
        .await?;

    let channels = service
        .list_bot_channels(user_id(USER_OWNER), bot.id)
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
            create_channel_scoped_req("scoped-alerts"),
        )
        .await?;

    assert_eq!(created.bot.kind, BotKind::Owned);
    assert_eq!(created.bot.handle, "scoped-alerts");
    assert_eq!(created.bot.created_by.as_deref(), Some(USER_OWNER));
    assert_eq!(created.token.bot_id, created.bot.id);
    assert_eq!(created.token.label.as_deref(), Some("Webhook"));
    assert_eq!(created.token.token, created.bot_token);
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

    assert_eq!(created.token.token, created.bearer_token);

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
async fn list_tokens_returns_raw_token_for_manageable_bot(pool: PgPool) -> anyhow::Result<()> {
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
    assert_eq!(tokens[0].token, created.bearer_token);
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
        .add_bot_to_channel(user_id(USER_OWNER), channel_id, bot.id)
        .await?;

    let token_id = Uuid::new_v4();
    let raw_token = Uuid::new_v4().to_string();
    sqlx::query(
        r#"
        INSERT INTO bot_tokens (id, bot_id, token, label)
        VALUES ($1, $2, $3, $4)
        "#,
    )
    .bind(token_id)
    .bind(bot.id.as_uuid())
    .bind(&raw_token)
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
