use super::super::{
    DocumentIdArrays, ExpandedDynamicCursorArgs, build_query, fetch_flat_page,
    fetch_user_source_ids,
};
use super::{WindowedArm, WindowedArms, ctes};
use crate::domain::models::{DynamicSort, SoupProjectionHydration, SoupSortDirection};
use filter_ast::Expr;
use item_filters::ast::{EntityFilterAst, document::DocumentLiteral};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{CursorWithValAndFilter, Identify, Query, SimpleSortMethod, SortOn};
use models_soup::item::SoupItem;
use sqlx::{PgConnection, PgPool};
use std::sync::Arc;
use system_properties::SystemPropertyKey;
use uuid::Uuid;

const USER: &str = "macro|windowed@example.com";

/// Clears `MIN_GRANTS` for every type with grants on rows that do not exist,
/// then lays out, newest first: accessible documents, 250 newer-than-the-rest
/// documents the caller cannot read, and older accessible documents. Each
/// block mixes update-time ties, deleted rows, viewed rows (some viewed after
/// and some before their update), frecency rows, and unreadable rows.
const SEED: &str = r#"
SET session_replication_role = 'replica';

INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
SELECT md5('missing ' || t || n)::uuid, t, 'macro|windowed@example.com', 'user', 'view'
FROM unnest(ARRAY['document', 'chat', 'project']) t, generate_series(1, 10000) n;

CREATE TEMP TABLE seeded_document AS
SELECT md5('newer document' || n)::uuid::text AS id, n,
    '2025-02-01'::timestamp + (n / 2) * interval '1 hour' AS updated_at, n % 3 <> 0 AS readable
FROM generate_series(1, 40) n
UNION ALL
SELECT md5('unreadable document' || n)::uuid::text, n,
    '2025-01-15'::timestamp + n * interval '1 minute', false
FROM generate_series(1, 250) n
UNION ALL
SELECT md5('older document' || n)::uuid::text, n,
    '2025-01-01'::timestamp + (n / 2) * interval '1 hour', n % 3 <> 0
FROM generate_series(1, 40) n;

INSERT INTO "DocumentFamily" ("id", "rootDocumentId")
SELECT 1000 + row_number() OVER (ORDER BY id), id FROM seeded_document;
INSERT INTO "Document" ("id", "name", "owner", "documentFamilyId", "fileType", "createdAt", "updatedAt", "deletedAt")
SELECT d.id, 'seeded ' || d.n, 'macro|windowed@example.com', f.id, 'pdf', d.updated_at, d.updated_at,
    CASE WHEN d.n % 7 = 0 THEN d.updated_at END
FROM seeded_document d JOIN "DocumentFamily" f ON f."rootDocumentId" = d.id;
INSERT INTO "DocumentInstance" ("id", "documentId", "sha", "createdAt", "updatedAt")
SELECT 1000 + row_number() OVER (ORDER BY id), id, 'sha', updated_at, updated_at FROM seeded_document;

CREATE TEMP TABLE seeded_item AS
SELECT md5(t || n)::uuid::text AS id, t AS item_type, n,
    '2025-02-01'::timestamp + (n / 2) * interval '90 minutes' AS updated_at
FROM unnest(ARRAY['chat', 'project']) t, generate_series(1, 40) n;
INSERT INTO "Chat" ("id", "name", "userId", "createdAt", "updatedAt", "deletedAt")
SELECT id, 'seeded ' || n, 'macro|windowed@example.com', updated_at, updated_at,
    CASE WHEN n % 8 = 0 THEN updated_at END
FROM seeded_item WHERE item_type = 'chat';
INSERT INTO "Project" ("id", "name", "userId", "createdAt", "updatedAt", "deletedAt")
SELECT id, 'seeded ' || n, 'macro|windowed@example.com', updated_at, updated_at,
    CASE WHEN n % 8 = 0 THEN updated_at END
FROM seeded_item WHERE item_type = 'project';

CREATE TEMP TABLE seeded AS
SELECT id, 'document' AS item_type, n, updated_at, readable FROM seeded_document
UNION ALL
SELECT id, item_type, n, updated_at, n % 3 <> 0 FROM seeded_item;

INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
SELECT id::uuid, item_type, 'macro|windowed@example.com', 'user', 'view' FROM seeded WHERE readable;
INSERT INTO "UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
SELECT 'macro|windowed@example.com', id, item_type, updated_at,
    '2025-01-10'::timestamp + n * interval '17 hours'
FROM seeded WHERE n % 5 = 0;
INSERT INTO frecency_aggregates (entity_id, entity_type, user_id, first_event)
SELECT id, item_type, 'macro|windowed@example.com', now() FROM seeded WHERE n % 4 = 0;

SET session_replication_role = 'origin';
"#;

fn args(
    cursor: Query<Uuid, SimpleSortMethod, EntityFilterAst>,
    limit: u16,
    exclude_frecency: bool,
) -> ExpandedDynamicCursorArgs<'static> {
    ExpandedDynamicCursorArgs {
        user_id: MacroUserIdStr::parse_from_str(USER).unwrap(),
        limit,
        cursor: DynamicSort::from_timestamp_query(cursor),
        exclude_frecency,
    }
}

