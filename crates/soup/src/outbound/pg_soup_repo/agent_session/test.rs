use super::*;
use item_filters::ast::EntityFilterAst;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;

const OWNER: &str = "macro|agent-session-soup-owner@example.com";
const OTHER: &str = "macro|agent-session-soup-other@example.com";

/// Insert a `"User"` row (and its `macro_user` parent) so the id can satisfy
/// `agent_session.owner_id`'s foreign key.
async fn insert_user(pool: &PgPool, user_id: &str) -> anyhow::Result<()> {
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
    .await?;
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
    .await?;
    Ok(())
}

/// Seed a session owned by `owner`, with the standard owner access grant.
async fn insert_session(pool: &PgPool, owner: &str) -> anyhow::Result<Uuid> {
    let bot_id = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO bots (id, kind, name, handle)
        VALUES ($1, 'system', 'Test Agent', $2)
        "#,
        bot_id,
        format!("test-agent-{bot_id}"),
    )
    .execute(pool)
    .await?;
    let session_id = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO agent_session (
            id, owner_id, bot_id, model, harness, repo_url, workspace, title,
            status, status_event_name, pending_permission_count
        )
        VALUES (
            $1, $2, $3, 'claude-sonnet-5', 'claude-code',
            'https://github.com/macro-inc/macro', '/workspace', 'Fix the bug',
            'event', 'acp_ready', 2
        )
        "#,
        session_id,
        owner,
        bot_id,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO entity_access (
            entity_id, entity_type, source_id, source_type, access_level
        )
        VALUES ($1, 'agent_session', $2, 'user', 'owner')
        "#,
        session_id,
        owner,
    )
    .execute(pool)
    .await?;
    Ok(session_id)
}

fn include_filter() -> EntityFilterAst {
    let mut ast = EntityFilterAst::mock_empty();
    ast.agent_session_filter = Some(Arc::new(Expr::val(AgentSessionLiteral::Include)));
    ast
}

fn request(cursor: SimpleSortQuery, user: &'static str) -> SimpleSortRequest<'static> {
    SimpleSortRequest {
        limit: 10,
        cursor,
        user_id: MacroUserIdStr::parse_from_str(user).expect("valid macro user id"),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sessions_are_opt_in(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    insert_session(&pool, OWNER).await?;

    // A query that says nothing about agent sessions gets none.
    let items = cursor_soup(
        &pool,
        request(
            SimpleSortQuery::NoFilter(Query::Sort(SimpleSortMethod::UpdatedAt, ())),
            OWNER,
        ),
    )
    .await?;
    assert!(items.is_empty());

    // A filter that mentions sessions without opting in (owner only) gets none.
    let mut owner_only = EntityFilterAst::mock_empty();
    owner_only.agent_session_filter = Some(Arc::new(Expr::val(AgentSessionLiteral::Owner(
        OWNER.to_string(),
    ))));
    let items = cursor_soup(
        &pool,
        request(
            SimpleSortQuery::ItemsFilter(Query::Sort(SimpleSortMethod::UpdatedAt, owner_only)),
            OWNER,
        ),
    )
    .await?;
    assert!(items.is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn include_returns_only_accessible_sessions(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    insert_user(&pool, OTHER).await?;
    let mine = insert_session(&pool, OWNER).await?;
    let theirs = insert_session(&pool, OTHER).await?;

    let items = cursor_soup(
        &pool,
        request(
            SimpleSortQuery::ItemsFilter(Query::Sort(
                SimpleSortMethod::UpdatedAt,
                include_filter(),
            )),
            OWNER,
        ),
    )
    .await?;

    assert_eq!(items.len(), 1);
    let SoupItem::AgentSession(session) = &items[0] else {
        panic!("expected an agent session item");
    };
    assert_eq!(session.id, mine);
    assert_ne!(session.id, theirs);
    assert_eq!(session.title.as_deref(), Some("Fix the bug"));
    assert_eq!(session.status_kind, SoupAgentSessionStatusKind::Event);
    assert_eq!(session.status_event_name.as_deref(), Some("acp_ready"));
    assert_eq!(session.pending_permission_count, 2);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn by_ids_respects_access(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    insert_user(&pool, OTHER).await?;
    let mine = insert_session(&pool, OWNER).await?;
    let theirs = insert_session(&pool, OTHER).await?;

    let entities = [
        EntityType::AgentSession.with_entity_string(mine.to_string()),
        EntityType::AgentSession.with_entity_string(theirs.to_string()),
    ];
    let items = by_ids(
        &pool,
        AdvancedSortParams {
            entities: &entities,
            user_id: MacroUserIdStr::parse_from_str(OWNER)?,
        },
    )
    .await?;

    assert_eq!(items.len(), 1);
    assert!(matches!(
        &items[0],
        SoupItem::AgentSession(session) if session.id == mine
    ));
    Ok(())
}
