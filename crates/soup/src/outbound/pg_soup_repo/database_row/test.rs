use super::*;
use crate::outbound::pg_soup_repo::expanded::dynamic::{
    ExpandedDynamicCursorArgs, GroupedDynamicCursorArgs, expanded_dynamic_cursor_soup,
    expanded_dynamic_cursor_soup_grouped,
};
use filter_ast::Expr;
use item_filters::ast::{
    EntityFilterAst,
    calendar_event::CalendarEventLiteral,
    chat::ChatLiteral,
    database_row::DatabaseRowLiteral,
    document::DocumentLiteral,
    project::ProjectLiteral,
    properties::{PropertiesLiteral, PropertyMatchValue},
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use models_grouping::{GroupByField, GroupingConfig};
use models_pagination::{Identify, Query, SimpleSortMethod};
use models_properties::service::property_value::PropertyValue;
use models_soup::database_row::SoupDatabaseRow;
use std::sync::Arc;

const CRM: Uuid = Uuid::from_u128(0xdb000000_0000_0000_0000_000000000001);
const DEALS: Uuid = Uuid::from_u128(0x7ab00000_0000_0000_0000_000000000001);
const CONTACTS: Uuid = Uuid::from_u128(0x7ab00000_0000_0000_0000_000000000002);
const NOTES: Uuid = Uuid::from_u128(0x7ab00000_0000_0000_0000_000000000003);
const STAGE: Uuid = Uuid::from_u128(0x5e1ec700_0000_0000_0000_000000000001);
const WON: Uuid = Uuid::from_u128(0x0e000000_0000_0000_0000_000000000001);
const LOST: Uuid = Uuid::from_u128(0x0e000000_0000_0000_0000_000000000002);
const DEAL_1: Uuid = Uuid::from_u128(0x70000000_0000_0000_0000_000000000001);
const DEAL_2: Uuid = Uuid::from_u128(0x70000000_0000_0000_0000_000000000002);
const DEAL_3: Uuid = Uuid::from_u128(0x70000000_0000_0000_0000_000000000003);
const NOTE: Uuid = Uuid::from_u128(0x70000000_0000_0000_0000_000000000005);

fn viewer() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|viewer@databases.test").unwrap()
}

fn stranger() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|stranger@databases.test").unwrap()
}

/// Rows only: every other kind the dynamic query reads is ruled out the way
/// the browser rules it out.
fn rows_of(row_filter: Option<Expr<DatabaseRowLiteral>>) -> EntityFilterAst {
    EntityFilterAst {
        database_row_filter: row_filter.map(Arc::new),
        document_filter: Some(Arc::new(Expr::val(DocumentLiteral::Id(Uuid::nil())))),
        chat_filter: Some(Arc::new(Expr::val(ChatLiteral::Importance(false)))),
        project_filter: Some(Arc::new(Expr::val(ProjectLiteral::Importance(false)))),
        calendar_event_filter: Some(Arc::new(Expr::val(CalendarEventLiteral::Id(Uuid::nil())))),
        ..EntityFilterAst::default()
    }
}

async fn page(
    pool: &PgPool,
    user_id: MacroUserIdStr<'static>,
    filter: EntityFilterAst,
) -> Vec<SoupItem<()>> {
    expanded_dynamic_cursor_soup(
        pool,
        ExpandedDynamicCursorArgs {
            user_id,
            limit: 20,
            cursor: Query::Sort(SimpleSortMethod::CreatedAt, filter),
            exclude_frecency: false,
        },
    )
    .await
    .unwrap()
}

#[sqlx::test(fixtures("test/database_rows.sql"), migrator = "MACRO_DB_MIGRATIONS")]
async fn a_viewer_reads_the_won_deals_of_one_table(pool: PgPool) {
    let items = expanded_dynamic_cursor_soup(
        &pool,
        ExpandedDynamicCursorArgs {
            user_id: MacroUserIdStr::parse_from_str("macro|viewer@databases.test").unwrap(),
            limit: 20,
            cursor: Query::Sort(
                SimpleSortMethod::CreatedAt,
                EntityFilterAst {
                    database_row_filter: Some(Arc::new(Expr::val(DatabaseRowLiteral::TableId(
                        DEALS,
                    )))),
                    document_filter: Some(Arc::new(Expr::val(DocumentLiteral::Id(Uuid::nil())))),
                    chat_filter: Some(Arc::new(Expr::val(ChatLiteral::Importance(false)))),
                    project_filter: Some(Arc::new(Expr::val(ProjectLiteral::Importance(false)))),
                    calendar_event_filter: Some(Arc::new(Expr::val(CalendarEventLiteral::Id(
                        Uuid::nil(),
                    )))),
                    properties_filter: Some(Arc::new(Expr::val(PropertiesLiteral {
                        property_definition_id: STAGE,
                        entity_type: None,
                        value: PropertyMatchValue::SelectOption(WON),
                    }))),
                    ..EntityFilterAst::default()
                },
            ),
            exclude_frecency: false,
        },
    )
    .await
    .unwrap();

    let rows: Vec<SoupDatabaseRow> = items
        .into_iter()
        .map(|item| match item {
            SoupItem::DatabaseRow(row) => row,
            other => panic!("expected a database row, got {other:?}"),
        })
        .collect();
    assert_eq!(
        rows,
        vec![
            SoupDatabaseRow {
                id: DEAL_3,
                table_id: DEALS,
                database_id: CRM,
                position: "c".into(),
                owner_id: Owner::from_principal_str("macro|owner@databases.test").unwrap(),
                created_by: None,
                created_at: "2026-01-03T00:00:00Z".parse().unwrap(),
                updated_at: "2026-01-05T00:00:00Z".parse().unwrap(),
                extra: (),
            },
            SoupDatabaseRow {
                id: DEAL_1,
                table_id: DEALS,
                database_id: CRM,
                position: "a".into(),
                owner_id: Owner::from_principal_str("macro|owner@databases.test").unwrap(),
                created_by: Some("macro|owner@databases.test".into()),
                created_at: "2026-01-01T00:00:00Z".parse().unwrap(),
                updated_at: "2026-01-01T00:00:00Z".parse().unwrap(),
                extra: (),
            },
        ]
    );
}

