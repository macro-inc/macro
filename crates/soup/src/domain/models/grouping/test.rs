use chrono::DateTime;
use item_filters::ast::EntityFilterAst;
use macro_user_id::user_id::MacroUserIdStr;
use models_grouping::GroupByField;
use models_pagination::SimpleSortMethod;
use models_soup::{item::SoupItem, project::SoupProject};
use uuid::Uuid;

use super::*;

fn project(id: u128) -> SoupItem {
    SoupItem::Project(SoupProject {
        id: Uuid::from_u128(id),
        name: format!("Project {id}"),
        owner_id: MacroUserIdStr::parse_from_str("macro|user@example.com").unwrap(),
        parent_id: None,
        created_at: DateTime::default(),
        updated_at: DateTime::default(),
        viewed_at: None,
        deleted_at: None,
        extra: (),
    })
}

#[test]
fn nested_groups_order_items_by_their_group_index() {
    let groups: NestedSoupGroups<String> = vec![
        ItemGroupingInfo {
            key: "project".to_string(),
            total_group_count: 2,
            index_in_group: 2,
            item: project(2),
        },
        ItemGroupingInfo {
            key: "project".to_string(),
            total_group_count: 2,
            index_in_group: 1,
            item: project(1),
        },
    ]
    .into_iter()
    .collect();

    let (_, bin) = groups.into_bins().next().unwrap();
    assert_eq!(bin.group_total_size(), 2);
    assert_eq!(
        bin.into_items().map(|item| item.id()).collect::<Vec<_>>(),
        vec![Uuid::from_u128(1), Uuid::from_u128(2)]
    );
}

#[test]
fn rest_grouped_response_remains_normalized() {
    let id = Uuid::from_u128(1);
    let response = build_grouped_response(
        vec![ItemGroupingInfo {
            key: "project".to_string(),
            total_group_count: 1,
            index_in_group: 1,
            item: project(1).map_extra(|()| SoupPropertiesField::default()),
        }],
        &GroupByField::EntityType,
        SimpleSortMethod::ViewedUpdated,
        None,
        EntityFilterAst::default(),
    );

    assert_eq!(response.items.len(), 1);
    assert!(response.items.contains_key(&id));
    assert_eq!(response.groups.len(), 1);
    assert_eq!(response.groups[0].key, "project");
    assert_eq!(response.groups[0].label, "Projects");
    assert_eq!(response.groups[0].total_count, 1);
    assert_eq!(response.groups[0].item_ids, vec![id]);
    assert!(response.groups[0].next_cursor.is_none());
}
