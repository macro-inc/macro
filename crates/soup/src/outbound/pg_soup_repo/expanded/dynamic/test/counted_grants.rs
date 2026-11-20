//! The document arm checks access against the caller's counted grants
//! (`DocumentGrants::Counted`) unless it names its documents or requires a
//! folder or a notification; these compare it with the estimated gate.

use super::*;
use crate::domain::models::SoupSortDirection;
use item_filters::{
    NotificationState,
    ast::{
        calendar_event::CalendarEventLiteral, chat::ChatLiteral, document::DocumentLiteral,
        project::ProjectLiteral,
    },
};
use models_pagination::SimpleSortMethod;
use sqlx::Row;

const MANY_CHANNELS: &str = "macro|counted-many@example.test";
const TEAM_ONLY: &str = "macro|counted-team@example.test";
const OWNER_ONLY: &str = "macro|counted-owner@example.test";
const TEAM: &str = "c0a7ed00-0000-0000-0000-000000000001";

/// Every document, chat and project, no calendar events.
fn everything() -> EntityFilterAst {
    EntityFilterAst {
        calendar_event_filter: Some(Arc::new(Expr::val(CalendarEventLiteral::Id(Uuid::nil())))),
        ..EntityFilterAst::mock_empty()
    }
}

fn documents_where(literal: Expr<DocumentLiteral>) -> EntityFilterAst {
    EntityFilterAst {
        document_filter: Some(Arc::new(literal)),
        chat_filter: Some(Arc::new(Expr::val(ChatLiteral::Importance(false)))),
        project_filter: Some(Arc::new(Expr::val(ProjectLiteral::Importance(false)))),
        ..everything()
    }
}

#[test]
fn broad_document_arms_gate_on_the_counted_grants() {
    let folder = Expr::val(DocumentLiteral::ProjectId(Uuid::from_u128(1)));
    let unread = Expr::val(DocumentLiteral::NotificationState(
        NotificationState::Unseen,
    ));
    let tasks = Expr::val(DocumentLiteral::SubType(DocumentSubType::Task));
    let pdf = Expr::val(DocumentLiteral::FileType("pdf".parse().unwrap()));

    assert!(document_arm_gates_on_count(&everything()));
    assert!(document_arm_gates_on_count(&documents_where(tasks.clone())));
    assert!(!document_arm_gates_on_count(&documents_where(
        folder.clone()
    )));
    assert!(!document_arm_gates_on_count(&documents_where(Expr::and(
        tasks.clone(),
        unread.clone()
    ))));
    // A folder OR'ed with anything else, or negated, does not bound the arm.
    assert!(document_arm_gates_on_count(&documents_where(Expr::or(
        folder.clone(),
        pdf
    ))));
    assert!(document_arm_gates_on_count(&documents_where(Expr::is_not(
        folder
    ))));
    // Named documents check access after their filters, and an impossible
    // arm reads nothing.
    assert!(!document_arm_gates_on_count(&documents_where(Expr::val(
        DocumentLiteral::Id(Uuid::from_u128(2))
    ))));
    assert!(!document_arm_gates_on_count(&documents_where(Expr::val(
        DocumentLiteral::Id(Uuid::nil())
    ))));

    let sort = DynamicSort::from(SimpleSortMethod::ViewedUpdated);
    let source_ids = source_ids_slot(sort, false);
    let flat = |grants| {
        let mut arrays = DocumentIdArrays::starting_at(first_document_id_slot(sort, false));
        build_query(&everything(), false, sort, grants, &mut arrays)
            .sql()
            .to_owned()
    };
    let counted = flat(DocumentGrants::Counted(42));
    assert!(counted.contains(&counted_document_access_semi_join(source_ids, 42)));
    assert!(counted.contains("LIMIT 42\n"));
    assert!(!counted.contains(&bound_access_semi_join("d.id", "document", source_ids)));
    for (id, entity_type) in [("c.id", "chat"), ("p.id", "project")] {
        assert!(counted.contains(&bound_access_semi_join(id, entity_type, source_ids)));
    }
    assert!(!flat(DocumentGrants::Estimated).contains("SELECT DISTINCT held.entity_id::text"));

    let grouping = GroupingConfig {
        field: GroupByField::EntityType,
        group_key: None,
        per_group_limit: None,
    };
    let mut arrays = DocumentIdArrays::starting_at(first_document_id_slot(sort, true));
    let filter = everything();
    let (grouped, _) = build_grouped_query(
        &filter,
        false,
        &grouping,
        sort,
        DocumentGrants::Counted(7),
        &mut arrays,
    );
    assert!(grouped.sql().contains(&counted_document_access_semi_join(
        source_ids_slot(sort, true),
        7
    )));
}

