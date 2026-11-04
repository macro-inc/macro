use super::*;
use crate::domain::models::ReferencedShareItemType;
use chrono::{Duration, SubsecRound};
use macro_db_migrator::MACRO_DB_MIGRATIONS;

const CHANNEL: Uuid = Uuid::from_u128(100);
const THREAD_ROOT: Uuid = Uuid::from_u128(1);
const REPLYING_BOT: BotId = BotId::TEST_A;
const OTHER_BOT: BotId = BotId::TEST_B;
const PERSON: &str = "macro|person@example.com";
const SOMEONE_ELSE: &str = "macro|someone-else@example.com";

fn person() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(PERSON.to_owned()).unwrap()
}

async fn post(pool: &PgPool, id: Uuid, thread_id: Option<Uuid>, sender: &str, at: DateTime<Utc>) {
    sqlx::query!(
        r#"
        INSERT INTO comms_channels (id, channel_type, owner_id)
        VALUES ($1, 'private', $2)
        ON CONFLICT DO NOTHING
        "#,
        CHANNEL,
        PERSON,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO comms_messages
            (id, thread_id, sender_id, content, parent_entity_type, parent_entity_id, created_at)
        VALUES ($1, $2, $3, 'message', 'channel', $5, $4)
        "#,
        id,
        thread_id,
        sender,
        at,
        CHANNEL.to_string(),
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn record_creation(
    pool: &PgPool,
    actor: BotId,
    subject: &str,
    document_id: &str,
    at: DateTime<Utc>,
) {
    let actor = actor.into_storage_id();
    sqlx::query!(
        r#"
        INSERT INTO activity_events (id, actor_id, subject_id, action, entity_type, entity_id, occurred_at)
        VALUES ($1, $2, $3, 'created', 'document', $4, $5)
        "#,
        Uuid::now_v7(),
        actor.as_ref(),
        subject,
        document_id,
        at,
    )
    .execute(pool)
    .await
    .unwrap();
}

fn document(id: &str) -> ReferencedShareItem {
    ReferencedShareItem::new(id, ReferencedShareItemType::Document)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_request_is_the_persons_latest_message_in_the_thread_before_the_reply(pool: PgPool) {
    let root_at = Utc::now() - Duration::hours(1);
    let follow_up_at = root_at + Duration::minutes(10);
    let reply_at = follow_up_at + Duration::minutes(1);
    post(&pool, THREAD_ROOT, None, PERSON, root_at).await;
    post(
        &pool,
        Uuid::from_u128(2),
        Some(THREAD_ROOT),
        PERSON,
        follow_up_at,
    )
    .await;
    post(
        &pool,
        Uuid::from_u128(3),
        Some(THREAD_ROOT),
        SOMEONE_ELSE,
        reply_at,
    )
    .await;
    post(
        &pool,
        Uuid::from_u128(4),
        Some(THREAD_ROOT),
        PERSON,
        reply_at + Duration::minutes(1),
    )
    .await;
    let creations = PgAgentCreations::new(pool);

    assert_eq!(
        creations
            .request_sent_at(THREAD_ROOT, &person(), reply_at)
            .await
            .unwrap(),
        Some(follow_up_at.trunc_subsecs(6)),
        "a later message from the person, or anyone else's, is not the request"
    );
    assert_eq!(
        creations
            .request_sent_at(THREAD_ROOT, &person(), root_at + Duration::seconds(1))
            .await
            .unwrap(),
        Some(root_at.trunc_subsecs(6)),
        "the person's root message is a request too"
    );
    assert_eq!(
        creations
            .request_sent_at(Uuid::from_u128(9), &person(), reply_at)
            .await
            .unwrap(),
        None
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_channel_request_is_the_persons_latest_message_anywhere_in_the_channel(pool: PgPool) {
    let asked_at = Utc::now() - Duration::minutes(5);
    let posted_at = asked_at + Duration::minutes(2);
    post(
        &pool,
        THREAD_ROOT,
        None,
        PERSON,
        asked_at - Duration::hours(1),
    )
    .await;
    post(&pool, Uuid::from_u128(2), None, PERSON, asked_at).await;
    post(
        &pool,
        Uuid::from_u128(3),
        None,
        SOMEONE_ELSE,
        asked_at + Duration::minutes(1),
    )
    .await;
    let bot_post = Uuid::from_u128(4);
    post(
        &pool,
        bot_post,
        None,
        "bot|00000000-0000-0000-0000-00000000a2a2",
        posted_at,
    )
    .await;

    assert_eq!(
        PgAgentCreations::new(pool)
            .channel_request_sent_at(CHANNEL, &person(), posted_at)
            .await
            .unwrap(),
        Some(asked_at.trunc_subsecs(6))
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_what_the_replying_bot_created_for_the_person_since_the_request_counts(pool: PgPool) {
    let requested_at = Utc::now() - Duration::minutes(5);
    let after = requested_at + Duration::seconds(1);
    record_creation(
        &pool,
        REPLYING_BOT,
        PERSON,
        "created-for-the-request",
        after,
    )
    .await;
    record_creation(
        &pool,
        REPLYING_BOT,
        PERSON,
        "created-before",
        requested_at - Duration::days(1),
    )
    .await;
    record_creation(&pool, OTHER_BOT, PERSON, "created-by-another-bot", after).await;
    record_creation(
        &pool,
        REPLYING_BOT,
        SOMEONE_ELSE,
        "created-for-someone-else",
        after,
    )
    .await;
    let creations = PgAgentCreations::new(pool);

    assert_eq!(
        creations
            .created_since(
                REPLYING_BOT,
                &person(),
                requested_at,
                vec![
                    document("created-for-the-request"),
                    document("created-before"),
                    document("created-by-another-bot"),
                    document("created-for-someone-else"),
                    document("never-recorded"),
                ],
            )
            .await
            .unwrap(),
        vec![document("created-for-the-request")]
    );
}
