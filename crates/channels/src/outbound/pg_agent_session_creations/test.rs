use super::*;
use crate::domain::models::ReferencedShareItemType;
use chrono::{Duration, SubsecRound};
use macro_db_migrator::MACRO_DB_MIGRATIONS;

const THREAD_ROOT: Uuid = Uuid::from_u128(1);
const SESSION_BOT: BotId = BotId::TEST_A;
const OTHER_BOT: BotId = BotId::TEST_B;

async fn start_session(pool: &PgPool, started_at: DateTime<Utc>) {
    sqlx::query!(
        r#"
        INSERT INTO comms_messages (id, sender_id, content, parent_entity_type, parent_entity_id)
        VALUES ($1, 'macro|owner@example.com', 'root', 'document', 'parent')
        "#,
        THREAD_ROOT,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO agent_session (id, owner_id, thread_id, bot_id, model, harness, workspace, created_at)
        VALUES ($1, 'macro|owner@example.com', $2, $3, 'model', 'harness', 'workspace', $4)
        "#,
        Uuid::from_u128(2),
        THREAD_ROOT,
        SESSION_BOT.as_uuid(),
        started_at,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn record_creation(pool: &PgPool, actor: BotId, document_id: &str, at: DateTime<Utc>) {
    let actor = actor.into_storage_id();
    sqlx::query!(
        r#"
        INSERT INTO activity_events (id, actor_id, subject_id, action, entity_type, entity_id, occurred_at)
        VALUES ($1, $2, 'macro|owner@example.com', 'created', 'document', $3, $4)
        "#,
        Uuid::new_v4(),
        actor.as_ref(),
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
async fn only_what_the_session_bot_created_after_it_started_counts(pool: PgPool) {
    let started_at = Utc::now() - Duration::minutes(5);
    start_session(&pool, started_at).await;
    record_creation(
        &pool,
        SESSION_BOT,
        "created-in-session",
        started_at + Duration::seconds(1),
    )
    .await;
    record_creation(
        &pool,
        SESSION_BOT,
        "created-before",
        started_at - Duration::days(1),
    )
    .await;
    record_creation(
        &pool,
        OTHER_BOT,
        "created-by-another-bot",
        started_at + Duration::seconds(1),
    )
    .await;
    let creations = PgAgentSessionCreations::new(pool);

    assert_eq!(
        creations
            .session_started_at(THREAD_ROOT, SESSION_BOT)
            .await
            .unwrap(),
        Some(started_at.trunc_subsecs(6))
    );
    assert_eq!(
        creations
            .session_started_at(THREAD_ROOT, OTHER_BOT)
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        creations
            .created_since(
                SESSION_BOT,
                started_at,
                vec![
                    document("created-in-session"),
                    document("created-before"),
                    document("created-by-another-bot"),
                    document("never-recorded"),
                ],
            )
            .await
            .unwrap(),
        vec![document("created-in-session")]
    );
}
