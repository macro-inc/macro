use chrono::DateTime;
use item_filters::ast::EntityFilterAst;
use model_owner::Owner;
use models_grouping::GroupByField;
use models_pagination::SimpleSortMethod;
use models_soup::{item::SoupItem, project::SoupProject};
use uuid::Uuid;

use super::*;

fn project(id: u128) -> SoupItem {
    SoupItem::Project(SoupProject {
        id: Uuid::from_u128(id),
        name: format!("Project {id}"),
        owner_id: Owner::from_principal_str("macro|user@example.com").unwrap(),
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

#[test]
fn due_date_grouped_totals_and_undated_contextual_cursor() {
    use models_grouping::{DeadlineBoundaries, GroupingConfig};
    use models_pagination::DueDateSort;
    let today = DateTime::<chrono::Utc>::UNIX_EPOCH;
    let grouping = GroupingConfig::new(GroupByField::Deadline {
        boundaries: DeadlineBoundaries {
            today,
            tomorrow: today + chrono::Duration::days(1),
            day_two: today + chrono::Duration::days(2),
            day_eight: today + chrono::Duration::days(8),
        },
    });
    let response = build_due_date_grouped_response(
        vec![DueDateGroupedItem {
            grouping: ItemGroupingInfo {
                key: String::new(),
                total_group_count: 3,
                index_in_group: 1,
                item: project(1).map_extra(|()| SoupPropertiesField::default()),
            },
            due_at: None,
        }],
        &grouping,
        DueDateSort::Earliest,
        EntityFilterAst::default(),
    );
    assert_eq!(response.groups[0].total_count, 3);
    assert_eq!(response.groups[0].label, "No due date");
    let cursor =
        Base64Str::<crate::domain::models::due_date::GroupedDueDateCursor>::new_from_string(
            response.groups[0].next_cursor.clone().unwrap(),
        )
        .decode_json()
        .unwrap();
    assert_eq!(cursor.val.last_val, None);
    assert_eq!(cursor.filter.grouping.group_key.as_deref(), Some(""));
    assert_eq!(cursor.filter.grouping.field, grouping.field);
    assert_eq!(cursor.id, Uuid::from_u128(1));
    let response = build_due_date_grouped_response(
        vec![DueDateGroupedItem {
            grouping: ItemGroupingInfo {
                key: String::new(),
                total_group_count: 3,
                index_in_group: 3,
                item: project(3).map_extra(|()| SoupPropertiesField::default()),
            },
            due_at: None,
        }],
        &grouping.clone().with_group_key(""),
        DueDateSort::Earliest,
        EntityFilterAst::default(),
    );
    assert!(response.groups[0].next_cursor.is_none());
}

#[test]
fn timestamp_deadline_cursors_use_absolute_rank_and_preserve_page_size() {
    use models_grouping::{DeadlineBoundaries, GroupingConfig};
    let grouping = GroupingConfig {
        field: GroupByField::Deadline {
            boundaries: DeadlineBoundaries {
                today: "2026-03-08T05:00:00Z".parse().unwrap(),
                tomorrow: "2026-03-09T04:00:00Z".parse().unwrap(),
                day_two: "2026-03-10T04:00:00Z".parse().unwrap(),
                day_eight: "2026-03-16T04:00:00Z".parse().unwrap(),
            },
        },
        group_key: Some("today".to_owned()),
        per_group_limit: Some(2),
    };
    for index in [2, 3] {
        let response = build_timestamp_grouped_response(
            vec![ItemGroupingInfo {
                key: "today".to_owned(),
                total_group_count: 3,
                index_in_group: index,
                item: project(index as u128).map_extra(|()| SoupPropertiesField::default()),
            }],
            &grouping,
            SimpleSortMethod::UpdatedAt,
            EntityFilterAst::default(),
        );
        assert_eq!(response.groups[0].total_count, 3);
        if index == 3 {
            assert!(response.groups[0].next_cursor.is_none());
            continue;
        }
        let cursor = Base64Str::<query::GroupedTimestampCursor>::new_from_string(
            response.groups[0].next_cursor.clone().unwrap(),
        )
        .decode_json()
        .unwrap();
        assert_eq!(cursor.limit, 2);
        assert_eq!(cursor.filter.grouping.field, grouping.field);
        assert_eq!(cursor.filter.grouping.group_key, grouping.group_key);
        assert_eq!(
            cursor.filter.grouping.per_group_limit,
            grouping.per_group_limit
        );
    }
}
