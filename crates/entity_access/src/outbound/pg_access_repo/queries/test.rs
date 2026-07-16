use std::collections::HashSet;

use super::*;
use bot_id::BotId;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

const OWNER: &str = "macro|sharedbox@corp.test";
const DELEGATE: &str = "macro|primary@corp.test";
const BOT_OWNER: &str = "macro|bot-owner@corp.test";

/// macro_user + "User" rows so macro_user_links FKs resolve.
async fn insert_user(pool: &PgPool, user_id: &str, email: &str) {
    let macro_uuid = Uuid::new_v4();
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id)
           VALUES ($1, $2, $3, $4)"#,
        macro_uuid,
        user_id,
        email,
        user_id,
    )
    .execute(pool)
    .await
    .unwrap();

    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#,
        user_id,
        email,
        macro_uuid,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_team(pool: &PgPool, team_id: Uuid) {
    insert_user(pool, BOT_OWNER, "bot-owner@corp.test").await;
    sqlx::query!(
        r#"INSERT INTO team (id, name, owner_id) VALUES ($1, 'Bot Team', $2)"#,
        team_id,
        BOT_OWNER,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_owned_bot(
    pool: &PgPool,
    bot_id: BotId,
    owner_user_id: Option<&str>,
    team_id: Option<Uuid>,
) {
    sqlx::query!(
        r#"
        INSERT INTO bots (id, kind, owner_user_id, team_id, name, handle)
        VALUES ($1, 'owned', $2, $3, 'Test Bot', 'test-bot')
        "#,
        bot_id.as_uuid(),
        owner_user_id,
        team_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_channel(pool: &PgPool, channel_id: Uuid) {
    sqlx::query!(
        r#"
        INSERT INTO comms_channels (id, name, channel_type, owner_id)
        VALUES ($1, 'Bot Channel', 'public', $2)
        "#,
        channel_id,
        BOT_OWNER,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_bot_participant(pool: &PgPool, channel_id: Uuid, bot_id: BotId, departed: bool) {
    let principal = bot_id.into_storage_id();
    sqlx::query!(
        r#"
        INSERT INTO comms_channel_participants (channel_id, role, user_id, left_at)
        VALUES (
            $1,
            'member',
            $2,
            CASE WHEN $3 THEN now() ELSE NULL END
        )
        "#,
        channel_id,
        principal.as_ref(),
        departed,
    )
    .execute(pool)
    .await
    .unwrap();
}

fn source_id_set(source_ids: SourceIds) -> HashSet<String> {
    source_ids.0.into_iter().collect()
}

/// An empty link + thread owned by `owner_macro_id`. Returns `(link_id, thread_id)`.
async fn insert_thread(pool: &PgPool, owner_macro_id: &str, email: &str) -> (Uuid, Uuid) {
    let link_id = Uuid::new_v4();
    let thread_id = Uuid::new_v4();

    sqlx::query!(
        r#"INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
           VALUES ($1, $2, $2, $3, 'GMAIL')"#,
        link_id,
        owner_macro_id,
        email,
    )
    .execute(pool)
    .await
    .unwrap();

    sqlx::query!(
        r#"INSERT INTO email_threads (id, link_id) VALUES ($1, $2)"#,
        thread_id,
        link_id,
    )
    .execute(pool)
    .await
    .unwrap();

    (link_id, thread_id)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn bot_source_ids_team_scoped_bot_includes_channels_team_and_principal(
    pool: PgPool,
) -> anyhow::Result<()> {
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let bot_principal = bot_id.into_storage_id();
    let team_id = Uuid::new_v4();
    let first_channel_id = Uuid::new_v4();
    let second_channel_id = Uuid::new_v4();
    insert_team(&pool, team_id).await;
    insert_owned_bot(&pool, bot_id, None, Some(team_id)).await;
    insert_channel(&pool, first_channel_id).await;
    insert_channel(&pool, second_channel_id).await;
    insert_bot_participant(&pool, first_channel_id, bot_id, false).await;
    insert_bot_participant(&pool, second_channel_id, bot_id, false).await;

    let source_ids = source_id_set(get_bot_source_ids(&pool, &bot_principal).await?);
    let expected = HashSet::from([
        first_channel_id.to_string(),
        second_channel_id.to_string(),
        team_id.to_string(),
        bot_principal.to_string(),
    ]);

    assert_eq!(source_ids, expected);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn bot_source_ids_user_scoped_bot_does_not_inherit_owner(pool: PgPool) -> anyhow::Result<()> {
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let bot_principal = bot_id.into_storage_id();
    insert_owned_bot(&pool, bot_id, Some(BOT_OWNER), None).await;

    let source_ids = source_id_set(get_bot_source_ids(&pool, &bot_principal).await?);

    assert_eq!(source_ids, HashSet::from([bot_principal.to_string()]));
    assert!(!source_ids.contains(BOT_OWNER));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn bot_source_ids_soft_deleted_bot_has_no_sources(pool: PgPool) -> anyhow::Result<()> {
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let bot_principal = bot_id.into_storage_id();
    let team_id = Uuid::new_v4();
    let channel_id = Uuid::new_v4();
    insert_team(&pool, team_id).await;
    insert_owned_bot(&pool, bot_id, None, Some(team_id)).await;
    insert_channel(&pool, channel_id).await;
    insert_bot_participant(&pool, channel_id, bot_id, false).await;
    sqlx::query!(
        "UPDATE bots SET deleted_at = now() WHERE id = $1",
        bot_id.as_uuid(),
    )
    .execute(&pool)
    .await?;

    let source_ids = source_id_set(get_bot_source_ids(&pool, &bot_principal).await?);

    assert!(source_ids.is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn bot_source_ids_excludes_departed_channels(pool: PgPool) -> anyhow::Result<()> {
    let bot_id = BotId::new_from_uuid(Uuid::new_v4());
    let bot_principal = bot_id.into_storage_id();
    let channel_id = Uuid::new_v4();
    insert_owned_bot(&pool, bot_id, Some(BOT_OWNER), None).await;
    insert_channel(&pool, channel_id).await;
    insert_bot_participant(&pool, channel_id, bot_id, true).await;

    let source_ids = source_id_set(get_bot_source_ids(&pool, &bot_principal).await?);

    assert_eq!(source_ids, HashSet::from([bot_principal.to_string()]));
    assert!(!source_ids.contains(&channel_id.to_string()));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_entity_users_includes_inbox_delegate(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER, "sharedbox@corp.test").await;
    insert_user(&pool, DELEGATE, "primary@corp.test").await;
    let (link_id, thread_id) = insert_thread(&pool, OWNER, "sharedbox@corp.test").await;

    sqlx::query!(
        r#"INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id)
           VALUES ($1, $2, $3)"#,
        DELEGATE,
        OWNER,
        link_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    let users = get_entity_users(&pool, &thread_id, EntityType::EmailThread).await?;
    let ids: std::collections::HashSet<String> = users.iter().map(|u| u.to_string()).collect();

    assert!(ids.contains(OWNER), "inbox owner must be included");
    assert!(ids.contains(DELEGATE), "inbox delegate must be included");
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_entity_users_excludes_delegate_scoped_to_other_link(
    pool: PgPool,
) -> anyhow::Result<()> {
    insert_user(&pool, OWNER, "sharedbox@corp.test").await;
    insert_user(&pool, DELEGATE, "primary@corp.test").await;
    let (granted_link_id, _) = insert_thread(&pool, OWNER, "sharedbox@corp.test").await;
    let (_, other_thread_id) = insert_thread(&pool, OWNER, "other@corp.test").await;

    sqlx::query!(
        r#"INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id)
           VALUES ($1, $2, $3)"#,
        DELEGATE,
        OWNER,
        granted_link_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    let users = get_entity_users(&pool, &other_thread_id, EntityType::EmailThread).await?;
    let ids: std::collections::HashSet<String> = users.iter().map(|u| u.to_string()).collect();

    assert!(ids.contains(OWNER), "inbox owner must be included");
    assert!(
        !ids.contains(DELEGATE),
        "delegate scoped to a different link must be excluded"
    );
    Ok(())
}
