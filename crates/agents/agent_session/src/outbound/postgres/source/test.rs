use super::super::test::{create_test_bot, new_session, test_repo};
use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use trigger_context::origin::Caller;

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("user@example.com").unwrap()
}

async fn stored_kind(pool: &PgPool, session: AgentSessionId) -> Option<String> {
    sqlx::query_scalar!(
        r#"
        SELECT source.kind
        FROM agent_session session
        JOIN agent_session_source source ON source.id = session.source_id
        WHERE session.id = $1
        "#,
        session.as_uuid(),
    )
    .fetch_optional(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_session_is_created_with_its_source_and_deleted_with_it(pool: PgPool) {
    let repo = test_repo(&pool);
    let bot = create_test_bot(&pool).await;
    let message_id = macro_uuid::generate_uuid_v7();
    let session = AgentSessionRepo::create(
        &repo,
        CreateAgentSessionParams {
            origin: TriggerOrigin::Mentioned {
                by: Caller::Person { user: user() },
                message_id,
            },
            ..new_session(bot, None, None)
        },
    )
    .await
    .unwrap();

    assert_eq!(
        stored_kind(&pool, session.id).await.as_deref(),
        Some("mentioned")
    );
    assert_eq!(
        AgentSessionRepo::get(&repo, session.id)
            .await
            .unwrap()
            .origin,
        TriggerOrigin::Mentioned {
            by: Caller::Person { user: user() },
            message_id,
        }
    );
    let stored_message = sqlx::query_scalar!(
        "SELECT message_id FROM agent_session_source WHERE message_id = $1",
        message_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stored_message, Some(message_id));

    AgentSessionRepo::delete(&repo, session.id).await.unwrap();

    let remaining = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM agent_session_source WHERE message_id = $1"#,
        message_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(remaining, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_failed_session_create_leaves_no_source(pool: PgPool) {
    let repo = test_repo(&pool);
    let bot = create_test_bot(&pool).await;
    let existing = AgentSessionRepo::create(&repo, new_session(bot, None, None))
        .await
        .unwrap();

    let refused = AgentSessionRepo::create(
        &repo,
        CreateAgentSessionParams {
            id: existing.id,
            origin: TriggerOrigin::Requested { by: user() },
            ..new_session(bot, None, None)
        },
    )
    .await;

    assert!(refused.is_err());
    let sources = sqlx::query_scalar!(r#"SELECT COUNT(*) AS "count!" FROM agent_session_source"#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(sources, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_unknown_origin_stores_nothing(pool: PgPool) {
    let repo = test_repo(&pool);
    let bot = create_test_bot(&pool).await;

    let session = AgentSessionRepo::create(&repo, new_session(bot, None, None))
        .await
        .unwrap();

    assert_eq!(stored_kind(&pool, session.id).await, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_table_refuses_an_origin_the_enum_cannot_express(pool: PgPool) {
    let routine_with_a_person = sqlx::query!(
        r#"
        INSERT INTO agent_session_source (id, kind, routine_id, routine_firing, actor_user_id)
        VALUES ($1, 'routine', $2, 'manual', 'macro|user@example.com')
        "#,
        macro_uuid::generate_uuid_v7(),
        macro_uuid::generate_uuid_v7(),
    )
    .execute(&pool)
    .await;
    assert!(routine_with_a_person.is_err());

    let scheduled_with_an_event = sqlx::query!(
        r#"
        INSERT INTO agent_session_source (id, kind, routine_id, routine_firing, event_id)
        VALUES ($1, 'routine', $2, 'scheduled', $3)
        "#,
        macro_uuid::generate_uuid_v7(),
        macro_uuid::generate_uuid_v7(),
        macro_uuid::generate_uuid_v7(),
    )
    .execute(&pool)
    .await;
    assert!(scheduled_with_an_event.is_err());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_agent_and_its_lineage_read_back_as_stored(pool: PgPool) {
    let repo = test_repo(&pool);
    let bot = create_test_bot(&pool).await;
    let origin = TriggerOrigin::TaskAssigned {
        by: Caller::Agent(AgentActor {
            bot,
            on_behalf_of: user(),
            lineage: Lineage::Session {
                session: macro_uuid::generate_uuid_v7(),
                root: Root::Routine {
                    routine: macro_uuid::generate_uuid_v7(),
                },
            },
        }),
        task: "task-1".to_owned(),
    };

    let session = AgentSessionRepo::create(
        &repo,
        CreateAgentSessionParams {
            origin: origin.clone(),
            ..new_session(bot, None, None)
        },
    )
    .await
    .unwrap();

    assert_eq!(session.origin, origin);
}
