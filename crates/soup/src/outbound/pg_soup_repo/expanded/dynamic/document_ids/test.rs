use super::DocumentIdArrays;
use crate::domain::models::grouping::ItemGroupingInfo;
use crate::outbound::pg_soup_repo::expanded::dynamic::{
    ExpandedDynamicCursorArgs, GroupedDynamicCursorArgs, ItemSource, build_document_filter,
    build_grouped_query, build_query, expanded_dynamic_cursor_soup,
    expanded_dynamic_cursor_soup_grouped,
};
use document_sub_type::DocumentSubType;
use filter_ast::Expr;
use item_filters::ast::{
    EntityFilterAst, calendar_event::CalendarEventLiteral, chat::ChatLiteral,
    document::DocumentLiteral, project::ProjectLiteral,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use models_grouping::{GroupByField, GroupingConfig};
use models_pagination::{CursorWithValAndFilter, Identify, Query, SimpleSortMethod, SortOn};
use models_soup::item::SoupItem;
use sqlx::PgPool;
use std::sync::Arc;
use system_properties::SystemPropertyKey;
use uuid::{Uuid, uuid};

const IN_A: Uuid = uuid!("11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
const IN_B: Uuid = uuid!("11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
const IN_C: Uuid = uuid!("11111111-cccc-cccc-cccc-cccccccccccc");
const IN_D: Uuid = uuid!("11111111-dddd-dddd-dddd-dddddddddddd");
const STANDALONE: Uuid = uuid!("11111111-0000-0000-0000-000000000000");
/// Exists, but the user has no access to it.
const ISOLATED: Uuid = uuid!("11111111-9999-9999-9999-999999999999");
const IN_PROGRESS: &str = "00000001-0000-0000-0002-000000000002";

/// `count` ids that name no document.
fn absent(tag: u128, count: u128) -> Vec<Uuid> {
    (0..count)
        .map(|i| Uuid::from_u128((tag << 64) | i))
        .collect()
}

/// `ids` among thousands that name no document.
fn among_absent(ids: &[Uuid], tag: u128) -> Vec<Uuid> {
    [ids, &absent(tag, 5_000)].concat()
}

/// A balanced OR over `ids`, as the domain builds an association; no ids is
/// the nil id an empty association becomes.
fn any_of(ids: &[Uuid]) -> Expr<DocumentLiteral> {
    match ids {
        [] => Expr::val(DocumentLiteral::Id(Uuid::nil())),
        [id] => Expr::val(DocumentLiteral::Id(*id)),
        ids => {
            let (a, b) = ids.split_at(ids.len() / 2);
            Expr::or(any_of(a), any_of(b))
        }
    }
}

fn strings(ids: &[Uuid]) -> Vec<String> {
    ids.iter().map(Uuid::to_string).collect()
}

fn render(expr: &Expr<DocumentLiteral>) -> (String, Vec<Vec<String>>) {
    let mut arrays = DocumentIdArrays::starting_at(9);
    let sql = build_document_filter(Some(expr), Some(&mut arrays));
    (sql, arrays.into_binds())
}

/// Soup restricted to the documents `filter` matches.
fn documents(filter: Expr<DocumentLiteral>) -> EntityFilterAst {
    EntityFilterAst {
        document_filter: Some(Arc::new(filter)),
        chat_filter: Some(Arc::new(Expr::val(ChatLiteral::Importance(false)))),
        project_filter: Some(Arc::new(Expr::val(ProjectLiteral::Importance(false)))),
        calendar_event_filter: Some(Arc::new(Expr::val(CalendarEventLiteral::Id(Uuid::nil())))),
        ..Default::default()
    }
}

fn tasks(filter: Expr<DocumentLiteral>) -> EntityFilterAst {
    documents(Expr::and(
        Expr::val(DocumentLiteral::SubType(DocumentSubType::Task)),
        filter,
    ))
}

fn status(entity_type: Option<&str>) -> GroupByField {
    GroupByField::Property {
        property_definition_id: SystemPropertyKey::STATUS_UUID,
        entity_type: entity_type.map(str::to_owned),
    }
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap()
}

#[test]
fn id_runs_bind_as_arrays_whatever_their_size() {
    let name = || Expr::val(DocumentLiteral::NameContains("acme".into()));
    for count in [2, 100, 5_000] {
        let (a, b) = (absent(1, count), absent(2, count));
        let both = [a.clone(), b.clone()].concat();
        for (expr, sql, binds) in [
            (any_of(&a), " AND d.id = ANY($9::text[])", vec![strings(&a)]),
            (
                Expr::is_not(any_of(&a)),
                " AND (NOT d.id = ANY($9::text[]))",
                vec![strings(&a)],
            ),
            (
                Expr::or(any_of(&a), any_of(&b)),
                " AND d.id = ANY($9::text[])",
                vec![strings(&both)],
            ),
            (
                Expr::and(any_of(&a), any_of(&b)),
                " AND (d.id = ANY($9::text[]) AND d.id = ANY($10::text[]))",
                vec![strings(&a), strings(&b)],
            ),
            (
                Expr::is_not(Expr::or(any_of(&a), any_of(&b))),
                " AND (NOT d.id = ANY($9::text[]))",
                vec![strings(&both)],
            ),
            (
                Expr::is_not(Expr::and(any_of(&a), any_of(&b))),
                " AND ((NOT d.id = ANY($9::text[])) OR (NOT d.id = ANY($10::text[])))",
                vec![strings(&a), strings(&b)],
            ),
            (
                Expr::and(Expr::or(any_of(&a), name()), Expr::is_not(any_of(&b))),
                " AND ((d.id = ANY($9::text[]) OR STRPOS(LOWER(d.name), 'acme') > 0) AND (NOT d.id = ANY($10::text[])))",
                vec![strings(&a), strings(&b)],
            ),
        ] {
            assert_eq!(render(&expr), (sql.to_owned(), binds), "{count} ids");
        }
    }
}

#[test]
fn lone_ids_render_inline() {
    let id = |id| Expr::val(DocumentLiteral::Id(id));
    for (expr, sql) in [
        (id(IN_A), format!(" AND d.id = '{IN_A}'")),
        (
            Expr::is_not(id(IN_A)),
            format!(" AND (NOT d.id = '{IN_A}')"),
        ),
        (any_of(&[]), format!(" AND d.id = '{}'", Uuid::nil())),
        (
            Expr::and(id(IN_A), id(IN_B)),
            format!(" AND (d.id = '{IN_A}' AND d.id = '{IN_B}')"),
        ),
        (
            Expr::and(Expr::is_not(id(IN_A)), id(IN_B)),
            format!(" AND ((NOT d.id = '{IN_A}') AND d.id = '{IN_B}')"),
        ),
    ] {
        assert_eq!(render(&expr), (sql, Vec::new()));
    }
}

#[test]
fn bind_free_rendering_keeps_every_id_inline() {
    let expr = Expr::is_not(any_of(&[IN_A, IN_B, IN_C]));
    assert_eq!(
        build_document_filter(Some(&expr), None),
        format!(
            " AND ((NOT d.id = '{IN_A}') AND ((NOT d.id = '{IN_B}') AND (NOT d.id = '{IN_C}')))"
        )
    );
}

#[test]
fn arrays_follow_each_querys_fixed_binds() {
    for item_source in [ItemSource::ItemTables, ItemSource::SourceItems] {
        arrays_follow_fixed_binds(item_source);
    }
}

fn arrays_follow_fixed_binds(item_source: ItemSource) {
    let render = |count| {
        let filter = tasks(Expr::and(
            any_of(&absent(1, count)),
            Expr::is_not(any_of(&absent(2, count))),
        ));
        let mut flat_ids = DocumentIdArrays::starting_at(9);
        let flat = build_query(
            &filter,
            false,
            SimpleSortMethod::UpdatedAt,
            item_source,
            &mut flat_ids,
        )
        .sql()
        .to_owned();
        let grouping = GroupingConfig {
            field: status(Some("TASK")),
            group_key: None,
            per_group_limit: None,
        };
        let mut grouped_ids = DocumentIdArrays::starting_at(11);
        let (grouped, _) = build_grouped_query(
            &filter,
            false,
            &grouping,
            SimpleSortMethod::UpdatedAt,
            &mut grouped_ids,
        );
        (
            flat,
            flat_ids.into_binds().len(),
            grouped.sql().to_owned(),
            grouped_ids.into_binds().len(),
        )
    };
    let few = render(2);
    assert_eq!(few, render(5_000));
    let (flat, flat_arrays, grouped, grouped_arrays) = few;
    assert_eq!((flat_arrays, grouped_arrays), (2, 2));
    assert!(flat.contains("(d.id = ANY($9::text[]) AND (NOT d.id = ANY($10::text[])))"));
    assert!(!flat.contains("$11"));
    assert!(grouped.contains("ep.entity_type = $10::property_entity_type"));
    assert!(grouped.contains("(d.id = ANY($11::text[]) AND (NOT d.id = ANY($12::text[])))"));
}

async fn flat_page(
    pool: &PgPool,
    cursor: Query<Uuid, SimpleSortMethod, EntityFilterAst>,
    limit: u16,
) -> anyhow::Result<Vec<SoupItem<()>>> {
    Ok(expanded_dynamic_cursor_soup(
        pool,
        ExpandedDynamicCursorArgs {
            user_id: user(),
            limit,
            cursor,
            exclude_frecency: false,
        },
    )
    .await?)
}

fn ids(items: &[SoupItem<()>]) -> Vec<Uuid> {
    items.iter().map(Identify::id).collect()
}

#[sqlx::test(
    fixtures("../../../../../../../macro_db_client/fixtures/mixed_items_expanded.sql"),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn flat_pages_match_bound_id_sets(pool: PgPool) -> anyhow::Result<()> {
    let set = |ids: &[Uuid], tag| any_of(&among_absent(ids, tag));
    let name = |name: &str| Expr::val(DocumentLiteral::NameContains(name.into()));
    for (label, filter, expected) in [
        // Membership never grants access: the isolated document stays out.
        (
            "association",
            set(&[IN_A, IN_B, IN_C, ISOLATED], 1),
            vec![IN_C, IN_B, IN_A],
        ),
        (
            "negated association",
            Expr::is_not(set(&[IN_A, IN_B], 1)),
            vec![STANDALONE, IN_D, IN_C],
        ),
        (
            "association minus another",
            Expr::and(set(&[IN_A, IN_B, IN_C], 1), Expr::is_not(set(&[IN_B], 2))),
            vec![IN_C, IN_A],
        ),
        (
            "either association",
            Expr::or(set(&[IN_A], 1), set(&[IN_D], 2)),
            vec![IN_D, IN_A],
        ),
        (
            "neither association",
            Expr::is_not(Expr::or(set(&[IN_A], 1), set(&[IN_D], 2))),
            vec![STANDALONE, IN_C, IN_B],
        ),
        (
            "not both associations",
            Expr::is_not(Expr::and(set(&[IN_A, IN_B], 1), set(&[IN_B, IN_C], 2))),
            vec![STANDALONE, IN_D, IN_C, IN_A],
        ),
        (
            "negated association or a name",
            Expr::or(
                Expr::is_not(set(&[IN_A, IN_B, IN_C, IN_D], 1)),
                name("document in b"),
            ),
            vec![STANDALONE, IN_B],
        ),
        (
            "association or a name, minus another",
            Expr::and(
                Expr::or(set(&[IN_A, IN_B], 1), name("standalone")),
                Expr::is_not(set(&[IN_A], 2)),
            ),
            vec![STANDALONE, IN_B],
        ),
        ("empty association", any_of(&[]), vec![]),
        (
            "negated empty association",
            Expr::is_not(any_of(&[])),
            vec![STANDALONE, IN_D, IN_C, IN_B, IN_A],
        ),
    ] {
        let cursor = Query::Sort(SimpleSortMethod::UpdatedAt, documents(filter));
        assert_eq!(
            ids(&flat_page(&pool, cursor, 50).await?),
            expected,
            "{label}"
        );
    }
    Ok(())
}

#[sqlx::test(
    fixtures("../../../../../../../macro_db_client/fixtures/mixed_items_expanded.sql"),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn flat_continuations_keep_bound_id_sets(pool: PgPool) -> anyhow::Result<()> {
    let filter = || {
        documents(Expr::and(
            any_of(&among_absent(&[STANDALONE, IN_D, IN_C, IN_B, IN_A], 1)),
            Expr::is_not(any_of(&among_absent(&[IN_C], 2))),
        ))
    };
    let mut cursor = Query::Sort(SimpleSortMethod::UpdatedAt, filter());
    let mut pages = Vec::new();
    for _ in 0..4 {
        let page = flat_page(&pool, cursor, 2).await?;
        let Some(last) = page.last() else {
            break;
        };
        cursor = Query::Cursor(CursorWithValAndFilter {
            id: last.id(),
            limit: 2,
            val: SoupItem::sort_on(SimpleSortMethod::UpdatedAt)(last),
            filter: filter(),
        });
        pages.push(ids(&page));
    }
    assert_eq!(pages, [vec![STANDALONE, IN_D], vec![IN_B, IN_A]]);
    Ok(())
}

async fn grouped_page(
    pool: &PgPool,
    cursor: Query<Uuid, SimpleSortMethod, EntityFilterAst>,
    grouping: GroupingConfig,
    limit: u16,
) -> anyhow::Result<Vec<ItemGroupingInfo>> {
    Ok(expanded_dynamic_cursor_soup_grouped(
        pool,
        GroupedDynamicCursorArgs {
            user_id: user(),
            limit,
            cursor,
            exclude_frecency: false,
            grouping,
        },
    )
    .await?
    .collect())
}

#[sqlx::test(
    fixtures(
        "../../../../../../../macro_db_client/fixtures/mixed_items_expanded.sql",
        "test/tasks.sql"
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn grouped_pages_match_bound_id_sets(pool: PgPool) -> anyhow::Result<()> {
    // Of the associated tasks A, C, and D, every one but D.
    let associated = || {
        Expr::and(
            any_of(&among_absent(&[IN_A, IN_B, IN_C, IN_D, ISOLATED], 1)),
            Expr::is_not(any_of(&among_absent(&[IN_D], 2))),
        )
    };
    let by_status = vec![("", IN_A), (IN_PROGRESS, IN_C)];
    for (label, field, filter, arrays, expected) in [
        // The entity type takes `$10`, the arrays `$11` and `$12`.
        (
            "status of tasks",
            status(Some("TASK")),
            associated(),
            2,
            by_status.clone(),
        ),
        // `$10` is NULL and unreferenced before the arrays.
        ("status", status(None), associated(), 2, by_status.clone()),
        (
            "entity type",
            GroupByField::EntityType,
            associated(),
            2,
            vec![("document", IN_C), ("document", IN_A)],
        ),
        // `$10` is NULL, unreferenced, and the last bind.
        (
            "status without arrays",
            status(None),
            Expr::is_not(Expr::val(DocumentLiteral::Id(IN_D))),
            0,
            by_status,
        ),
        (
            "empty association",
            GroupByField::EntityType,
            any_of(&[]),
            0,
            vec![],
        ),
    ] {
        let filter = tasks(filter);
        let grouping = GroupingConfig {
            field,
            group_key: None,
            per_group_limit: None,
        };
        let mut document_ids = DocumentIdArrays::starting_at(11);
        build_grouped_query(
            &filter,
            false,
            &grouping,
            SimpleSortMethod::UpdatedAt,
            &mut document_ids,
        );
        assert_eq!(document_ids.into_binds().len(), arrays, "{label}");
        let cursor = Query::Sort(SimpleSortMethod::UpdatedAt, filter);
        let items = grouped_page(&pool, cursor, grouping, 50).await?;
        assert_eq!(
            items
                .iter()
                .map(|item| (item.key.as_str(), item.item.id()))
                .collect::<Vec<_>>(),
            expected,
            "{label}"
        );
    }
    Ok(())
}

/// The tasks of `task_pages.sql`, newest first.
fn task_pages() -> Vec<Uuid> {
    (1..=12)
        .rev()
        .map(|n: u32| Uuid::parse_str(&format!("33333333-0000-0000-0000-{n:012}")).unwrap())
        .collect()
}

#[sqlx::test(
    fixtures(
        "../../../../../../../macro_db_client/fixtures/mixed_items_expanded.sql",
        "test/task_pages.sql"
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn grouped_continuations_keep_bound_id_sets(pool: PgPool) -> anyhow::Result<()> {
    let all_tasks = task_pages();
    let excluded = all_tasks[3];
    let expected = all_tasks
        .iter()
        .copied()
        .filter(|id| *id != excluded)
        .collect::<Vec<_>>();
    let filter = || {
        tasks(Expr::and(
            any_of(&among_absent(&all_tasks, 1)),
            Expr::is_not(any_of(&among_absent(&[excluded], 2))),
        ))
    };
    let grouping = |group_key| GroupingConfig {
        field: GroupByField::EntityType,
        group_key,
        per_group_limit: None,
    };
    let initial = grouped_page(
        &pool,
        Query::Sort(SimpleSortMethod::UpdatedAt, filter()),
        grouping(None),
        10,
    )
    .await?;
    // The initial page holds ten of the group's eleven tasks.
    assert_eq!(
        initial
            .iter()
            .map(|item| (item.item.id(), item.total_group_count, item.index_in_group))
            .collect::<Vec<_>>(),
        expected[..10]
            .iter()
            .zip(1..)
            .map(|(id, index)| (*id, 11, index))
            .collect::<Vec<_>>()
    );
    // Loading more of the group binds its key at `$9`.
    let mut seen = initial
        .iter()
        .map(|item| item.item.id())
        .collect::<Vec<_>>();
    let mut last = initial.into_iter().last().unwrap();
    for _ in 0..4 {
        let cursor = Query::Cursor(CursorWithValAndFilter {
            id: last.item.id(),
            limit: 10,
            val: SoupItem::sort_on(SimpleSortMethod::UpdatedAt)(&last.item),
            filter: filter(),
        });
        let page = grouped_page(&pool, cursor, grouping(Some("document".to_owned())), 10).await?;
        seen.extend(page.iter().map(|item| item.item.id()));
        let Some(item) = page.into_iter().last() else {
            break;
        };
        last = item;
    }
    assert_eq!(seen, expected);
    Ok(())
}
