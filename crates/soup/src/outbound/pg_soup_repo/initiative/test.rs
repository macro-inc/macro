use super::*;
use crate::outbound::pg_soup_repo::expanded::dynamic::{
    ExpandedDynamicCursorArgs, GroupedDynamicCursorArgs, expanded_dynamic_cursor_soup,
    expanded_dynamic_cursor_soup_grouped,
};
use filter_ast::Expr;
use item_filters::ast::{
    EntityFilterAst, calendar_event::CalendarEventLiteral, chat::ChatLiteral,
    document::DocumentLiteral, initiative::InitiativeLiteral, project::ProjectLiteral,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use models_grouping::{GroupByField, GroupingConfig};
use models_pagination::Identify;
use models_pagination::{CursorWithValAndFilter, Query, SimpleSortMethod, SortOn};
use std::sync::Arc;

fn filters() -> EntityFilterAst {
    EntityFilterAst {
        initiative_filter: Some(Arc::new(Expr::val(InitiativeLiteral::Include))),
        document_filter: Some(Arc::new(Expr::val(DocumentLiteral::Id(Uuid::nil())))),
        chat_filter: Some(Arc::new(Expr::val(ChatLiteral::Importance(false)))),
        project_filter: Some(Arc::new(Expr::val(ProjectLiteral::Importance(false)))),
        calendar_event_filter: Some(Arc::new(Expr::val(CalendarEventLiteral::Id(Uuid::nil())))),
        ..EntityFilterAst::default()
    }
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap()
}

#[sqlx::test(
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    fixtures("test/initiatives.sql"),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn initiatives_access_cursor_and_hydration(pool: PgPool) -> anyhow::Result<()> {
    let mut without_initiatives = filters();
    without_initiatives.initiative_filter = None;
    assert!(
        expanded_dynamic_cursor_soup(
            &pool,
            ExpandedDynamicCursorArgs {
                user_id: user(),
                limit: 20,
                cursor: Query::Sort(SimpleSortMethod::UpdatedAt, without_initiatives),
                exclude_frecency: false,
            }
        )
        .await?
        .is_empty(),
        "existing views do not opt into initiatives by default"
    );
    let sort = SimpleSortMethod::UpdatedAt;
    let first = expanded_dynamic_cursor_soup(
        &pool,
        ExpandedDynamicCursorArgs {
            user_id: user(),
            limit: 2,
            cursor: Query::Sort(sort, filters()),
            exclude_frecency: false,
        },
    )
    .await?;
    assert_eq!(first.len(), 2);
    assert_eq!(
        first[0].id(),
        Uuid::from_u128(0xad000000000000000000000000000004)
    );
    assert_eq!(
        first[1].id(),
        Uuid::from_u128(0xad000000000000000000000000000003)
    );
    let second = expanded_dynamic_cursor_soup(
        &pool,
        ExpandedDynamicCursorArgs {
            user_id: user(),
            limit: 2,
            cursor: Query::Cursor(CursorWithValAndFilter {
                id: first[1].id(),
                limit: 2,
                val: SoupItem::sort_on(sort)(&first[1]),
                filter: filters(),
            }),
            exclude_frecency: false,
        },
    )
    .await?;
    assert_eq!(
        second.iter().map(Identify::id).collect::<Vec<_>>(),
        vec![
            Uuid::from_u128(0xad000000000000000000000000000002),
            Uuid::from_u128(0xad000000000000000000000000000001)
        ]
    );
    let SoupItem::Initiative(item) = &first[0] else {
        panic!("expected initiative")
    };
    assert_eq!(
        item.description_document_id,
        Some(Uuid::from_u128(0xaf000000000000000000000000000004))
    );
    // The fixture inserts rows the way the previous release does, without a surface; the
    // migration's trigger names the document's session.
    assert_eq!(
        item.description_surface_id,
        Some(Uuid::from_u128(0xaf000000000000000000000000000004))
    );
    let ids = (1..=6)
        .map(|id| {
            EntityType::Initiative.with_entity_string(
                Uuid::from_u128(0xad000000000000000000000000000000 + id).to_string(),
            )
        })
        .collect::<Vec<_>>();
    let hydrated = by_ids(
        &pool,
        AdvancedSortParams {
            user_id: user(),
            entities: &ids,
        },
    )
    .await?;
    assert_eq!(
        hydrated.len(),
        4,
        "by-ID reads preserve the same access rules"
    );
    Ok(())
}

#[sqlx::test(
    fixtures(
        path = "../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    fixtures("test/initiatives.sql"),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn initiatives_grouping_and_property_enrichment(pool: PgPool) -> anyhow::Result<()> {
    let rows = expanded_dynamic_cursor_soup_grouped(
        &pool,
        GroupedDynamicCursorArgs {
            user_id: user(),
            limit: 20,
            cursor: Query::Sort(SimpleSortMethod::UpdatedAt, filters()),
            exclude_frecency: false,
            grouping: GroupingConfig {
                field: GroupByField::Property {
                    property_definition_id: system_properties::SystemPropertyKey::STATUS_UUID,
                    entity_type: Some("INITIATIVE".into()),
                },
                group_key: None,
                per_group_limit: None,
            },
        },
    )
    .await?
    .collect::<Vec<_>>();
    assert_eq!(rows.len(), 4);
    assert_eq!(rows[0].total_group_count, 4);
    let enriched = crate::outbound::pg_soup_repo::populate_properties(
        &pool,
        user(),
        rows.into_iter().map(|row| row.item).collect(),
    )
    .await?;
    let SoupItem::Initiative(item) = &enriched[0] else {
        panic!("expected initiative")
    };
    assert!(!item.extra.properties.is_empty());
    let mut filtered = filters();
    filtered.initiative_filter = Some(Arc::new(Expr::val(InitiativeLiteral::NameContains(
        "launch 2".into(),
    ))));
    let items = expanded_dynamic_cursor_soup(
        &pool,
        ExpandedDynamicCursorArgs {
            user_id: user(),
            limit: 20,
            cursor: Query::Sort(SimpleSortMethod::UpdatedAt, filtered),
            exclude_frecency: false,
        },
    )
    .await?;
    assert_eq!(items.len(), 1);
    assert_eq!(
        items[0].id(),
        Uuid::from_u128(0xad000000000000000000000000000002)
    );
    for (literal, expected) in [
        (
            InitiativeLiteral::DueBefore("2026-02-10T00:00:00Z".parse()?),
            1,
        ),
        (
            InitiativeLiteral::DueAfter("2026-02-10T00:00:00Z".parse()?),
            1,
        ),
        (
            InitiativeLiteral::DueBefore("2026-02-09T00:00:00Z".parse()?),
            0,
        ),
    ] {
        let mut filter = filters();
        filter.initiative_filter = Some(Arc::new(Expr::val(literal)));
        let items = expanded_dynamic_cursor_soup(
            &pool,
            ExpandedDynamicCursorArgs {
                user_id: user(),
                limit: 20,
                cursor: Query::Sort(SimpleSortMethod::UpdatedAt, filter),
                exclude_frecency: false,
            },
        )
        .await?;
        assert_eq!(
            items.len(),
            expected,
            "due-date bounds exclude missing dates and include exact matches"
        );
    }
    Ok(())
}