#[sqlx::test(fixtures("test/database_rows.sql"), migrator = "MACRO_DB_MIGRATIONS")]
async fn naming_a_table_reads_only_that_tables_rows(pool: PgPool) {
    let items = page(
        &pool,
        viewer(),
        rows_of(Some(Expr::val(DatabaseRowLiteral::TableId(DEALS)))),
    )
    .await;

    assert_eq!(
        items.iter().map(Identify::id).collect::<Vec<_>>(),
        vec![DEAL_3, DEAL_2, DEAL_1]
    );
}

#[sqlx::test(fixtures("test/database_rows.sql"), migrator = "MACRO_DB_MIGRATIONS")]
async fn rows_stay_out_of_queries_that_name_no_table(pool: PgPool) {
    assert!(page(&pool, viewer(), rows_of(None)).await.is_empty());
    assert!(
        page(
            &pool,
            viewer(),
            rows_of(Some(Expr::is_not(Expr::val(DatabaseRowLiteral::TableId(
                CONTACTS
            ))))),
        )
        .await
        .is_empty()
    );
}

#[sqlx::test(fixtures("test/database_rows.sql"), migrator = "MACRO_DB_MIGRATIONS")]
async fn a_stranger_reads_no_rows_of_a_database_not_shared_with_them(pool: PgPool) {
    assert!(
        page(
            &pool,
            stranger(),
            rows_of(Some(Expr::val(DatabaseRowLiteral::TableId(DEALS)))),
        )
        .await
        .is_empty()
    );
    assert_eq!(
        page(
            &pool,
            stranger(),
            rows_of(Some(Expr::val(DatabaseRowLiteral::TableId(NOTES)))),
        )
        .await
        .iter()
        .map(Identify::id)
        .collect::<Vec<_>>(),
        vec![NOTE]
    );
}

#[sqlx::test(fixtures("test/database_rows.sql"), migrator = "MACRO_DB_MIGRATIONS")]
async fn deals_grouped_by_stage_count_each_option(pool: PgPool) {
    let groups = expanded_dynamic_cursor_soup_grouped(
        &pool,
        GroupedDynamicCursorArgs {
            user_id: viewer(),
            limit: 20,
            cursor: Query::Sort(
                SimpleSortMethod::CreatedAt,
                rows_of(Some(Expr::val(DatabaseRowLiteral::TableId(DEALS)))),
            ),
            exclude_frecency: false,
            grouping: GroupingConfig {
                field: GroupByField::Property {
                    property_definition_id: STAGE,
                    entity_type: Some("DATABASE_ROW".into()),
                },
                group_key: None,
                per_group_limit: None,
            },
        },
    )
    .await
    .unwrap()
    .map(|info| (info.key, info.total_group_count, info.item.id()))
    .collect::<Vec<_>>();

    assert_eq!(
        groups,
        vec![
            (WON.to_string(), 2, DEAL_3),
            (WON.to_string(), 2, DEAL_1),
            (LOST.to_string(), 1, DEAL_2),
        ]
    );
}

#[sqlx::test(fixtures("test/database_rows.sql"), migrator = "MACRO_DB_MIGRATIONS")]
async fn hydrating_by_id_keeps_the_database_access_rule(pool: PgPool) {
    let entities =
        [DEAL_1, NOTE].map(|id| EntityType::DatabaseRow.with_entity_string(id.to_string()));

    let items = by_ids(
        &pool,
        AdvancedSortParams {
            user_id: viewer(),
            entities: &entities,
        },
    )
    .await
    .unwrap();

    assert_eq!(
        items.iter().map(Identify::id).collect::<Vec<_>>(),
        vec![DEAL_1]
    );
}

/// A row's cells are properties of database-owned definitions, which are
/// neither system properties nor the viewer's tags: a row carries them all.
#[sqlx::test(fixtures("test/database_rows.sql"), migrator = "MACRO_DB_MIGRATIONS")]
async fn a_row_carries_every_cell_as_a_property(pool: PgPool) {
    let items = page(
        &pool,
        viewer(),
        rows_of(Some(Expr::val(DatabaseRowLiteral::Id(DEAL_1)))),
    )
    .await;

    let rows = crate::outbound::pg_soup_repo::populate_properties(&pool, viewer(), items)
        .await
        .unwrap();

    let [SoupItem::DatabaseRow(row)] = rows.as_slice() else {
        panic!("expected one database row, got {rows:?}");
    };
    let cells: Vec<(Uuid, Option<PropertyValue>)> = row
        .extra
        .properties
        .iter()
        .map(|property| (property.definition.id, property.value.clone()))
        .collect();
    assert_eq!(
        cells,
        vec![(STAGE, Some(PropertyValue::SelectOption(vec![WON])))]
    );
}
