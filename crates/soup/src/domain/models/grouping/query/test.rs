use super::*;
use models_pagination::{CursorVal, SimpleSortMethod};

#[test]
fn continuation_uses_requested_limit_not_initial_group_size() {
    let cursor = Base64Str::encode_json(CursorWithValAndFilter {
        id: Uuid::from_u128(1),
        limit: 10,
        val: CursorVal {
            sort_type: SimpleSortMethod::UpdatedAt,
            last_val: chrono::DateTime::default(),
        },
        filter: EntityFilterAst::default(),
    })
    .type_erase();
    let request = GroupedSortRequest::continue_from(
        MacroUserIdStr::parse_from_str("macro|viewer@example.com").unwrap(),
        cursor,
        GroupingConfig::new(models_grouping::GroupByField::EntityType).with_group_key("document"),
        Some(100),
    )
    .unwrap();
    assert_eq!(request.limit, 100);
    assert!(matches!(request.cursor, Query::Cursor(cursor) if cursor.limit == 10));
}
