//! A document arm bounded by named ids checks access after its own filters,
//! once per surviving candidate; these run it against the database.

use super::*;
use crate::domain::models::{DynamicSort, grouping::ItemGroupingInfo};
use cowlike::CowLike;
use item_filters::{
    NotificationState,
    ast::{
        calendar_event::CalendarEventLiteral,
        chat::ChatLiteral,
        document::DocumentLiteral,
        project::ProjectLiteral,
        properties::{PropertiesLiteral, PropertyEntityType, PropertyMatchValue},
    },
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
const NAMED: [Uuid; 6] = [ISOLATED, A, B, C, D, STANDALONE];

/// A balanced OR over `ids`, as the domain builds an association.
fn any_of(ids: &[Uuid]) -> Option<Expr<DocumentLiteral>> {
    match ids {
        [] => None,
        [id] => Some(Expr::val(DocumentLiteral::Id(*id))),
        ids => {
            let (a, b) = ids.split_at(ids.len() / 2);
            any_of(a).zip(any_of(b)).map(|(a, b)| Expr::or(a, b))
        }
    }
}

fn with_documents(document_filter: Option<Expr<DocumentLiteral>>) -> EntityFilterAst {
    EntityFilterAst {
        document_filter: document_filter.map(Arc::new),
        chat_filter: Some(Arc::new(Expr::val(ChatLiteral::Importance(false)))),
        project_filter: Some(Arc::new(Expr::val(ProjectLiteral::Importance(false)))),
        calendar_event_filter: Some(Arc::new(Expr::val(CalendarEventLiteral::Id(Uuid::nil())))),
        ..EntityFilterAst::mock_empty()
    }
}

fn documents(ids: &[Uuid]) -> EntityFilterAst {
    with_documents(any_of(ids))
}

fn every_document() -> EntityFilterAst {
    documents(&NAMED)
}

/// The named documents AND `extra`, and the same filter with the names OR'ed
/// with a file type no fixture document has: the same rows, but not bounded
/// by its ids, so it takes the semi-join path.
fn bounded_and_joined(extra: Option<Expr<DocumentLiteral>>) -> (EntityFilterAst, EntityFilterAst) {
    let named = any_of(&NAMED).unwrap();
    let widened = Expr::or(
        named.clone(),
        Expr::val(DocumentLiteral::FileType("md".parse().unwrap())),
    );
    let and_extra = |ids| match extra.clone() {
        Some(extra) => Expr::and(ids, extra),
        None => ids,
    };
    (
        with_documents(Some(and_extra(named))),
        with_documents(Some(and_extra(widened))),
    )
}

const SORT: DynamicSort = DynamicSort::Timestamp(SimpleSortMethod::UpdatedAt);

fn continuation(
    item: &SoupItem<()>,
    sort: SimpleSortMethod,
    filter: EntityFilterAst,
) -> Query<Uuid, DynamicSort, EntityFilterAst> {
    let sort_type = DynamicSort::Timestamp(sort);
    Query::Cursor(CursorWithValAndFilter {
        id: item.id(),
        limit: 2,
        val: CursorVal {
            sort_type,
            last_val: sort_type.position(None, None, SoupItem::sort_on(sort)(item).last_val),
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

async fn flat(pool: &PgPool, filter: EntityFilterAst) -> anyhow::Result<Vec<Uuid>> {
    Ok(expanded_dynamic_cursor_soup_with_projection(
        pool,
        ExpandedDynamicCursorArgs {
            user_id: user_id(pool).await?,
            limit: 20,
            cursor: Query::Sort(SORT, filter),
            exclude_frecency: false,
        },
        false,
    )
    .await?
    .iter()
    .map(|item| item.item.id())
    .collect())
}

/// Every page of `filter`, two rows at a time, each continued from the
/// cursor of the page before.
async fn pages(
    pool: &PgPool,
    sort: SimpleSortMethod,
    filter: EntityFilterAst,
    exclude_frecency: bool,
) -> anyhow::Result<Vec<Vec<Uuid>>> {
    let mut cursor = Query::Sort(DynamicSort::Timestamp(sort), filter.clone());
    let mut seen = Vec::new();
    for _ in 0..8 {
        let page = expanded_dynamic_cursor_soup_with_projection(
            pool,
            ExpandedDynamicCursorArgs {
                user_id: user_id(pool).await?,
                limit: 2,
                cursor,
                exclude_frecency,
            },
            false,
        )
        .await?;
        let Some(last) = page.last() else {
            break;
        };
        seen.push(page.iter().map(|item| item.item.id()).collect());
        cursor = continuation(&last.item, sort, filter.clone());
    }
    Ok(seen)
}

/// Pages the named documents AND `extra` through the fenced arm and through
/// the semi-join, asserts they return the same pages, and returns them.
async fn same_pages_as_semi_join(
    pool: &PgPool,
    sort: SimpleSortMethod,
    extra: Option<Expr<DocumentLiteral>>,
    exclude_frecency: bool,
) -> anyhow::Result<Vec<Uuid>> {
    let (bounded, joined) = bounded_and_joined(extra);
    let sql = |filter: &EntityFilterAst| {
        let sort = DynamicSort::Timestamp(sort);
        let mut arrays = DocumentIdArrays::starting_at(first_document_id_slot(sort, false));
        build_query(
            filter,
            exclude_frecency,
            sort,
            DocumentGrants::Estimated,
            &mut arrays,
        )
        .sql()
        .to_owned()
    };
    assert!(sql(&bounded).contains("bounded_documents"));
    assert!(!sql(&joined).contains("bounded_documents"));

    let fenced = pages(pool, sort, bounded, exclude_frecency).await?;
    assert_eq!(fenced, pages(pool, sort, joined, exclude_frecency).await?);
    Ok(fenced.into_iter().flatten().collect())
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

async fn grouped_ids(pool: &PgPool, filter: EntityFilterAst) -> anyhow::Result<Vec<Uuid>> {
    Ok(grouped(pool, filter)
        .await?
        .iter()
        .map(|item| item.item.id())
        .collect())
}

#[test]
fn only_id_bounded_arms_check_access_after_their_filters() {
    let sql = |filter: &EntityFilterAst| {
        let mut arrays = DocumentIdArrays::starting_at(first_document_id_slot(SORT, false));
        build_query(filter, false, SORT, DocumentGrants::Estimated, &mut arrays)
            .sql()
            .to_owned()
    };
    let bounded = sql(&every_document());
    assert!(bounded.contains(
        "ORDER BY sort_ts DESC, id DESC OFFSET 0) bounded_documents WHERE ($4::timestamptz IS NULL OR (bounded_documents.sort_ts"
    ));
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

    // So does a list too long to probe one id at a time.
    let ids: Vec<Uuid> = (0..=MAX_NAMED_CANDIDATES as u128)
        .map(Uuid::from_u128)
        .collect();
    assert!(sql(&documents(&ids[1..])).contains("bounded_documents"));
    assert!(!sql(&documents(&ids)).contains("bounded_documents"));
}

#[sqlx::test(
    fixtures(
        path = "../../../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn named_documents_keep_their_access_order_and_pages(pool: PgPool) -> anyhow::Result<()> {
    assert_eq!(flat(&pool, every_document()).await?, VISIBLE);
    // The page stops at its limit, and a cursor continues after it.
    assert_eq!(
        same_pages_as_semi_join(&pool, SimpleSortMethod::UpdatedAt, None, false).await?,
        VISIBLE
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

/// A grant to someone else gives the viewer nothing.
#[sqlx::test(
    fixtures(
        path = "../../../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    fixtures(path = ".", scripts("other_user_grant")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn named_documents_ignore_other_sources_grants(pool: PgPool) -> anyhow::Result<()> {
    assert_eq!(flat(&pool, every_document()).await?, VISIBLE);
    assert_eq!(grouped_ids(&pool, every_document()).await?, VISIBLE);
    Ok(())
}

/// A grant on the same uuid for another kind of entity does not reach the
/// document.
#[sqlx::test(
    fixtures(
        path = "../../../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    fixtures(path = ".", scripts("chat_typed_grant")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn named_documents_ignore_grants_for_other_entity_types(pool: PgPool) -> anyhow::Result<()> {
    assert_eq!(flat(&pool, every_document()).await?, VISIBLE);
    assert_eq!(grouped_ids(&pool, every_document()).await?, VISIBLE);
    Ok(())
}

/// A grant to a team the viewer belongs to counts, not only grants to the
/// viewer's own id.
#[sqlx::test(
    fixtures(
        path = "../../../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    fixtures(path = ".", scripts("team_grant")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn named_documents_honor_team_grants(pool: PgPool) -> anyhow::Result<()> {
    let with_isolated = [ISOLATED, STANDALONE, D, C, B, A];
    assert_eq!(flat(&pool, every_document()).await?, with_isolated);
    assert_eq!(grouped_ids(&pool, every_document()).await?, with_isolated);
    Ok(())
}

#[sqlx::test(
    fixtures(
        path = "../../../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn named_documents_page_by_view_time_like_the_semi_join(pool: PgPool) -> anyhow::Result<()> {
    // The fixture viewed B, A, the standalone document and D; never C.
    let viewed = same_pages_as_semi_join(&pool, SimpleSortMethod::ViewedAt, None, false).await?;
    assert_eq!(viewed, [B, A, STANDALONE, D, C]);
    Ok(())
}

#[sqlx::test(
    fixtures(
        path = "../../../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn named_documents_page_by_view_or_update_time_like_the_semi_join(
    pool: PgPool,
) -> anyhow::Result<()> {
    let viewed =
        same_pages_as_semi_join(&pool, SimpleSortMethod::ViewedUpdated, None, false).await?;
    assert_eq!(viewed, [B, A, STANDALONE, D, C]);
    Ok(())
}

/// The task-property joins sit inside the fence when the filter asks for
/// important documents: non-tasks, and tasks assigned to the viewer.
#[sqlx::test(
    fixtures(
        path = "../../../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    fixtures(path = ".", scripts("fenced_shapes")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn named_important_documents_match_the_semi_join(pool: PgPool) -> anyhow::Result<()> {
    let important = Some(Expr::val(DocumentLiteral::Importance(true)));
    assert_eq!(
        same_pages_as_semi_join(&pool, SimpleSortMethod::UpdatedAt, important, false).await?,
        [STANDALONE, D, C, B]
    );
    Ok(())
}

/// A notification filter joins the viewer's notifications inside the fence;
/// a notified document the viewer cannot see stays out.
#[sqlx::test(
    fixtures(
        path = "../../../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    fixtures(path = ".", scripts("fenced_shapes")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn named_notified_documents_match_the_semi_join(pool: PgPool) -> anyhow::Result<()> {
    let unseen = Some(Expr::val(DocumentLiteral::NotificationState(
        NotificationState::Unseen,
    )));
    let (bounded, _) = bounded_and_joined(unseen.clone());
    let mut arrays = DocumentIdArrays::starting_at(first_document_id_slot(SORT, false));
    assert!(
        build_query(
            &bounded,
            false,
            SORT,
            DocumentGrants::Estimated,
            &mut arrays
        )
        .sql()
        .contains("INNER JOIN NotificationItems ni_document")
    );
    assert_eq!(
        same_pages_as_semi_join(&pool, SimpleSortMethod::UpdatedAt, unseen, false).await?,
        [D, B]
    );
    Ok(())
}

#[sqlx::test(
    fixtures(
        path = "../../../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    fixtures(path = ".", scripts("fenced_shapes")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn named_documents_without_frecency_match_the_semi_join(pool: PgPool) -> anyhow::Result<()> {
    assert_eq!(
        same_pages_as_semi_join(&pool, SimpleSortMethod::UpdatedAt, None, true).await?,
        [STANDALONE, D, B, A]
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
    let sql = build_query(&filter, false, SORT, DocumentGrants::Estimated, &mut arrays)
        .sql()
        .to_owned();
    assert!(sql.contains("::text[] OFFSET 0\n        )"), "{sql}");

    assert_eq!(flat(&pool, filter.clone()).await?, [B, A]);
    let placed = grouped(&pool, filter).await?;
    assert_eq!(
        placed.iter().map(|item| item.item.id()).collect::<Vec<_>>(),
        [B, A]
    );
    assert!(placed.iter().all(|item| item.total_group_count == 2));
    Ok(())
}
