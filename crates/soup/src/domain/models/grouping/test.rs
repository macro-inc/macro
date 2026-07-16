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
fn nested_groups_preserve_bin_and_item_insertion_order() {
    let groups: NestedSoupGroups = vec![
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
        ItemGroupingInfo {
            key: "document".to_string(),
            total_group_count: 1,
            index_in_group: 1,
            item: project(3),
        },
    ]
    .into_iter()
    .collect();

    let mut bins = groups.into_bins();
    let (project_key, project_bin) = bins.next().unwrap();
    assert_eq!(project_key, "project");
    assert_eq!(project_bin.group_total_size(), 2);
    assert_eq!(
        project_bin
            .into_items()
            .map(|item| item.id())
            .collect::<Vec<_>>(),
        vec![Uuid::from_u128(2), Uuid::from_u128(1)]
    );

    let (document_key, document_bin) = bins.next().unwrap();
    assert_eq!(document_key, "document");
    assert_eq!(
        document_bin
            .into_items()
            .map(|item| item.id())
            .collect::<Vec<_>>(),
        vec![Uuid::from_u128(3)]
    );
    assert!(bins.next().is_none());
}

#[test]
fn nested_groups_add_cursor_only_to_truncated_bins() {
    let groups: NestedSoupGroups = vec![
        ItemGroupingInfo {
            key: "truncated".to_string(),
            total_group_count: 2,
            index_in_group: 1,
            item: project(1),
        },
        ItemGroupingInfo {
            key: "complete".to_string(),
            total_group_count: 1,
            index_in_group: 1,
            item: project(2),
        },
    ]
    .into_iter()
    .collect::<NestedSoupGroups>()
    .with_next_cursors(SimpleSortMethod::UpdatedAt, EntityFilterAst::default());

    let mut bins = groups.into_bins();
    let (_, truncated) = bins.next().unwrap();
    let cursor = Base64Str::<
        CursorWithValAndFilter<Uuid, SimpleSortMethod, EntityFilterAst>,
    >::new_from_string(truncated.next_cursor().unwrap().to_owned())
    .decode_json()
    .unwrap();
    assert_eq!(cursor.id, Uuid::from_u128(1));
    assert_eq!(cursor.limit, 1);

    let (_, complete) = bins.next().unwrap();
    assert!(complete.next_cursor().is_none());
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