/// Three callers: one in forty channels (and a team, and a channel it left),
/// one reaching documents only through a team, and one only through its own
/// grants. Documents are shared to several sources at once, some are deleted,
/// some grants name documents that no longer exist, and the callers viewed
/// some of their items.
async fn seed_callers(pool: &PgPool) -> sqlx::Result<()> {
    sqlx::raw_sql(&format!(
        r#"
        BEGIN;
        SET LOCAL session_replication_role = 'replica';
        INSERT INTO "Document" (id, name, owner, "fileType", "createdAt", "updatedAt", "deletedAt")
        SELECT md5('cg-doc' || n)::uuid::text,
               CASE WHEN n % 4 = 0 THEN 'Plan ' ELSE 'notes ' END || md5('cg-name' || n),
               CASE WHEN n % 10 = 1 THEN '{MANY_CHANNELS}'
                    WHEN n % 10 = 2 THEN '{OWNER_ONLY}'
                    ELSE 'macro|counted-other@example.test' END,
               'md',
               timestamp '2026-01-01' + (hashtext('cg-created' || n) & 1048575) * interval '1 minute',
               timestamp '2026-06-01' + (hashtext('cg-updated' || n) & 1048575) * interval '1 minute',
               CASE WHEN n % 13 = 0 THEN timestamp '2026-11-01' END
        FROM generate_series(1, 400) n;
        INSERT INTO document_sub_type (document_id, sub_type)
        SELECT md5('cg-doc' || n)::uuid::text, 'task' FROM generate_series(1, 400) n WHERE n % 7 = 0;
        INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
        SELECT md5('cg-status' || n)::uuid, md5('cg-doc' || n)::uuid::text, 'TASK',
               '00000001-0000-0000-0000-000000000002',
               jsonb_build_object('type', 'SelectOption', 'value', jsonb_build_array(
                   CASE WHEN n % 2 = 0 THEN '00000001-0000-0000-0002-000000000001'
                        ELSE '00000001-0000-0000-0002-000000000002' END))
        FROM generate_series(1, 400) n WHERE n % 7 = 0 AND n % 3 <> 0;
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        SELECT d.id::uuid, 'document', d.owner, 'user', 'owner' FROM "Document" d;
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        SELECT md5('cg-doc' || n)::uuid, 'document', md5('cg-channel' || (n % 50))::uuid::text, 'channel', 'view'
        FROM generate_series(1, 400) n WHERE n % 3 = 0;
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        SELECT md5('cg-doc' || n)::uuid, 'document', md5('cg-channel' || (n % 50 + 1))::uuid::text, 'channel', 'edit'
        FROM generate_series(1, 400) n WHERE n % 30 = 0;
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        SELECT md5('cg-doc' || n)::uuid, 'document', '{TEAM}', 'team', 'view'
        FROM generate_series(1, 400) n WHERE n % 11 = 0;
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        SELECT md5('cg-gone' || n)::uuid, 'document', md5('cg-channel' || (n % 50))::uuid::text, 'channel', 'view'
        FROM generate_series(1, 60) n;
        INSERT INTO "Chat" (id, "userId", name, "createdAt", "updatedAt", "deletedAt")
        SELECT md5('cg-chat' || n)::uuid::text, 'macro|counted-other@example.test', 'Chat ' || n,
               timestamp '2026-02-01' + n * interval '7 hours', timestamp '2026-07-01' + n * interval '5 hours',
               CASE WHEN n % 9 = 0 THEN timestamp '2026-11-01' END
        FROM generate_series(1, 40) n;
        INSERT INTO "Project" (id, "userId", name, "createdAt", "updatedAt")
        SELECT md5('cg-project' || n)::uuid::text, 'macro|counted-other@example.test', 'Project ' || n,
               timestamp '2026-03-01' + n * interval '11 hours', timestamp '2026-08-01' + n * interval '3 hours'
        FROM generate_series(1, 20) n;
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        SELECT md5('cg-chat' || n)::uuid, 'chat', md5('cg-channel' || (n % 50))::uuid::text, 'channel', 'view'
        FROM generate_series(1, 40) n;
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        SELECT md5('cg-project' || n)::uuid, 'project', '{TEAM}', 'team', 'view'
        FROM generate_series(1, 20) n WHERE n % 2 = 0;
        INSERT INTO comms_channel_participants (channel_id, role, user_id)
        SELECT md5('cg-channel' || k)::uuid, 'member', '{MANY_CHANNELS}' FROM generate_series(0, 39) k;
        INSERT INTO comms_channel_participants (channel_id, role, user_id, left_at)
        VALUES (md5('cg-channel' || 45)::uuid, 'member', '{MANY_CHANNELS}', timestamp '2026-10-01');
        INSERT INTO team_user (user_id, team_id, team_role) VALUES
            ('{MANY_CHANNELS}', '{TEAM}', 'member'),
            ('{TEAM_ONLY}', '{TEAM}', 'member');
        INSERT INTO "UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
        SELECT u.id, md5('cg-doc' || n)::uuid::text, 'document', timestamp '2026-09-01',
               timestamp '2026-09-01' + (hashtext('cg-viewed' || u.id || n) & 65535) * interval '1 minute'
        FROM (VALUES ('{MANY_CHANNELS}'), ('{TEAM_ONLY}'), ('{OWNER_ONLY}')) u(id), generate_series(1, 400) n
        WHERE n % 5 = 0;
        INSERT INTO "UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
        SELECT '{MANY_CHANNELS}', md5('cg-chat' || n)::uuid::text, 'chat', timestamp '2026-09-01', timestamp '2026-10-01' + n * interval '1 hour'
        FROM generate_series(1, 40) n WHERE n % 4 = 0;
        COMMIT;
        ANALYZE;
        "#
    ))
    .execute(pool)
    .await?;
    Ok(())
}

