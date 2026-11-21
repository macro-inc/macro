use super::*;
use item_filters::ast::{calendar_event::CalendarEventLiteral, properties::EntityRefId};
use models_pagination::Identify;

fn assignee(kind: Option<PropertyEntityType>) -> PropertiesLiteral {
    PropertiesLiteral {
        property_definition_id: SystemPropertyKey::ASSIGNEES_UUID,
        entity_type: kind,
        value: PropertyMatchValue::EntityRef(
            EntityRefId::new("macro|viewer@example.com".into()).unwrap(),
        ),
    }
}

fn task_membership() -> Expr<DocumentLiteral> {
    Expr::or(
        Expr::val(DocumentLiteral::Owner(
            Owner::from_principal_str("macro|viewer@example.com").unwrap(),
        )),
        Expr::val(DocumentLiteral::Property(assignee(None))),
    )
}

fn project_membership() -> Expr<InitiativeLiteral> {
    Expr::or(
        Expr::val(InitiativeLiteral::Owner(
            Owner::from_principal_str("macro|viewer@example.com").unwrap(),
        )),
        Expr::val(InitiativeLiteral::Property(assignee(Some(
            PropertyEntityType::Initiative,
        )))),
    )
}

fn task_filter() -> EntityFilterAst {
    EntityFilterAst {
        document_filter: Some(Arc::new(Expr::and(
            Expr::val(DocumentLiteral::SubType(DocumentSubType::Task)),
            task_membership(),
        ))),
        chat_filter: Some(Arc::new(Expr::val(ChatLiteral::ChatId(Uuid::nil())))),
        project_filter: Some(Arc::new(Expr::val(ProjectLiteral::ProjectIdSelf(
            Uuid::nil(),
        )))),
        calendar_event_filter: Some(Arc::new(Expr::val(CalendarEventLiteral::Id(Uuid::nil())))),
        ..EntityFilterAst::mock_empty()
    }
}

#[test]
fn membership_is_a_bound_only_when_every_match_requires_it() {
    assert!(membership::bounds_documents(Some(&task_membership())));
    assert!(!membership::bounds_documents(Some(&Expr::is_not(
        task_membership()
    ))));
    assert!(!membership::bounds_documents(Some(&Expr::or(
        task_membership(),
        Expr::val(DocumentLiteral::Id(Uuid::from_u128(1))),
    ))));
    assert!(membership::bounds_initiatives(Some(&project_membership())));
    assert!(!membership::bounds_initiatives(Some(&Expr::is_not(
        project_membership()
    ))));
}

#[test]
fn timeout_detection_includes_membership_in_or_and_not() {
    let documents = Expr::or(
        task_membership(),
        Expr::val(DocumentLiteral::Id(Uuid::from_u128(1))),
    );
    assert!(membership::contains_documents(Some(&documents)));
    assert!(!membership::bounds_documents(Some(&documents)));
    assert!(membership::contains_documents(Some(&Expr::is_not(
        documents
    ))));
    assert!(!membership::contains_documents(None));

    let initiatives = Expr::or(
        project_membership(),
        Expr::val(InitiativeLiteral::NameContains("example".into())),
    );
    assert!(membership::contains_initiatives(Some(&initiatives)));
    assert!(!membership::bounds_initiatives(Some(&initiatives)));
    assert!(membership::contains_initiatives(Some(&Expr::is_not(
        initiatives
    ))));
    assert!(!membership::contains_initiatives(None));
}

#[sqlx::test(fixtures("membership.sql"), migrator = "MACRO_DB_MIGRATIONS")]
async fn membership_preserves_access_and_returns_each_item_once(
    pool: PgPool,
) -> anyhow::Result<()> {
    for (filter, prefix) in [
        (task_filter(), "a2000000"),
        (initiative_listing(project_membership()), "a3000000"),
    ] {
        let rows = expanded_dynamic_cursor_soup(
            &pool,
            ExpandedDynamicCursorArgs {
                user_id: MacroUserIdStr::parse_from_str("macro|viewer@example.com")?,
                limit: 50,
                cursor: Query::Sort(SimpleSortMethod::UpdatedAt.into(), filter),
                exclude_frecency: false,
            },
        )
        .await?;
        let ids: Vec<String> = rows.iter().map(|row| row.id().to_string()).collect();
        assert_eq!(
            ids,
            [
                format!("{prefix}-0000-0000-0000-000000000003"),
                format!("{prefix}-0000-0000-0000-000000000002"),
                format!("{prefix}-0000-0000-0000-000000000001"),
            ]
        );
    }
    Ok(())
}

#[sqlx::test(fixtures("membership.sql"), migrator = "MACRO_DB_MIGRATIONS")]
async fn grouping_counts_overlap_once_before_limiting_rows(pool: PgPool) -> anyhow::Result<()> {
    let rows: Vec<_> = expanded_dynamic_cursor_soup_grouped(
        &pool,
        GroupedDynamicCursorArgs {
            user_id: MacroUserIdStr::parse_from_str("macro|viewer@example.com")?,
            limit: 2,
            cursor: Query::Sort(SimpleSortMethod::UpdatedAt.into(), task_filter()),
            exclude_frecency: false,
            grouping: GroupingConfig {
                field: GroupByField::Property {
                    property_definition_id: SystemPropertyKey::PRIORITY_UUID,
                    entity_type: None,
                    bucketing: None,
                },
                group_key: None,
                per_group_limit: Some(2),
            },
        },
    )
    .await?
    .collect();
    assert_eq!(rows.len(), 2);
    assert!(rows.iter().all(|row| row.total_group_count == 3));
    Ok(())
}
