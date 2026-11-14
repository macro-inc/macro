use super::*;
use crate::domain::models::{
    DynamicSort, SoupProjectionHydration, SoupSortDirection, grouping::ItemGroupingInfo,
};
use item_filters::ast::{
    calendar_event::CalendarEventLiteral, chat::ChatLiteral, document::DocumentLiteral,
    project::ProjectLiteral,
};
use models_pagination::{
    CursorVal, CursorWithValAndFilter, Identify, Query, SimpleSortMethod, SortOn,
};

const A: Uuid = uuid::uuid!("11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
const B: Uuid = uuid::uuid!("11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
const C: Uuid = uuid::uuid!("11111111-cccc-cccc-cccc-cccccccccccc");
const D: Uuid = uuid::uuid!("11111111-dddd-dddd-dddd-dddddddddddd");
const UNSET: Uuid = uuid::uuid!("11111111-0000-0000-0000-000000000000");

/// Names chosen so alphabetical order disagrees with every timestamp order,
/// and so case alone would reorder them under a case-sensitive comparison.
const NAMES: [(Uuid, &str); 5] = [
    (A, "zeta plan"),
    (B, "Alpha plan"),
    (C, "beta plan"),
    (D, "GAMMA plan"),
    (UNSET, "delta plan"),
];

const ASCENDING: [Uuid; 5] = [B, C, UNSET, D, A];

fn documents() -> EntityFilterAst {
    EntityFilterAst {
        document_filter: [A, B, C, D, UNSET]
            .into_iter()
            .map(|id| Expr::val(DocumentLiteral::Id(id)))
            .reduce(Expr::or)
            .map(Arc::new),
        chat_filter: Some(Arc::new(Expr::val(ChatLiteral::Importance(false)))),
        project_filter: Some(Arc::new(Expr::val(ProjectLiteral::Importance(false)))),
        calendar_event_filter: Some(Arc::new(Expr::val(CalendarEventLiteral::Id(Uuid::nil())))),
        ..EntityFilterAst::mock_empty()
    }
}

async fn rename_documents(pool: &PgPool) -> anyhow::Result<()> {
    for (id, name) in NAMES {
        sqlx::query!(
            r#"UPDATE "Document" SET name = $1 WHERE id = $2"#,
            name,
            id.to_string(),
        )
        .execute(pool)
        .await?;
    }
    Ok(())
}

fn continuation(
    item: &SoupItem<()>,
    sort: DynamicSort,
) -> Query<Uuid, DynamicSort, EntityFilterAst> {
    Query::Cursor(CursorWithValAndFilter {
        id: item.id(),
        limit: 2,
        val: CursorVal {
            sort_type: sort,
            last_val: sort.position(
                None,
                item.name(),
                SoupItem::sort_on(SimpleSortMethod::UpdatedAt)(item).last_val,
            ),
        },
        filter: documents(),
    })
}

async fn user_id(pool: &PgPool) -> anyhow::Result<String> {
    Ok(sqlx::query_scalar!(
        r#"SELECT owner FROM "Document" WHERE id = $1"#,
        A.to_string()
    )
    .fetch_one(pool)
    .await?)
}

async fn flat(
    pool: &PgPool,
    cursor: Query<Uuid, DynamicSort, EntityFilterAst>,
    limit: u16,
) -> anyhow::Result<Vec<SoupProjectionHydration>> {
    let user_id = user_id(pool).await?;
    Ok(expanded_dynamic_cursor_soup_with_projection(
        pool,
        ExpandedDynamicCursorArgs {
            user_id: MacroUserIdStr::parse_from_str(&user_id)?,
            limit,
            cursor,
            exclude_frecency: false,
        },
    )
    .await?)
}

async fn grouped(
    pool: &PgPool,
    cursor: Query<Uuid, DynamicSort, EntityFilterAst>,
    group_key: Option<&str>,
    limit: u16,
) -> anyhow::Result<Vec<ItemGroupingInfo>> {
    let user_id = user_id(pool).await?;
    Ok(expanded_dynamic_cursor_soup_grouped(
        pool,
        GroupedDynamicCursorArgs {
            user_id: MacroUserIdStr::parse_from_str(&user_id)?,
            limit,
            cursor,
            exclude_frecency: false,
            grouping: GroupingConfig {
                field: GroupByField::EntityType,
                group_key: group_key.map(str::to_owned),
                per_group_limit: None,
            },
        },
    )
    .await?
    .collect())
}

#[sqlx::test(
    fixtures(
        path = "../../../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn name_pages_are_alphabetical_regardless_of_case(pool: PgPool) -> anyhow::Result<()> {
    rename_documents(&pool).await?;
    for direction in [SoupSortDirection::Asc, SoupSortDirection::Desc] {
        let expected: Vec<Uuid> = if direction == SoupSortDirection::Asc {
            ASCENDING.to_vec()
        } else {
            ASCENDING.iter().rev().copied().collect()
        };
        let sort = DynamicSort::name(direction);
        let mut cursor = Query::Sort(sort, documents());
        let mut seen = Vec::new();
        for _ in 0..4 {
            let page = flat(&pool, cursor, 2).await?;
            if page.is_empty() {
                break;
            }
            seen.extend(page.iter().map(|item| item.item.id()));
            cursor = continuation(&page.last().unwrap().item, sort);
        }
        assert_eq!(seen, expected, "flat {direction:?}");
    }
    Ok(())
}

/// Pages follow ICU root order, which the web's `localeCompare(…, 'und')`
/// shares: an empty name first, punctuation before digits, and "1. Intro"
/// before "10. Wrap", where the default libc collation would ignore the
/// punctuation and page the other way.
#[sqlx::test(
    fixtures(
        path = "../../../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn name_pages_follow_icu_root_order(pool: PgPool) -> anyhow::Result<()> {
    for (id, name) in [
        (A, "10. Wrap"),
        (B, "1. Intro"),
        (C, "#tag"),
        (D, ""),
        (UNSET, "Émile"),
    ] {
        sqlx::query!(
            r#"UPDATE "Document" SET name = $1 WHERE id = $2"#,
            name,
            id.to_string(),
        )
        .execute(&pool)
        .await?;
    }
    let sort = DynamicSort::name(SoupSortDirection::Asc);
    let mut cursor = Query::Sort(sort, documents());
    let mut seen = Vec::new();
    for _ in 0..4 {
        let page = flat(&pool, cursor, 2).await?;
        if page.is_empty() {
            break;
        }
        seen.extend(page.iter().map(|item| item.item.id()));
        cursor = continuation(&page.last().unwrap().item, sort);
    }
    assert_eq!(seen, [D, C, B, A, UNSET]);
    Ok(())
}

#[sqlx::test(
    fixtures(
        path = "../../../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn grouped_name_pages_rank_within_their_bin(pool: PgPool) -> anyhow::Result<()> {
    rename_documents(&pool).await?;
    let sort = DynamicSort::name(SoupSortDirection::Asc);
    let initial = grouped(&pool, Query::Sort(sort, documents()), None, 5).await?;
    assert_eq!(
        initial
            .iter()
            .map(|item| (item.key.as_str(), item.item.id(), item.index_in_group))
            .collect::<Vec<_>>(),
        ASCENDING
            .iter()
            .enumerate()
            .map(|(index, id)| ("document", *id, index + 1))
            .collect::<Vec<_>>()
    );
    assert!(initial.iter().all(|item| item.total_group_count == 5));

    let mut cursor = Query::Sort(sort, documents());
    let mut seen = Vec::new();
    for _ in 0..6 {
        let page = grouped(&pool, cursor, Some("document"), 1).await?;
        let Some(item) = page.first() else { break };
        assert_eq!(item.index_in_group, seen.len() + 1);
        seen.push(item.item.id());
        cursor = continuation(&item.item, sort);
    }
    assert_eq!(seen, ASCENDING, "grouped continuation");
    Ok(())
}

#[sqlx::test(
    fixtures(
        path = "../../../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn equal_names_page_without_repeating_or_skipping(pool: PgPool) -> anyhow::Result<()> {
    for id in [A, B, C, D, UNSET] {
        sqlx::query!(
            r#"UPDATE "Document" SET name = 'Same name' WHERE id = $1"#,
            id.to_string(),
        )
        .execute(&pool)
        .await?;
    }
    let sort = DynamicSort::name(SoupSortDirection::Asc);
    let mut cursor = Query::Sort(sort, documents());
    let mut seen: Vec<Uuid> = Vec::new();
    for _ in 0..4 {
        let page = flat(&pool, cursor, 2).await?;
        if page.is_empty() {
            break;
        }
        seen.extend(page.iter().map(|item| item.item.id()));
        cursor = continuation(&page.last().unwrap().item, sort);
    }
    assert_eq!(seen.len(), 5, "no tied document repeats: {seen:?}");
    let mut unique = seen.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(
        unique.len(),
        5,
        "every tied document appears once: {seen:?}"
    );
    Ok(())
}

/// Names come from the item's own column, so the cursor and the SQL agree on
/// the comparison; a page never binds a property definition.
#[test]
fn name_queries_order_on_the_name_column_without_a_property_join() {
    let filter = EntityFilterAst::mock_empty();
    let sort = DynamicSort::name(SoupSortDirection::Asc);
    let query = build_query(
        &filter,
        false,
        sort,
        &mut DocumentIdArrays::starting_at(first_document_id_slot(sort, false)),
    );
    let sql = query.sql().to_owned();
    let (candidates, details) = sql.split_once("Combined AS").unwrap();
    assert!(candidates.contains(r#"lower(d.name) COLLATE "und-x-icu" as sort_name"#));
    assert!(candidates.contains("all_items.sort_name ASC NULLS LAST"));
    assert!(candidates.contains(r#"lower($9::text) COLLATE "und-x-icu""#));
    assert!(!candidates.contains("ep_sort"));
    assert!(details.contains(r#"lower("name") COLLATE "und-x-icu" ASC NULLS LAST"#));
    assert_eq!(source_ids_slot(sort, false), 10);
    assert_eq!(first_document_id_slot(sort, false), 11);
    assert_eq!(source_ids_slot(sort, true), 12);
    assert_eq!(first_document_id_slot(sort, true), 13);
}
