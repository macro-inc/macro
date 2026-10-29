use super::*;
use crate::domain::models::SoupPropertiesField;
use crate::domain::models::grouping::{ItemGroupingInfo, build_grouped_response};
use document_sub_type::DocumentSubType;
use item_filters::ast::project::ProjectLiteral;
use uuid::{Uuid, uuid};

#[sqlx::test(
    fixtures(
        path = "../../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    fixtures(path = ".", scripts("project")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn tasks_group_by_their_project_property(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let owner = sqlx::query_scalar!(
        r#"SELECT owner FROM "Document" WHERE id = '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'"#
    )
    .fetch_one(&pool)
    .await?;
    let user_id = MacroUserIdStr::parse_from_str(&owner)?;
    let filter = EntityFilterAst {
        document_filter: Some(Arc::new(Expr::val(DocumentLiteral::SubType(
            DocumentSubType::Task,
        )))),
        chat_filter: Some(Arc::new(Expr::val(ChatLiteral::Importance(false)))),
        project_filter: Some(Arc::new(Expr::val(ProjectLiteral::Importance(false)))),
        ..EntityFilterAst::mock_empty()
    };
    // Exercise both the initial bins and the group-specific load-more query.
    for group_key in [
        None,
        Some("ad000000-0000-0000-0000-000000000001"),
        Some("ad000000-0000-0000-0000-000000000002"),
        Some(""),
    ] {
        let items = expanded_dynamic_cursor_soup_grouped(
            &pool,
            GroupedDynamicCursorArgs {
                user_id: user_id.copied(),
                limit: 50,
                cursor: Query::Sort(SimpleSortMethod::ViewedUpdated, filter.clone()),
                exclude_frecency: false,
                grouping: GroupingConfig {
                    field: GroupByField::Project,
                    group_key: group_key.map(str::to_owned),
                    per_group_limit: None,
                },
            },
        )
        .await?
        .collect::<Vec<_>>();
        let expected: Vec<(&str, Uuid)> = vec![
            (
                "ad000000-0000-0000-0000-000000000001",
                uuid!("11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
            ),
            (
                "ad000000-0000-0000-0000-000000000002",
                uuid!("11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
            ),
            ("", uuid!("11111111-cccc-cccc-cccc-cccccccccccc")),
        ]
        .into_iter()
        .filter(|(key, _)| group_key.is_none_or(|requested| requested == *key))
        .collect();
        assert_eq!(items.len(), expected.len());
        for (key, id) in expected {
            let item = items
                .iter()
                .find(|item| item.item.id() == id)
                .expect("task returned");
            assert_eq!(item.key, key);
            assert_eq!(item.total_group_count, 1);
        }
        let response = build_grouped_response(
            items.into_iter().map(|group| ItemGroupingInfo {
                key: group.key,
                total_group_count: group.total_group_count,
                index_in_group: group.index_in_group,
                item: group.item.map_extra(|()| SoupPropertiesField::default()),
            }),
            &GroupByField::Project,
            SimpleSortMethod::ViewedUpdated,
            group_key.map(str::to_owned),
            filter.clone(),
        );
        if group_key.is_none() || group_key == Some("") {
            let unassigned = response
                .groups
                .iter()
                .find(|group| group.key.is_empty())
                .expect("unassigned group");
            assert_eq!(unassigned.label, "No Project");
            assert_eq!(unassigned.total_count, 1);
        }
    }
    Ok(())
}
