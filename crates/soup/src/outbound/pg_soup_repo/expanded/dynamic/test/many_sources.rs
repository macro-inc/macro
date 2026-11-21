//! Counted callers with more than `MANY_SOURCES` sources probe each source for
//! their chat and project grants (`DocumentGrants::CountedManySources`).

use super::*;
use item_filters::ast::calendar_event::CalendarEventLiteral;
use models_grouping::{GroupByField, GroupingConfig};
use models_pagination::{Identify, Query, SimpleSortMethod};

const VIEWER: &str = "macro|many-sources@example.com";
const OWNER: &str = "macro|owner@example.com";

/// The viewer joins 1,200 private channels, each sharing one document; one
/// newer document is shared only with a channel the viewer is not in. Channel
/// 7 also shares a chat and a project; newer ones are shared only with the
/// channel the viewer is not in.
async fn seed_many_channels(pool: &PgPool) -> anyhow::Result<()> {
    sqlx::query!(
        r#"INSERT INTO comms_channels (id, channel_type, owner_id)
        SELECT md5('channel' || n)::uuid, 'private', $1
        FROM generate_series(0, 1200) n"#,
        OWNER,
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
        SELECT md5('document' || n)::uuid::text, 'shared', $1,
            '2026-01-01', '2026-01-01'::timestamp + n * interval '1 minute'
        FROM generate_series(0, 1200) n"#,
        OWNER,
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
    sqlx::query!(
        r#"INSERT INTO "Chat" (id, "userId", name, "createdAt", "updatedAt") VALUES
            (md5('chat-shared')::uuid::text, $1, 'shared', '2026-03-01', '2026-03-01'),
            (md5('chat-hidden')::uuid::text, $1, 'hidden', '2026-04-01', '2026-04-01')"#,
        OWNER,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO "Project" (id, "userId", name, "createdAt", "updatedAt") VALUES
            (md5('project-shared')::uuid::text, $1, 'shared', '2026-03-02', '2026-03-02'),
            (md5('project-hidden')::uuid::text, $1, 'hidden', '2026-04-02', '2026-04-02')"#,
        OWNER,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES
            (md5('chat-shared')::uuid, 'chat', md5('channel7')::uuid::text, 'channel', 'view'),
            (md5('chat-hidden')::uuid, 'chat', md5('channel0')::uuid::text, 'channel', 'view'),
            (md5('project-shared')::uuid, 'project', md5('channel7')::uuid::text, 'channel', 'view'),
            (md5('project-hidden')::uuid, 'project', md5('channel0')::uuid::text, 'channel', 'view')"#
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Every document, chat and project, no calendar events.
fn everything() -> EntityFilterAst {
    EntityFilterAst {
        calendar_event_filter: Some(Arc::new(Expr::val(CalendarEventLiteral::Id(Uuid::nil())))),
        ..EntityFilterAst::mock_empty()
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn callers_with_many_sources_are_counted_as_such(pool: PgPool) -> anyhow::Result<()> {
    seed_many_channels(&pool).await?;
    let mut connection = pool.acquire().await?;

    let owner_sources = fetch_user_source_ids(&mut connection, OWNER).await?;
    assert_eq!(
        DocumentGrants::count(&mut connection, &everything(), &owner_sources).await?,
        DocumentGrants::Counted(0)
    );

    let viewer_sources = fetch_user_source_ids(&mut connection, VIEWER).await?;
    assert_eq!(viewer_sources.len(), 1_201);
    assert_eq!(
        DocumentGrants::count(&mut connection, &everything(), &viewer_sources).await?,
        DocumentGrants::CountedManySources(1_200)
    );

    // Past the counted limit the planner chooses for every arm.
    sqlx::query!(
        r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        SELECT gen_random_uuid(), 'document', md5('channel1')::uuid::text, 'channel', 'view'
        FROM generate_series(1, 50000)"#
    )
    .execute(&mut *connection)
    .await?;
    assert_eq!(
        DocumentGrants::count(&mut connection, &everything(), &viewer_sources).await?,
        DocumentGrants::Estimated
    );
    Ok(())
}

#[test]
fn only_callers_with_many_sources_probe_each_source_for_chats_and_projects() {
    let sort = DynamicSort::from(SimpleSortMethod::UpdatedAt);
    let source_ids = source_ids_slot(sort, false);
    let flat = |grants| {
        let mut arrays = DocumentIdArrays::starting_at(first_document_id_slot(sort, false));
        build_query(&everything(), false, sort, grants, &mut arrays)
            .sql()
            .to_owned()
    };
    let grouped = |grants| {
        let grouping = GroupingConfig {
            field: GroupByField::EntityType,
            group_key: None,
            per_group_limit: None,
        };
        let mut arrays = DocumentIdArrays::starting_at(first_document_id_slot(sort, true));
        let filter = everything();
        let (query, _) = build_grouped_query(&filter, false, &grouping, sort, grants, &mut arrays);
        query.sql().to_owned()
    };

    for (sql, slot) in [
        (flat(DocumentGrants::CountedManySources(42)), source_ids),
        (
            grouped(DocumentGrants::CountedManySources(42)),
            source_ids_slot(sort, true),
        ),
    ] {
        assert!(sql.contains(&counted_document_access_semi_join(slot, 42)));
        for (id, entity_type) in [("c.id", "chat"), ("p.id", "project")] {
            assert!(sql.contains(&per_source_access_semi_join(id, entity_type, slot)));
            assert!(!sql.contains(&bound_access_semi_join(id, entity_type, slot)));
        }
    }
    for grants in [DocumentGrants::Counted(42), DocumentGrants::Estimated] {
        let sql = flat(grants);
        for (id, entity_type) in [("c.id", "chat"), ("p.id", "project")] {
            assert!(sql.contains(&bound_access_semi_join(id, entity_type, source_ids)));
        }
        assert!(!sql.contains("CROSS JOIN LATERAL"));
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn probing_each_source_lists_only_the_callers_items(pool: PgPool) -> anyhow::Result<()> {
    seed_many_channels(&pool).await?;

    let page = expanded_dynamic_cursor_soup(
        &pool,
        ExpandedDynamicCursorArgs {
            user_id: MacroUserIdStr::parse_from_str(VIEWER).unwrap(),
            limit: 4,
            cursor: DynamicSort::from_timestamp_query(Query::Sort(
                SimpleSortMethod::UpdatedAt,
                everything(),
            )),
            exclude_frecency: false,
        },
    )
    .await?;

    // The shared project and chat, then the newest shared documents; never
    // the newer items the viewer cannot see.
    let expected: Vec<Uuid> = sqlx::query_scalar!(
        r#"SELECT id AS "id!" FROM (
            SELECT 1 AS k, md5('project-shared')::uuid AS id
            UNION ALL SELECT 2, md5('chat-shared')::uuid
            UNION ALL SELECT 2 + (1201 - n), md5('document' || n)::uuid
                FROM generate_series(1200, 1199, -1) n
        ) expected ORDER BY k"#
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
                everything(),
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

    let group = |key: &str| {
        items
            .iter()
            .filter(|item| item.key == key)
            .map(|item| (item.item.id(), item.total_group_count))
            .collect::<Vec<_>>()
    };
    let shared: Vec<Uuid> = sqlx::query_scalar!(
        r#"SELECT md5(name)::uuid AS "id!"
        FROM unnest(ARRAY['chat-shared', 'project-shared']) name"#
    )
    .fetch_all(&pool)
    .await?;
    assert_eq!(group("chat"), vec![(shared[0], 1)]);
    assert_eq!(group("project"), vec![(shared[1], 1)]);
    // The group's ten newest shared documents, counted out of 1,200: never the
    // newer one the viewer cannot see.
    let newest: Vec<Uuid> = sqlx::query_scalar!(
        r#"SELECT md5('document' || n)::uuid AS "id!"
        FROM generate_series(1200, 1191, -1) n"#
    )
    .fetch_all(&pool)
    .await?;
    assert_eq!(
        group("document"),
        newest.into_iter().map(|id| (id, 1_200)).collect::<Vec<_>>()
    );
    Ok(())
}
