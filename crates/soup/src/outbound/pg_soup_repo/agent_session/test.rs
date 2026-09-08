use super::*;
use item_filters::ast::EntityFilterAst;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;

const OWNER: &str = "macro|agent-owner@test.com";
const MEMBER: &str = "macro|agent-member@test.com";
const STRANGER: &str = "macro|agent-stranger@test.com";
const BOT_ID: Uuid = Uuid::from_u128(0xa9e7);
const CHANNEL_ID: Uuid = Uuid::from_u128(0xc05);

struct Fixture {
    /// Owned by `OWNER`, granted to `CHANNEL_ID` (where `MEMBER` participates).
    shared: Uuid,
    /// Owned by `OWNER` only.
    private: Uuid,
}

async fn seed(pool: &PgPool) -> anyhow::Result<Fixture> {
    for user in [OWNER, MEMBER, STRANGER] {
        let macro_user_id = Uuid::now_v7();
        sqlx::query!(
            "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)",
            macro_user_id,
            user,
        )
        .execute(pool)
        .await?;
        sqlx::query!(
            r#"INSERT INTO "User" ("id", "email", "macro_user_id") VALUES ($1, $1, $2)"#,
            user,
            macro_user_id,
        )
        .execute(pool)
        .await?;
    }
    sqlx::query!(
        r#"
        INSERT INTO comms_channels (id, name, channel_type, owner_id)
        VALUES ($1, 'agents', 'public', $2)
        "#,
        CHANNEL_ID,
        OWNER,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO comms_channel_participants (channel_id, user_id, role)
        VALUES ($1, $2, 'owner'), ($1, $3, 'member')
        "#,
        CHANNEL_ID,
        OWNER,
        MEMBER,
    )
    .execute(pool)
    .await?;

    let shared = Uuid::now_v7();
    let private = Uuid::now_v7();
    for (id, name, modified) in [
        (shared, "Shared session", "2026-01-02T00:00:00Z"),
        (private, "Private session", "2026-01-03T00:00:00Z"),
    ] {
        let modified: chrono::DateTime<chrono::Utc> = modified.parse()?;
        sqlx::query!(
            r#"
            INSERT INTO agent_session (
                id, owner_id, bot_id, model, harness, repo_url, workspace, name,
                status, status_event_name, created_at, modified_at
            )
            VALUES ($1, $2, $3, 'model', 'harness', NULL, '/workspace', $4,
                    'event', 'session/end', '2026-01-01 00:00:00+00', $5)
            "#,
            id,
            OWNER,
            BOT_ID,
            name,
            modified,
        )
        .execute(pool)
        .await?;
        sqlx::query!(
            r#"
            INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
            VALUES ($1, 'agent_session', $2, 'user', 'owner')
            "#,
            id,
            OWNER,
        )
        .execute(pool)
        .await?;
    }
    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, 'agent_session', $2, 'channel', 'edit')
        "#,
        shared,
        CHANNEL_ID.to_string(),
    )
    .execute(pool)
    .await?;
    Ok(Fixture { shared, private })
}

fn request(
    user: &'static str,
    filter: Option<Expr<AgentSessionLiteral>>,
) -> SimpleSortRequest<'static> {
    let cursor = match filter {
        Some(filter) => SimpleSortQuery::ItemsFilter(Query::Sort(
            SimpleSortMethod::UpdatedAt,
            EntityFilterAst {
                agent_session_filter: Some(Arc::new(filter)),
                ..EntityFilterAst::default()
            },
        )),
        None => SimpleSortQuery::NoFilter(Query::Sort(SimpleSortMethod::UpdatedAt, ())),
    };
    SimpleSortRequest {
        limit: 10,
        cursor,
        user_id: MacroUserIdStr::parse_from_str(user).expect("valid user id"),
    }
}

