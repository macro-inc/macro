use super::*;
use macro_user_id::cowlike::CowLike;
use models_grouping::DeadlineBoundaries;
use models_pagination::CursorVal;

#[test]
fn contextual_timestamp_cursor_preserves_scope_and_rejects_conflicting_inputs() {
    let user = MacroUserIdStr::parse_from_str("macro|viewer@example.com")
        .unwrap()
        .into_owned();
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
        per_group_limit: Some(25),
    };
    let cursor = Base64Str::encode_json(GroupedTimestampCursor {
        id: Uuid::from_u128(1),
        limit: 25,
        val: CursorVal {
            sort_type: SimpleSortMethod::UpdatedAt,
            last_val: "2026-03-08T12:00:00Z".parse().unwrap(),
        },
        filter: GroupedDueDateContext {
            filters: EntityFilterAst {
                favorites_only: Some(false),
                ..Default::default()
            },
            grouping: grouping.clone(),
        },
    })
    .type_erase();
    let mut supplied = grouping.clone();
    supplied.per_group_limit = None;
    let request =
        GroupedSortQuery::continue_from(user.clone(), cursor.clone(), supplied.clone()).unwrap();
    let GroupedSortQuery::Timestamp(request) = request else {
        panic!("expected timestamp continuation");
    };
    assert_eq!(request.limit, 25);
    assert_eq!(request.grouping.field, grouping.field);
    assert_eq!(request.grouping.per_group_limit, Some(25));
    assert_eq!(request.cursor.filter().favorites_only, Some(false));
    assert!(matches!(
        request.cursor.sort_method(),
        SimpleSortMethod::UpdatedAt
    ));
    supplied.group_key = Some("tomorrow".to_owned());
    assert!(GroupedSortQuery::continue_from(user.clone(), cursor.clone(), supplied).is_err());
    let mut supplied = grouping;
    supplied.per_group_limit = Some(30);
    assert!(GroupedSortQuery::continue_from(user, cursor, supplied).is_err());
}

#[test]
fn malformed_context_never_decodes_as_unfiltered_legacy_cursor() {
    let user = MacroUserIdStr::parse_from_str("macro|viewer@example.com")
        .unwrap()
        .into_owned();
    let cursor = Base64Str::encode_json(serde_json::json!({
        "id": "00000000-0000-0000-0000-000000000001",
        "limit": 25,
        "val": { "sort_type": "updated_at", "last_val": "2026-03-08T12:00:00Z" },
        "filter": { "filters": {} }
    }))
    .type_erase();
    let grouping = GroupingConfig {
        field: GroupByField::EntityType,
        group_key: Some("document".to_owned()),
        per_group_limit: None,
    };
    assert!(GroupedSortQuery::continue_from(user, cursor, grouping).is_err());
}