/// Whether the document shortcut alone answers the page after `last`.
async fn document_shortcut_exact(
    connection: &mut PgConnection,
    sort: SimpleSortMethod,
    exclude_frecency: bool,
    limit: u16,
    last: Option<&SoupItem<()>>,
    source_ids: &[String],
) -> anyhow::Result<bool> {
    let sql = format!(
        "WITH {} SELECT exact FROM document_exact",
        ctes(WindowedArm::Document, sort, exclude_frecency, 9)
            .trim_end()
            .trim_end_matches(',')
    );
    Ok(sqlx::query_scalar(&sql)
        .bind(USER)
        .bind(sort.to_string())
        .bind(i64::from(limit))
        .bind(last.map(|item| SoupItem::sort_on(sort)(item).last_val))
        .bind(last.map(|item| item.id().to_string()))
        .bind(String::new())
        .bind(Uuid::nil())
        .bind(Uuid::nil())
        .bind(source_ids)
        .fetch_one(connection)
        .await?)
}

/// Every page of the flat query, read with and without the shortcut, with
/// whether the document shortcut was exact for each page.
async fn all_pages(
    connection: &mut PgConnection,
    sort: SimpleSortMethod,
    exclude_frecency: bool,
    limit: u16,
) -> anyhow::Result<(Vec<Vec<Uuid>>, Vec<Vec<Uuid>>, Vec<bool>)> {
    let source_ids = fetch_user_source_ids(connection, USER).await?;
    let all = WindowedArms {
        document: true,
        chat: true,
        project: true,
    };
    let mut full_pages = Vec::new();
    let mut windowed_pages = Vec::new();
    let mut exact = Vec::new();
    let mut cursor = Query::Sort(sort, EntityFilterAst::mock_empty());
    let mut last: Option<SoupItem<()>> = None;
    loop {
        let full = fetch_flat_page(
            connection,
            &args(cursor.clone(), limit, exclude_frecency),
            &source_ids,
            WindowedArms::default(),
        )
        .await?;
        let windowed = fetch_flat_page(
            connection,
            &args(cursor.clone(), limit, exclude_frecency),
            &source_ids,
            all,
        )
        .await?;
        exact.push(
            document_shortcut_exact(
                connection,
                sort,
                exclude_frecency,
                limit,
                last.as_ref(),
                &source_ids,
            )
            .await?,
        );
        let ids = |page: &[SoupProjectionHydration]| {
            page.iter()
                .map(|hydration| hydration.item.id())
                .collect::<Vec<_>>()
        };
        full_pages.push(ids(&full));
        windowed_pages.push(ids(&windowed));
        let Some(item) = full.into_iter().last().map(|hydration| hydration.item) else {
            break;
        };
        cursor = Query::Cursor(CursorWithValAndFilter {
            id: item.id(),
            limit: limit.into(),
            val: SoupItem::sort_on(sort)(&item),
            filter: EntityFilterAst::mock_empty(),
        });
        last = Some(item);
    }
    Ok((full_pages, windowed_pages, exact))
}

#[sqlx::test(
    fixtures("../../../../../../../macro_db_client/fixtures/mixed_items_expanded.sql"),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn shortcut_pages_match_the_full_query(pool: PgPool) -> anyhow::Result<()> {
    sqlx::raw_sql(SEED).execute(&pool).await?;
    let mut connection = pool.acquire().await?;
    for sort in [SimpleSortMethod::UpdatedAt, SimpleSortMethod::ViewedUpdated] {
        for exclude_frecency in [false, true] {
            for limit in [2, 25] {
                let (full, windowed, exact) =
                    all_pages(&mut connection, sort, exclude_frecency, limit).await?;
                let label = format!("{sort} exclude_frecency={exclude_frecency} limit={limit}");
                assert_eq!(windowed, full, "{label}");
                assert!(full.iter().flatten().count() > 50, "{label}");
                assert!(exact.contains(&true), "{label}");
                // Two-item pages read 200-row windows, which the 250
                // unreadable documents fill without a readable row.
                assert_eq!(exact.contains(&false), limit == 2, "{label}");
            }
        }
    }
    Ok(())
}

#[test]
fn filtered_arms_and_property_sorts_keep_the_full_arm() {
    let all = WindowedArms {
        document: true,
        chat: true,
        project: true,
    };
    let filter = EntityFilterAst {
        document_filter: Some(Arc::new(Expr::val(DocumentLiteral::NameContains(
            "plan".into(),
        )))),
        ..EntityFilterAst::mock_empty()
    };
    let sql = build_query(
        &filter,
        false,
        SimpleSortMethod::ViewedUpdated.into(),
        all,
        &mut DocumentIdArrays::starting_at(10),
    )
    .sql()
    .to_owned();
    assert!(!sql.contains("document_window"));
    assert!(sql.contains("FROM chat_recent"));
    assert!(sql.contains("FROM project_viewed"));
    assert!(sql.contains(" AND NOT (SELECT exact FROM chat_exact)"));

    let property = DynamicSort::Property {
        property_definition_id: SystemPropertyKey::DUE_DATE_UUID,
        direction: SoupSortDirection::Asc,
    };
    let sql = build_query(
        &EntityFilterAst::mock_empty(),
        false,
        property,
        all,
        &mut DocumentIdArrays::starting_at(12),
    )
    .sql()
    .to_owned();
    assert!(!sql.contains("_window"));
}

#[test]
fn eligible_arms_need_an_updated_at_sort_and_no_filter() {
    let empty = EntityFilterAst::mock_empty();
    for (sort, expected) in [
        (SimpleSortMethod::UpdatedAt, true),
        (SimpleSortMethod::ViewedUpdated, true),
        (SimpleSortMethod::ViewedAt, false),
        (SimpleSortMethod::CreatedAt, false),
    ] {
        let arms = WindowedArms::eligible(&empty, sort.into());
        assert_eq!(
            (arms.document, arms.chat, arms.project),
            (expected, expected, expected),
            "{sort}"
        );
    }
}
