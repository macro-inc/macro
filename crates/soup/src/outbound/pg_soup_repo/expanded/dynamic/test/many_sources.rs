use super::*;
use models_grouping::{GroupByField, GroupingConfig};
use models_pagination::{Identify, Query};

const VIEWER: &str = "macro|many-sources@example.com";

/// The viewer joins 1,200 private channels, each sharing one document; one
/// newer document is shared only with a channel the viewer is not in.
async fn seed_many_channels(pool: &PgPool) -> anyhow::Result<()> {
    sqlx::query!(
        r#"INSERT INTO comms_channels (id, channel_type, owner_id)
        SELECT md5('channel' || n)::uuid, 'private', 'macro|owner@example.com'
        FROM generate_series(0, 1200) n"#
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO comms_channel_participants (channel_id, user_id, role)
        SELECT md5('channel' || n)::uuid, $1, 'member'
        FROM generate_series(1, 1200) n"#,
        VIEWER,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner, "createdAt", "updatedAt")
        SELECT md5('document' || n)::uuid::text, 'shared', 'macro|owner@example.com',
            '2026-01-01', '2026-01-01'::timestamp + n * interval '1 minute'
        FROM generate_series(0, 1200) n"#
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO "DocumentInstance" ("documentId", sha)
        SELECT md5('document' || n)::uuid::text, 'sha'
        FROM generate_series(0, 1200) n"#
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"UPDATE "Document" SET name = 'hidden', "updatedAt" = '2026-02-01'
        WHERE id = md5('document0')::uuid::text"#
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        SELECT md5('document' || n)::uuid, 'document', md5('channel' || n)::uuid::text, 'channel', 'view'
        FROM generate_series(0, 1200) n"#
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_gate_follows_the_callers_grant_count(pool: PgPool) -> anyhow::Result<()> {
    seed_many_channels(&pool).await?;
    let mut connection = pool.acquire().await?;
    let every_kind = EntityFilterAst::mock_empty();

    // Few sources: the planned gate, without counting.
    let owner_sources = fetch_user_source_ids(&mut connection, "macro|owner@example.com").await?;
    assert_eq!(
        access_gate(&mut connection, &every_kind, &owner_sources).await?,
        AccessGate::Planned
    );

    // 1,201 sources holding 1,200 grants: one probe per source.
    let viewer_sources = fetch_user_source_ids(&mut connection, VIEWER).await?;
    assert_eq!(viewer_sources.len(), 1_201);
    assert_eq!(
        access_gate(&mut connection, &every_kind, &viewer_sources).await?,
        AccessGate::PerSource
    );

    // A list of named documents alone checks access per candidate and never
    // reads the gate, so it is not counted.
    let named_documents = EntityFilterAst {
        document_filter: Some(Arc::new(Expr::val(DocumentLiteral::Id(Uuid::nil())))),
        chat_filter: Some(Arc::new(Expr::val(ChatLiteral::Importance(false)))),
        project_filter: Some(Arc::new(Expr::val(ProjectLiteral::Importance(false)))),
        ..EntityFilterAst::mock_empty()
    };
    assert_eq!(
        access_gate(&mut connection, &named_documents, &viewer_sources).await?,
        AccessGate::Planned
    );

    // Past 50,000 grants, hashing them is cheaper again.
    sqlx::query!(
        r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        SELECT gen_random_uuid(), 'document', md5('channel1')::uuid::text, 'channel', 'view'
        FROM generate_series(1, 50000)"#
    )
    .execute(&mut *connection)
    .await?;
    assert_eq!(
        access_gate(&mut connection, &every_kind, &viewer_sources).await?,
        AccessGate::Planned
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn probing_each_source_lists_only_the_callers_items(pool: PgPool) -> anyhow::Result<()> {
    seed_many_channels(&pool).await?;

    let page = expanded_dynamic_cursor_soup(
        &pool,
        ExpandedDynamicCursorArgs {
            user_id: MacroUserIdStr::parse_from_str(VIEWER).unwrap(),
            limit: 3,
            cursor: DynamicSort::from_timestamp_query(Query::Sort(
                SimpleSortMethod::UpdatedAt,
                EntityFilterAst::mock_empty(),
            )),
            exclude_frecency: false,
        },
    )
    .await?;

    // The newest shared documents, without the newer one the viewer cannot see.
    let expected: Vec<Uuid> = sqlx::query_scalar!(
        r#"SELECT md5('document' || n)::uuid AS "id!"
        FROM generate_series(1200, 1198, -1) n"#
    )
    .fetch_all(&pool)
    .await?;
    assert_eq!(page.iter().map(Identify::id).collect::<Vec<_>>(), expected);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn probing_each_source_groups_only_the_callers_items(pool: PgPool) -> anyhow::Result<()> {
    seed_many_channels(&pool).await?;

    let items = expanded_dynamic_cursor_soup_grouped(
        &pool,
        GroupedDynamicCursorArgs {
            user_id: MacroUserIdStr::parse_from_str(VIEWER).unwrap(),
            limit: 10,
            cursor: DynamicSort::from_timestamp_query(Query::Sort(
                SimpleSortMethod::UpdatedAt,
                EntityFilterAst::mock_empty(),
            )),
            exclude_frecency: false,
            grouping: GroupingConfig {
                field: GroupByField::EntityType,
                group_key: None,
                per_group_limit: None,
            },
        },
    )
    .await?
    .collect::<Vec<_>>();

    // The group's ten newest shared documents, counted out of 1,200: never the
    // newer one the viewer cannot see.
    let newest: Vec<Uuid> = sqlx::query_scalar!(
        r#"SELECT md5('document' || n)::uuid AS "id!"
        FROM generate_series(1200, 1191, -1) n"#
    )
    .fetch_all(&pool)
    .await?;
    assert_eq!(
        items
            .iter()
            .map(|item| (item.key.as_str(), item.item.id(), item.total_group_count))
            .collect::<Vec<_>>(),
        newest
            .into_iter()
            .map(|id| ("document", id, 1_200))
            .collect::<Vec<_>>()
    );
    Ok(())
}
