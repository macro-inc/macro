use macro_db_migrator::MACRO_DB_MIGRATIONS;

use super::*;

fn target(entity_type: EntityType, entity_id: Uuid) -> Target {
    Target {
        entity_type,
        entity_id: entity_id.to_string(),
        part_id: None,
    }
}

async fn channel(pool: &PgPool) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO comms_channels (id, channel_type, owner_id) VALUES ($1, 'private', 'macro|parts@macro.com')",
    )
    .bind(id)
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn channel_message(pool: &PgPool, channel: Uuid) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO comms_messages (id, sender_id, content, parent_entity_type, parent_entity_id)
         VALUES ($1, 'macro|parts@macro.com', 'hi', 'channel', $2)",
    )
    .bind(id)
    .bind(channel.to_string())
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn email_message(pool: &PgPool, link: Uuid, thread: Uuid) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO email_messages (id, thread_id, link_id) VALUES ($1, $2, $3)")
        .bind(id)
        .bind(thread)
        .bind(link)
        .execute(pool)
        .await
        .unwrap();
    id
}

async fn email_thread(pool: &PgPool, link: Uuid) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO email_threads (id, link_id) VALUES ($1, $2)")
        .bind(id)
        .bind(link)
        .execute(pool)
        .await
        .unwrap();
    id
}

async fn email_link(pool: &PgPool) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
         VALUES ($1, 'macro|parts@macro.com', 'fa', 'parts@macro.com', 'GMAIL')",
    )
    .bind(id)
    .execute(pool)
    .await
    .unwrap();
    id
}

/// An idea names a part only together with the item it belongs to.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_part_counts_only_with_its_own_item(pool: PgPool) {
    let (channel, other_channel) = (channel(&pool).await, Uuid::now_v7());
    let message = channel_message(&pool, channel).await;
    let link = email_link(&pool).await;
    let (thread, other_thread) = (
        email_thread(&pool, link).await,
        email_thread(&pool, link).await,
    );
    let mail = email_message(&pool, link, thread).await;
    let part = |id: Uuid| id.to_string();

    for (item, part_id, expected) in [
        (target(EntityType::Channel, channel), part(message), true),
        (
            target(EntityType::Channel, other_channel),
            part(message),
            false,
        ),
        (target(EntityType::EmailThread, thread), part(mail), true),
        (
            target(EntityType::EmailThread, other_thread),
            part(mail),
            false,
        ),
        // A channel's message isn't a part of an email thread, nor the reverse.
        (
            target(EntityType::EmailThread, thread),
            part(message),
            false,
        ),
        (target(EntityType::Channel, channel), part(mail), false),
        // Other items have no parts an idea can name.
        (target(EntityType::Document, channel), part(message), false),
        (
            target(EntityType::Channel, channel),
            "not-an-id".to_owned(),
            false,
        ),
    ] {
        assert_eq!(
            part_of(&pool, &item, &part_id).await.unwrap(),
            expected,
            "{item:?} with part {part_id}"
        );
    }
}
