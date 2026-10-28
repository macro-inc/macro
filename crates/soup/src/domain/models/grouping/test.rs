use chrono::DateTime;
use item_filters::ast::EntityFilterAst;
use model_owner::Owner;
use models_grouping::GroupByField;
use models_pagination::SimpleSortMethod;
use models_soup::{item::SoupItem, project::SoupProject};
use uuid::Uuid;

use super::*;

fn project(id: u128) -> SoupItem<SoupPropertiesField> {
    SoupItem::Project(SoupProject {
        id: Uuid::from_u128(id),
        name: format!("Project {id}"),
        owner_id: Owner::from_principal_str("macro|user@example.com").unwrap(),
        parent_id: None,
        created_at: DateTime::default(),
        updated_at: DateTime::default(),
        viewed_at: None,
        deleted_at: None,
        extra: SoupPropertiesField::default(),
    })
}

#[test]
fn grouped_response_preserves_unranked_group_and_item_order() {
    let response = build_grouped_response(
        vec![
            ItemGroupingInfo {
                sort_key: None,
                display_order: None,
                document_server_facts: None,
                key: "project".to_string(),
                total_group_count: 2,
                index_in_group: 1,
                item: project(2),
            },
            ItemGroupingInfo {
                sort_key: None,
                display_order: None,
                document_server_facts: None,
                key: "project".to_string(),
                total_group_count: 2,
                index_in_group: 2,
                item: project(1),
            },
            ItemGroupingInfo {
                sort_key: None,
                display_order: None,
                document_server_facts: None,
                key: "document".to_string(),
                total_group_count: 1,
                index_in_group: 1,
                item: project(3),
            },
        ],
        &GroupByField::Project,
        SimpleSortMethod::UpdatedAt,
        None,
        EntityFilterAst::default(),
    );

    assert_eq!(response.groups.len(), 2);
    assert_eq!(response.groups[0].key, "project");
    assert_eq!(response.groups[0].total_count, 2);
    assert_eq!(
        response.groups[0].item_ids,
        vec![Uuid::from_u128(2), Uuid::from_u128(1)]
    );
    assert_eq!(response.groups[1].key, "document");
    assert_eq!(response.groups[1].item_ids, vec![Uuid::from_u128(3)]);
}

#[test]
fn grouped_response_adds_cursor_only_to_truncated_groups() {
    let response = build_grouped_response(
        vec![
            ItemGroupingInfo {
                sort_key: None,
                display_order: None,
                document_server_facts: None,
                key: "truncated".to_string(),
                total_group_count: 2,
                index_in_group: 1,
                item: project(1),
            },
            ItemGroupingInfo {
                sort_key: None,
                display_order: None,
                document_server_facts: None,
                key: "complete".to_string(),
                total_group_count: 1,
                index_in_group: 1,
                item: project(2),
            },
        ],
        &GroupByField::Project,
        SimpleSortMethod::UpdatedAt,
        None,
        EntityFilterAst::default(),
    );

    let cursor =
        Base64Str::<CursorWithValAndFilter<Uuid, DynamicSort, EntityFilterAst>>::new_from_string(
            response.groups[0].next_cursor.clone().unwrap(),
        )
        .decode_json()
        .unwrap();
    assert_eq!(cursor.id, Uuid::from_u128(1));
    assert_eq!(cursor.limit, 1);
    assert!(matches!(
        cursor.val.sort_type,
        DynamicSort::Timestamp(SimpleSortMethod::UpdatedAt)
    ));
    assert!(response.groups[1].next_cursor.is_none());
    assert!(response.page_cursor.is_none());
}

#[test]
fn grouped_response_remains_normalized() {
    let id = Uuid::from_u128(1);
    let response = build_grouped_response(
        vec![ItemGroupingInfo {
            sort_key: None,
            display_order: None,
            document_server_facts: None,
            key: "project".to_string(),
            total_group_count: 1,
            index_in_group: 1,
            item: project(1),
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