/// The document gate a page uses, made from the caller's counted grants.
type Gate = fn(DocumentGrants) -> DocumentGrants;

/// Where a page continues from: the last row of the page before.
#[derive(Clone, Debug, Default, PartialEq)]
struct After {
    sort_ts: Option<DateTime<Utc>>,
    id: Option<String>,
    sort_key: Option<f64>,
    name: Option<String>,
}

/// A flat page, or a page grouped by entity type: every group's first rows,
/// or one group's rows continued.
#[derive(Clone, Copy)]
enum Shape {
    Flat,
    Grouped(Option<&'static str>),
}

/// The (item type, id) rows of one page, bound as
/// `expanded_dynamic_cursor_soup_hydrated` and
/// `expanded_dynamic_cursor_soup_grouped` bind them, with the document gate
/// `grants` makes of the caller's counted grants.
#[expect(clippy::too_many_arguments, reason = "mirrors the production binds")]
async fn page(
    pool: &PgPool,
    viewer: &str,
    filter: &EntityFilterAst,
    sort: DynamicSort,
    shape: Shape,
    grants: Gate,
    after: &After,
    limit: i64,
) -> anyhow::Result<Vec<(String, String, After)>> {
    let grouped = matches!(shape, Shape::Grouped(_));
    let mut transaction = begin_dynamic_query(pool, filter).await?;
    let source_ids = fetch_user_source_ids(&mut transaction, viewer).await?;
    let counted = DocumentGrants::count(&mut transaction, filter, &source_ids).await?;
    let mut document_ids = DocumentIdArrays::starting_at(first_document_id_slot(sort, grouped));
    let grouping = GroupingConfig {
        field: GroupByField::EntityType,
        group_key: match shape {
            Shape::Grouped(key) => key.map(str::to_owned),
            Shape::Flat => None,
        },
        per_group_limit: None,
    };
    let (sql, entity_type) = if grouped {
        let (builder, entity_type) = build_grouped_query(
            filter,
            false,
            &grouping,
            sort,
            grants(counted),
            &mut document_ids,
        );
        (builder.sql().to_owned(), entity_type)
    } else {
        let builder = build_query(filter, false, sort, grants(counted), &mut document_ids);
        (builder.sql().to_owned(), None)
    };
    #[expect(clippy::disallowed_methods, reason = "runs SQL generated from the AST")]
    let mut query = sqlx::query(&sql)
        .bind(viewer)
        .bind(sort.timestamp_method().to_string())
        .bind(limit)
        .bind(after.sort_ts)
        .bind(after.id.clone())
        .bind(StatusOption::COMPLETED_UUID.to_string())
        .bind(SystemPropertyKey::STATUS_UUID)
        .bind(SystemPropertyKey::ASSIGNEES_UUID);
    if grouped {
        query = query.bind(grouping.group_key.clone()).bind(entity_type);
    }
    match sort {
        DynamicSort::Property {
            property_definition_id,
            ..
        } => query = query.bind(property_definition_id).bind(after.sort_key),
        DynamicSort::Name { .. } => query = query.bind(after.name.clone()),
        DynamicSort::Timestamp(_) => {}
    }
    query = query.bind(&source_ids);
    for ids in document_ids.into_binds() {
        query = query.bind(ids);
    }
    let rows = query.persistent(false).fetch_all(&mut *transaction).await?;
    transaction.commit().await?;
    rows.iter()
        .map(|row| {
            let id: String = row.try_get("id")?;
            Ok((
                row.try_get("item_type")?,
                id.clone(),
                After {
                    sort_ts: row.try_get("sort_ts")?,
                    id: Some(id),
                    sort_key: row.try_get("sort_key")?,
                    name: row.try_get("name")?,
                },
            ))
        })
        .collect()
}

/// Every flat page of `filter`, `limit` rows at a time, each continued from
/// the last row of the page before.
async fn pages(
    pool: &PgPool,
    viewer: &str,
    filter: &EntityFilterAst,
    sort: DynamicSort,
    grants: Gate,
) -> anyhow::Result<Vec<Vec<(String, String)>>> {
    let mut after = After::default();
    let mut seen = Vec::new();
    loop {
        let rows = page(pool, viewer, filter, sort, Shape::Flat, grants, &after, 7).await?;
        let Some((_, _, last)) = rows.last() else {
            return Ok(seen);
        };
        after = last.clone();
        seen.push(rows.into_iter().map(|(kind, id, _)| (kind, id)).collect());
    }
}

fn counted(grants: DocumentGrants) -> DocumentGrants {
    assert!(
        matches!(grants, DocumentGrants::Counted(_)),
        "the caller's grants are counted"
    );
    grants
}

fn estimated(_: DocumentGrants) -> DocumentGrants {
    DocumentGrants::Estimated
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn counted_grants_list_the_same_pages_as_estimated_ones(pool: PgPool) -> anyhow::Result<()> {
    seed_callers(&pool).await?;
    let sorts = [
        DynamicSort::from(SimpleSortMethod::CreatedAt),
        DynamicSort::from(SimpleSortMethod::UpdatedAt),
        DynamicSort::from(SimpleSortMethod::ViewedAt),
        DynamicSort::from(SimpleSortMethod::ViewedUpdated),
        DynamicSort::name(SoupSortDirection::Asc),
        DynamicSort::name(SoupSortDirection::Desc),
        DynamicSort::Property {
            property_definition_id: SystemPropertyKey::STATUS_UUID,
            direction: SoupSortDirection::Asc,
        },
    ];
    let filters = [
        everything(),
        documents_where(Expr::val(DocumentLiteral::SubType(DocumentSubType::Task))),
    ];
    for viewer in [MANY_CHANNELS, TEAM_ONLY, OWNER_ONLY] {
        for filter in &filters {
            for sort in sorts {
                let new = pages(&pool, viewer, filter, sort, counted).await?;
                assert!(!new.is_empty(), "{viewer} {sort:?} lists something");
                assert_eq!(
                    new,
                    pages(&pool, viewer, filter, sort, estimated).await?,
                    "{viewer} {sort:?}"
                );
            }
        }
        for sort in [
            DynamicSort::from(SimpleSortMethod::ViewedUpdated),
            DynamicSort::name(SoupSortDirection::Asc),
        ] {
            let start = After::default();
            let first = |grants| {
                page(
                    &pool,
                    viewer,
                    &filters[0],
                    sort,
                    Shape::Grouped(None),
                    grants,
                    &start,
                    5,
                )
            };
            let new = first(counted).await?;
            assert_eq!(new, first(estimated).await?, "{viewer} grouped {sort:?}");
            let last_document = new
                .iter()
                .rev()
                .find(|(kind, _, _)| kind == "document")
                .map(|(_, _, after)| after.clone())
                .unwrap_or_default();
            let next = |grants| {
                page(
                    &pool,
                    viewer,
                    &filters[0],
                    sort,
                    Shape::Grouped(Some("document")),
                    grants,
                    &last_document,
                    5,
                )
            };
            assert_eq!(
                next(counted).await?,
                next(estimated).await?,
                "{viewer} grouped documents continued, {sort:?}"
            );
        }
    }
    Ok(())
}

/// `EXPLAIN` of the first viewed-or-updated page of every item for `viewer`,
/// at production's `random_page_cost`.
async fn plan(pool: &PgPool, viewer: &str, grants: Gate) -> anyhow::Result<String> {
    let sort = DynamicSort::from(SimpleSortMethod::ViewedUpdated);
    let filter = everything();
    let mut transaction = begin_dynamic_query(pool, &filter).await?;
    sqlx::query!("SET LOCAL random_page_cost = 1.1")
        .execute(&mut *transaction)
        .await?;
    let source_ids = fetch_user_source_ids(&mut transaction, viewer).await?;
    let counted = DocumentGrants::count(&mut transaction, &filter, &source_ids).await?;
    let mut document_ids = DocumentIdArrays::starting_at(first_document_id_slot(sort, false));
    let builder = build_query(&filter, false, sort, grants(counted), &mut document_ids);
    #[expect(
        clippy::disallowed_methods,
        reason = "explains SQL generated from the AST"
    )]
    let plan: Vec<String> = sqlx::query_scalar(&format!("EXPLAIN (COSTS OFF) {}", builder.sql()))
        .bind(viewer)
        .bind(sort.timestamp_method().to_string())
        .bind(50_i64)
        .bind(None::<DateTime<Utc>>)
        .bind(None::<String>)
        .bind(StatusOption::COMPLETED_UUID.to_string())
        .bind(SystemPropertyKey::STATUS_UUID)
        .bind(SystemPropertyKey::ASSIGNEES_UUID)
        .bind(&source_ids)
        .persistent(false)
        .fetch_all(&mut *transaction)
        .await?;
    Ok(plan.join("\n"))
}