fn ids(items: &[SoupItem<()>]) -> Vec<Uuid> {
    items
        .iter()
        .map(|item| match item {
            SoupItem::AgentSession(session) => session.id,
            other => panic!("unexpected soup item {other:?}"),
        })
        .collect()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sessions_are_opt_in(pool: PgPool) -> anyhow::Result<()> {
    seed(&pool).await?;

    let no_filter = cursor_soup(&pool, request(OWNER, None)).await?;
    assert!(no_filter.is_empty(), "no AST must not surface sessions");

    let ast_without_sessions = SimpleSortRequest {
        limit: 10,
        cursor: SimpleSortQuery::ItemsFilter(Query::Sort(
            SimpleSortMethod::UpdatedAt,
            EntityFilterAst::default(),
        )),
        user_id: MacroUserIdStr::parse_from_str(OWNER)?,
    };
    assert!(
        cursor_soup(&pool, ast_without_sessions).await?.is_empty(),
        "an AST that never mentions sessions must not surface them"
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn include_lists_accessible_sessions_newest_first(pool: PgPool) -> anyhow::Result<()> {
    let fixture = seed(&pool).await?;

    let owner_items = cursor_soup(
        &pool,
        request(OWNER, Some(Expr::val(AgentSessionLiteral::Include))),
    )
    .await?;
    assert_eq!(ids(&owner_items), vec![fixture.private, fixture.shared]);
    let SoupItem::AgentSession(private) = &owner_items[0] else {
        unreachable!()
    };
    assert_eq!(private.name, "Private session");
    assert_eq!(private.status, "session/end");
    assert_eq!(private.owner_id.as_ref(), OWNER);
    assert_eq!(private.bot_id, BOT_ID);

    let member_items = cursor_soup(
        &pool,
        request(MEMBER, Some(Expr::val(AgentSessionLiteral::Include))),
    )
    .await?;
    assert_eq!(
        ids(&member_items),
        vec![fixture.shared],
        "channel members see only the session shared into their channel"
    );

    let stranger_items = cursor_soup(
        &pool,
        request(STRANGER, Some(Expr::val(AgentSessionLiteral::Include))),
    )
    .await?;
    assert!(stranger_items.is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn id_and_owner_literals_constrain_the_page(pool: PgPool) -> anyhow::Result<()> {
    let fixture = seed(&pool).await?;

    let by_id = cursor_soup(
        &pool,
        request(
            OWNER,
            Some(Expr::val(AgentSessionLiteral::Id(fixture.shared))),
        ),
    )
    .await?;
    assert_eq!(ids(&by_id), vec![fixture.shared]);

    let by_owner = cursor_soup(
        &pool,
        request(
            MEMBER,
            Some(Expr::val(AgentSessionLiteral::Owner(
                MacroUserIdStr::parse_from_str(OWNER)?.into_owned(),
            ))),
        ),
    )
    .await?;
    assert_eq!(ids(&by_owner), vec![fixture.shared]);

    let other_owner = cursor_soup(
        &pool,
        request(
            OWNER,
            Some(Expr::val(AgentSessionLiteral::Owner(
                MacroUserIdStr::parse_from_str(MEMBER)?.into_owned(),
            ))),
        ),
    )
    .await?;
    assert!(other_owner.is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn cursor_pages_past_the_first_row(pool: PgPool) -> anyhow::Result<()> {
    let fixture = seed(&pool).await?;

    let first = cursor_soup(
        &pool,
        SimpleSortRequest {
            limit: 1,
            cursor: SimpleSortQuery::ItemsFilter(Query::Sort(
                SimpleSortMethod::UpdatedAt,
                EntityFilterAst {
                    agent_session_filter: Some(Arc::new(Expr::val(AgentSessionLiteral::Include))),
                    ..EntityFilterAst::default()
                },
            )),
            user_id: MacroUserIdStr::parse_from_str(OWNER)?,
        },
    )
    .await?;
    assert_eq!(ids(&first), vec![fixture.private]);

    let SoupItem::AgentSession(private) = &first[0] else {
        unreachable!()
    };
    let second = cursor_soup(
        &pool,
        SimpleSortRequest {
            limit: 1,
            cursor: SimpleSortQuery::ItemsFilter(Query::Cursor(
                models_pagination::CursorWithValAndFilter {
                    id: private.id,
                    limit: 1,
                    val: models_pagination::CursorVal {
                        sort_type: SimpleSortMethod::UpdatedAt,
                        last_val: private.updated_at,
                    },
                    filter: EntityFilterAst {
                        agent_session_filter: Some(Arc::new(Expr::val(
                            AgentSessionLiteral::Include,
                        ))),
                        ..EntityFilterAst::default()
                    },
                },
            )),
            user_id: MacroUserIdStr::parse_from_str(OWNER)?,
        },
    )
    .await?;
    assert_eq!(ids(&second), vec![fixture.shared]);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn by_ids_respects_access(pool: PgPool) -> anyhow::Result<()> {
    let fixture = seed(&pool).await?;
    let entities = [
        EntityType::AgentSession.with_entity_string(fixture.shared.to_string()),
        EntityType::AgentSession.with_entity_string(fixture.private.to_string()),
        EntityType::Chat.with_entity_string(fixture.private.to_string()),
    ];

    let owner_items = by_ids(
        &pool,
        AdvancedSortParams {
            entities: &entities,
            user_id: MacroUserIdStr::parse_from_str(OWNER)?,
        },
    )
    .await?;
    assert_eq!(ids(&owner_items), vec![fixture.private, fixture.shared]);

    let member_items = by_ids(
        &pool,
        AdvancedSortParams {
            entities: &entities,
            user_id: MacroUserIdStr::parse_from_str(MEMBER)?,
        },
    )
    .await?;
    assert_eq!(ids(&member_items), vec![fixture.shared]);
    Ok(())
}
