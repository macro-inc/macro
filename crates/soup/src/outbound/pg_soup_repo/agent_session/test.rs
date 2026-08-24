use std::sync::Arc;

use super::*;
use item_filters::ast::EntityFilterAst;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::Query;

/// The "Macro Coder" system bot seeded by the `new_ai_agents` migration.
const CODER_BOT_ID: &str = "00000000-0000-0000-0000-00000000a9e7";

async fn insert_user(pool: &PgPool, user_id: &str) {
    let email = user_id.strip_prefix("macro|").unwrap_or(user_id);
    let macro_user_id = sqlx::query_scalar!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
        RETURNING id
        "#,
        Uuid::now_v7(),
        email,
        email,
        format!("stripe_{email}"),
    )
    .fetch_one(pool)
    .await
    .expect("insert macro_user");
    sqlx::query!(
        r#"
        INSERT INTO "User" (id, email, macro_user_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO NOTHING
        "#,
        user_id,
        email,
        macro_user_id,
    )
    .execute(pool)
    .await
    .expect("insert User");
}

/// Seed one session with its owner grant, the way the harness's create does.
async fn insert_session(pool: &PgPool, owner_id: &str) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO agent_session (
            id, owner_id, bot_id, model, harness, repo_url, workspace,
            title, pending_permission_count
        )
        VALUES ($1, $2, $3::uuid, 'claude-sonnet-5', 'claude-code',
                'https://github.com/example/example', '/workspace',
                'Fix the flaky test', 2)
        "#,
        id,
        owner_id,
        CODER_BOT_ID as &str,
    )
    .execute(pool)
    .await
    .expect("insert agent_session");
    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, 'agent_session', $2, 'user', 'owner')
        "#,
        id,
        owner_id,
    )
    .execute(pool)
    .await
    .expect("insert entity_access");
    id
}

fn include_filter() -> EntityFilterAst {
    EntityFilterAst {
        agent_session_filter: Some(Arc::new(Expr::val(AgentSessionLiteral::Include))),
        ..Default::default()
    }
}

fn request(user_id: &str, filter: Option<EntityFilterAst>) -> SimpleSortRequest<'static> {
    let cursor = match filter {
        Some(filter) => {
            SimpleSortQuery::ItemsFilter(Query::Sort(SimpleSortMethod::UpdatedAt, filter))
        }
        None => SimpleSortQuery::NoFilter(Query::Sort(SimpleSortMethod::UpdatedAt, ())),
    };
    SimpleSortRequest {
        limit: 10,
        cursor,
        user_id: MacroUserIdStr::parse_from_str(user_id)
            .expect("valid macro user id")
            .into_owned(),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn opting_in_lists_the_owners_sessions(pool: PgPool) -> anyhow::Result<()> {
    let owner = "macro|agent-soup-owner@example.com";
    insert_user(&pool, owner).await;
    let session_id = insert_session(&pool, owner).await;

    let items = cursor_soup(&pool, request(owner, Some(include_filter()))).await?;

    assert_eq!(items.len(), 1);
    let SoupItem::AgentSession(session) = &items[0] else {
        panic!("expected an agent session item");
    };
    assert_eq!(session.id, session_id);
    assert_eq!(session.owner_id, owner);
    assert_eq!(session.title.as_deref(), Some("Fix the flaky test"));
    assert_eq!(session.pending_permission_count, 2);
    assert_eq!(session.harness, "claude-code");
    assert!(matches!(
        session.status_kind,
        SoupAgentSessionStatusKind::NoMessages
    ));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sessions_are_opt_in(pool: PgPool) -> anyhow::Result<()> {
    let owner = "macro|agent-soup-optout@example.com";
    insert_user(&pool, owner).await;
    insert_session(&pool, owner).await;

    // No filter at all: the query never mentioned agent sessions.
    let items = cursor_soup(&pool, request(owner, None)).await?;
    assert!(items.is_empty());

    // A filter that says nothing about agent sessions is also an opt-out.
    let items = cursor_soup(&pool, request(owner, Some(EntityFilterAst::default()))).await?;
    assert!(items.is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sessions_are_access_gated(pool: PgPool) -> anyhow::Result<()> {
    let owner = "macro|agent-soup-private@example.com";
    let stranger = "macro|agent-soup-stranger@example.com";
    insert_user(&pool, owner).await;
    insert_user(&pool, stranger).await;
    insert_session(&pool, owner).await;

    let items = cursor_soup(&pool, request(stranger, Some(include_filter()))).await?;

    assert!(items.is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn by_ids_honors_access(pool: PgPool) -> anyhow::Result<()> {
    let owner = "macro|agent-soup-byids@example.com";
    let stranger = "macro|agent-soup-byids-stranger@example.com";
    insert_user(&pool, owner).await;
    insert_user(&pool, stranger).await;
    let session_id = insert_session(&pool, owner).await;

    let entities = [EntityType::AgentSession.with_entity_string(session_id.to_string())];
    let items = by_ids(
        &pool,
        AdvancedSortParams {
            entities: &entities,
            user_id: MacroUserIdStr::parse_from_str(owner)?,
        },
    )
    .await?;
    assert_eq!(items.len(), 1);

    let items = by_ids(
        &pool,
        AdvancedSortParams {
            entities: &entities,
            user_id: MacroUserIdStr::parse_from_str(stranger)?,
        },
    )
    .await?;
    assert!(items.is_empty());
    Ok(())
}