/// A caller in 300 channels, each holding one of 120,000 documents. Postgres
/// estimates every channel at the table's average grant count, pinned here
/// to a few hundred as production's statistics put it.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_caller_in_many_small_channels_looks_documents_up_by_grant(
    pool: PgPool,
) -> anyhow::Result<()> {
    sqlx::raw_sql(&format!(
        r#"
        BEGIN;
        SET LOCAL session_replication_role = 'replica';
        INSERT INTO "Document" (id, name, owner)
        SELECT md5('scan-doc' || n)::uuid::text, 'Document ' || n, 'macro|scan-owner' || (n % 900) || '@example.test'
        FROM generate_series(1, 120000) n;
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        SELECT d.id::uuid, 'document', d.owner, 'user', 'owner' FROM "Document" d;
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        SELECT md5('scan-doc' || (k * 397))::uuid, 'document', md5('scan-channel' || k)::uuid::text, 'channel', 'view'
        FROM generate_series(1, 300) k;
        INSERT INTO comms_channel_participants (channel_id, role, user_id)
        SELECT md5('scan-channel' || k)::uuid, 'member', '{MANY_CHANNELS}' FROM generate_series(1, 300) k;
        COMMIT;
        ALTER TABLE entity_access ALTER COLUMN source_id SET (n_distinct = 300);
        ANALYZE;
        "#
    ))
    .execute(&pool)
    .await?;

    let estimated = plan(&pool, MANY_CHANNELS, estimated).await?;
    assert!(
        estimated.contains(r#"Seq Scan on "Document""#),
        "estimated at the average, the caller's grants look like most of the table:\n{estimated}"
    );

    let counted = plan(&pool, MANY_CHANNELS, counted).await?;
    let document_reads: Vec<&str> = counted
        .lines()
        .map(|line| line.trim_start().trim_start_matches("->").trim_start())
        .filter(|line| line.contains(r#"on "Document""#))
        .collect();
    assert!(
        !document_reads.is_empty() && document_reads.iter().all(|read| read.starts_with("Index")),
        "every read of Document goes through an index:\n{counted}"
    );
    assert!(
        counted.contains("Index Cond: (id = ((held.entity_id)::text))"),
        "Document is read one granted id at a time:\n{counted}"
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_caller_over_the_counted_limit_keeps_the_estimated_gate(
    pool: PgPool,
) -> anyhow::Result<()> {
    let documents = i64::from(COUNTED_DOCUMENT_GRANTS) + 25;
    sqlx::raw_sql(&format!(
        r#"
        BEGIN;
        SET LOCAL session_replication_role = 'replica';
        INSERT INTO team_user (user_id, team_id, team_role) VALUES ('{TEAM_ONLY}', '{TEAM}', 'member');
        INSERT INTO "Document" (id, name, owner, "updatedAt")
        SELECT md5('over-doc' || n)::uuid::text, 'Document ' || n, 'macro|over-owner@example.test',
               timestamp '2026-01-01' + n * interval '1 minute'
        FROM generate_series(1, {documents}) n;
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        SELECT md5('over-doc' || n)::uuid, 'document', '{TEAM}', 'team', 'view'
        FROM generate_series(1, {documents}) n;
        COMMIT;
        ANALYZE;
        "#
    ))
    .execute(&pool)
    .await?;

    let mut transaction = begin_dynamic_query(&pool, &everything()).await?;
    let source_ids = fetch_user_source_ids(&mut transaction, TEAM_ONLY).await?;
    assert_eq!(
        DocumentGrants::count(&mut transaction, &everything(), &source_ids).await?,
        DocumentGrants::Estimated
    );
    transaction.commit().await?;

    let sort = DynamicSort::from(SimpleSortMethod::UpdatedAt);
    let first = page(
        &pool,
        TEAM_ONLY,
        &everything(),
        sort,
        Shape::Flat,
        |grants| grants,
        &After::default(),
        3,
    )
    .await?;
    assert_eq!(
        first
            .iter()
            .map(|(_, id, _)| id.clone())
            .collect::<Vec<_>>(),
        sqlx::query_scalar!(
            r#"SELECT id FROM "Document" ORDER BY "updatedAt" DESC, id DESC LIMIT 3"#
        )
        .fetch_all(&pool)
        .await?
    );
    Ok(())
}
