use super::*;
use crate::domain::model::{PrompterKind, TurnPrompter};
use agent_runtime_protocol::domain::action::AgentActionId;

const JOINER: &str = "macro|agent-session-joiner@example.com";

async fn user_grants(pool: &PgPool, id: AgentSessionId) -> Vec<(String, String)> {
    sqlx::query!(
        r#"
        SELECT source_id, access_level::text AS "access_level!"
        FROM entity_access
        WHERE entity_id = $1 AND entity_type = 'agent_session' AND source_type = 'user'
        ORDER BY source_id
        "#,
        id.as_uuid(),
    )
    .fetch_all(pool)
    .await
    .expect("read the session's user grants")
    .into_iter()
    .map(|row| (row.source_id, row.access_level))
    .collect()
}

async fn history_users(pool: &PgPool, id: AgentSessionId) -> Vec<String> {
    sqlx::query_scalar!(
        r#"SELECT "userId" FROM "UserHistory" WHERE "itemId" = $1 AND "itemType" = 'agent_session' ORDER BY "userId""#,
        id.as_uuid().to_string(),
    )
    .fetch_all(pool)
    .await
    .expect("read the session's history rows")
}

/// A person whose prompt joins someone else's session - an @mention in the
/// document, call or channel thread the session runs in - keeps edit access
/// to it and has it in their history, so it lists for them like their own.
/// Repeating the turn changes nothing; the owner's row is never touched.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_joining_prompter_gets_edit_access_and_history(pool: PgPool) {
    let repo = test_repo(&pool);
    let bot_id = create_test_bot(&pool).await;
    insert_user(&pool, JOINER).await;
    let session = create_session(&repo, new_session(bot_id, None, None)).await;

    for _ in 0..2 {
        repo.set_turn_prompter(
            session.id,
            &TurnPrompter {
                kind: PrompterKind::User,
                action_id: AgentActionId::mint(),
                user: Some(user_id(JOINER)),
            },
        )
        .await
        .unwrap();
    }

    assert_eq!(
        user_grants(&pool, session.id).await,
        vec![
            (JOINER.to_string(), "edit".to_string()),
            (OWNER.to_string(), "owner".to_string()),
        ]
    );
    assert_eq!(
        history_users(&pool, session.id).await,
        vec![JOINER.to_string(), OWNER.to_string()]
    );
    let prompter = repo.turn_prompter(session.id).await.unwrap().unwrap();
    assert_eq!(prompter.user, Some(user_id(JOINER)));
}

/// A weaker direct grant is raised to edit; an equal one is left alone.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_joining_prompter_grant_never_downgrades(pool: PgPool) {
    let repo = test_repo(&pool);
    let bot_id = create_test_bot(&pool).await;
    insert_user(&pool, JOINER).await;
    let session = create_session(&repo, new_session(bot_id, None, None)).await;

    for (held, expected) in [("view", "edit"), ("comment", "edit"), ("edit", "edit")] {
        sqlx::query!(
            r#"
            INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
            VALUES ($1, 'agent_session', $2, 'user', $3::text::"AccessLevel")
            ON CONFLICT (entity_id, entity_type, source_id, source_type)
            WHERE granted_from_project_id IS NULL
            DO UPDATE SET access_level = EXCLUDED.access_level
            "#,
            session.id.as_uuid(),
            JOINER,
            held,
        )
        .execute(&pool)
        .await
        .unwrap();

        repo.set_turn_prompter(
            session.id,
            &TurnPrompter {
                kind: PrompterKind::User,
                action_id: AgentActionId::mint(),
                user: Some(user_id(JOINER)),
            },
        )
        .await
        .unwrap();

        assert_eq!(
            user_grants(&pool, session.id).await,
            vec![
                (JOINER.to_string(), expected.to_string()),
                (OWNER.to_string(), "owner".to_string()),
            ],
            "held {held}"
        );
    }
}

/// Only a human other than the owner joins: the owner's own turns, system
/// turns and turns a bot runs on nobody's behalf grant nothing.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn owner_system_and_bot_turns_grant_nothing(pool: PgPool) {
    let repo = test_repo(&pool);
    let bot_id = create_test_bot(&pool).await;
    insert_user(&pool, JOINER).await;
    let session = create_session(&repo, new_session(bot_id, None, None)).await;

    for prompter in [
        TurnPrompter {
            kind: PrompterKind::User,
            action_id: AgentActionId::mint(),
            user: Some(user_id(OWNER)),
        },
        TurnPrompter {
            kind: PrompterKind::System,
            action_id: AgentActionId::mint(),
            user: Some(user_id(JOINER)),
        },
        TurnPrompter {
            kind: PrompterKind::User,
            action_id: AgentActionId::mint(),
            user: None,
        },
    ] {
        repo.set_turn_prompter(session.id, &prompter).await.unwrap();
    }

    assert_eq!(
        user_grants(&pool, session.id).await,
        vec![(OWNER.to_string(), "owner".to_string())]
    );
    assert_eq!(
        history_users(&pool, session.id).await,
        vec![OWNER.to_string()]
    );
}
