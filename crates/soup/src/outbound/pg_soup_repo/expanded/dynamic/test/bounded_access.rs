//! A document arm bounded by named ids checks access after its own filters,
//! once per surviving candidate; these run it against the database.

use super::*;
use crate::domain::models::{DynamicSort, grouping::ItemGroupingInfo};
use cowlike::CowLike;
use item_filters::ast::{
    calendar_event::CalendarEventLiteral,
    chat::ChatLiteral,
    document::DocumentLiteral,
    project::ProjectLiteral,
    properties::{PropertiesLiteral, PropertyEntityType, PropertyMatchValue},
};
use models_pagination::{
    CursorVal, CursorWithValAndFilter, Identify, Query, SimpleSortMethod, SortOn,
};
use serde_json::json;

const A: Uuid = uuid::uuid!("11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
const B: Uuid = uuid::uuid!("11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
const C: Uuid = uuid::uuid!("11111111-cccc-cccc-cccc-cccccccccccc");
const D: Uuid = uuid::uuid!("11111111-dddd-dddd-dddd-dddddddddddd");
const STANDALONE: Uuid = uuid::uuid!("11111111-0000-0000-0000-000000000000");
/// The fixture grants nothing on this document.
const ISOLATED: Uuid = uuid::uuid!("11111111-9999-9999-9999-999999999999");
const STATUS: Uuid = uuid::uuid!("00000001-0000-0000-0000-000000000002");
const NOT_STARTED: Uuid = uuid::uuid!("00000001-0000-0000-0002-000000000001");
const IN_PROGRESS: Uuid = uuid::uuid!("00000001-0000-0000-0002-000000000002");

/// Newest first by `updatedAt`. A and C are reachable only through project
/// grants, B and D through both kinds, the standalone document directly.
const VISIBLE: [Uuid; 5] = [STANDALONE, D, C, B, A];

fn documents(ids: &[Uuid]) -> EntityFilterAst {
    EntityFilterAst {
        document_filter: ids
            .iter()
            .map(|id| Expr::val(DocumentLiteral::Id(*id)))
            .reduce(Expr::or)
            .map(Arc::new),
        chat_filter: Some(Arc::new(Expr::val(ChatLiteral::Importance(false)))),
        project_filter: Some(Arc::new(Expr::val(ProjectLiteral::Importance(false)))),
        calendar_event_filter: Some(Arc::new(Expr::val(CalendarEventLiteral::Id(Uuid::nil())))),
        ..EntityFilterAst::mock_empty()
    }
}

fn every_document() -> EntityFilterAst {
    documents(&[ISOLATED, A, B, C, D, STANDALONE])
}

const SORT: DynamicSort = DynamicSort::Timestamp(SimpleSortMethod::UpdatedAt);

fn continuation(
    item: &SoupItem<()>,
    filter: EntityFilterAst,
) -> Query<Uuid, DynamicSort, EntityFilterAst> {
    Query::Cursor(CursorWithValAndFilter {
        id: item.id(),
        limit: 2,
        val: CursorVal {
            sort_type: SORT,
            last_val: SORT.position(
                None,
                None,
                SoupItem::sort_on(SimpleSortMethod::UpdatedAt)(item).last_val,
            ),
        },
        filter,
    })
}

async fn user_id(pool: &PgPool) -> anyhow::Result<MacroUserIdStr<'static>> {
    let owner = sqlx::query_scalar!(
        r#"SELECT owner FROM "Document" WHERE id = $1"#,
        A.to_string()
    )
    .fetch_one(pool)
    .await?;
    Ok(MacroUserIdStr::parse_from_str(&owner)?.into_owned())
}

async fn flat(
    pool: &PgPool,
    cursor: Query<Uuid, DynamicSort, EntityFilterAst>,
    limit: u16,
) -> anyhow::Result<Vec<Uuid>> {
    Ok(expanded_dynamic_cursor_soup_with_projection(
        pool,
        ExpandedDynamicCursorArgs {
            user_id: user_id(pool).await?,
            limit,
            cursor,
            exclude_frecency: false,
        },
    )
    .await?
    .iter()
    .map(|item| item.item.id())
    .collect())
}

/// Every page of `filter`, `limit` rows at a time.
async fn pages(pool: &PgPool, filter: EntityFilterAst, limit: u16) -> anyhow::Result<Vec<Uuid>> {
    let mut cursor = Query::Sort(SORT, filter.clone());
    let mut seen = Vec::new();
    for _ in 0..8 {
        let page = expanded_dynamic_cursor_soup_with_projection(
            pool,
            ExpandedDynamicCursorArgs {
                user_id: user_id(pool).await?,
                limit,
                cursor,
                exclude_frecency: false,
            },
        )
        .await?;
        let Some(last) = page.last() else {
            break;
        };
        seen.extend(page.iter().map(|item| item.item.id()));
        cursor = continuation(&last.item, filter.clone());
    }
    Ok(seen)
}

async fn grouped(pool: &PgPool, filter: EntityFilterAst) -> anyhow::Result<Vec<ItemGroupingInfo>> {
    Ok(expanded_dynamic_cursor_soup_grouped(
        pool,
        GroupedDynamicCursorArgs {
            user_id: user_id(pool).await?,
            limit: 20,
            cursor: Query::Sort(SORT, filter),
            exclude_frecency: false,
            grouping: GroupingConfig {
                field: GroupByField::EntityType,
                group_key: None,
                per_group_limit: None,
            },
        },
    )
    .await?
    .collect())
}

#[test]
fn only_id_bounded_arms_check_access_after_their_filters() {
    let sql = |filter: &EntityFilterAst| {
        let mut arrays = DocumentIdArrays::starting_at(first_document_id_slot(SORT, false));
        build_query(filter, false, SORT, &mut arrays)
            .sql()
            .to_owned()
    };
    let bounded = sql(&every_document());
    assert!(bounded.contains("ORDER BY sort_ts DESC, id DESC OFFSET 0) bounded_documents"));
    assert!(bounded.contains("ea.granted_from_project_id IS NOT NULL"));
    assert!(!bounded.contains("d.id IN (\n"));

    let broad = sql(&EntityFilterAst::mock_empty());
    assert!(!broad.contains("bounded_documents"));
    assert!(broad.contains(&bound_access_semi_join(
        "d.id",
        "document",
        source_ids_slot(SORT, false)
    )));

    // An id OR'ed with anything else does not bound the arm.
    let mut widened = every_document();
    widened.document_filter = Some(Arc::new(Expr::or(
        Expr::val(DocumentLiteral::Id(A)),
        Expr::val(DocumentLiteral::FileType("md".parse().unwrap())),
    )));
    assert!(!sql(&widened).contains("bounded_documents"));
}

#[sqlx::test(
    fixtures(
        path = "../../../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn named_documents_keep_their_access_order_and_pages(pool: PgPool) -> anyhow::Result<()> {
    assert_eq!(
        flat(&pool, Query::Sort(SORT, every_document()), 20).await?,
        VISIBLE
    );
    // The page stops at its limit, and a cursor continues after it.
    assert_eq!(pages(&pool, every_document(), 2).await?, VISIBLE);

    // A grant on a non-canonical spelling of an id never matched
    // `entity_id::text`, and does not match the uuid comparison either.
    let upper = A.to_string().to_uppercase();
    sqlx::query!(
        r#"INSERT INTO "Document" ("id", "name", "owner", "fileType", "createdAt", "updatedAt")
           SELECT $1, 'Upper', owner, 'pdf', now(), now() FROM "Document" WHERE id = $2"#,
        upper,
        A.to_string(),
    )
    .execute(&pool)
    .await?;
    let mut with_upper = every_document();
    with_upper.document_filter = Some(Arc::new(Expr::or(
        Expr::val(DocumentLiteral::Id(A)),
        Expr::val(DocumentLiteral::Id(B)),
    )));
    assert_eq!(
        flat(&pool, Query::Sort(SORT, with_upper), 20).await?,
        [B, A]
    );

    let placed = grouped(&pool, every_document()).await?;
    assert_eq!(
        placed.iter().map(|item| item.item.id()).collect::<Vec<_>>(),
        VISIBLE
    );
    assert!(
        placed.iter().all(|item| item.total_group_count == 5),
        "{:?}",
        placed
            .iter()
            .map(|item| item.total_group_count)
            .collect::<Vec<_>>()
    );
    Ok(())
}

#[sqlx::test(
    fixtures(
        path = "../../../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn named_documents_probe_property_filters_per_candidate(pool: PgPool) -> anyhow::Result<()> {
    for (id, option) in [(A, NOT_STARTED), (B, IN_PROGRESS), (ISOLATED, NOT_STARTED)] {
        sqlx::query!(
            "INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values) VALUES ($1, $2, 'TASK', $3, $4)",
            Uuid::now_v7(),
            id.to_string(),
            STATUS,
            json!({"type": "SelectOption", "value": [option]}),
        )
        .execute(&pool)
        .await?;
    }
    let status = |option| {
        Expr::val(PropertiesLiteral {
            property_definition_id: STATUS,
            entity_type: Some(PropertyEntityType::Task),
            value: PropertyMatchValue::SelectOption(option),
        })
    };
    let mut filter = every_document();
    filter.properties_filter = Some(Arc::new(Expr::or(status(NOT_STARTED), status(IN_PROGRESS))));

    let mut arrays = DocumentIdArrays::starting_at(first_document_id_slot(SORT, false));
    let sql = build_query(&filter, false, SORT, &mut arrays)
        .sql()
        .to_owned();
    assert!(sql.contains("::text[] OFFSET 0\n        )"), "{sql}");

    assert_eq!(
        flat(&pool, Query::Sort(SORT, filter.clone()), 20).await?,
        [B, A]
    );
    let placed = grouped(&pool, filter).await?;
    assert_eq!(
        placed.iter().map(|item| item.item.id()).collect::<Vec<_>>(),
        [B, A]
    );
    assert!(placed.iter().all(|item| item.total_group_count == 2));
    Ok(())
}
