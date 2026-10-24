use super::*;
use chrono::Duration;
use models_grouping::{DeadlineBoundaries, GroupByField, GroupingConfig};
use models_pagination::{Base64Str, Cursor, CursorVal};

#[test]
fn contextual_deadline_cursor_freezes_key_and_boundaries() {
    let today = DateTime::<Utc>::UNIX_EPOCH + Duration::days(20_000);
    let original = GroupingConfig::new(GroupByField::Deadline {
        boundaries: DeadlineBoundaries {
            today,
            tomorrow: today + Duration::days(1),
            day_two: today + Duration::days(2),
            day_eight: today + Duration::days(8),
        },
    })
    .with_group_key("today");
    let cursor = Cursor {
        id: Uuid::from_u128(12),
        limit: 2,
        val: CursorVal {
            sort_type: DueDateSort::Earliest,
            last_val: None,
        },
        filter: GroupedDueDateContext {
            filters: EntityFilterAst::default(),
            grouping: original.clone(),
        },
    };
    let encoded = Base64Str::encode_json(cursor).type_erase();
    let cursor = Base64Str::<GroupedDueDateCursor>::new_from_string(encoded)
        .decode_json()
        .unwrap();
    let user = MacroUserIdStr::parse_from_str("macro|user@example.com").unwrap();
    let mut conflicting = original.clone();
    conflicting.field = GroupByField::Deadline {
        boundaries: DeadlineBoundaries {
            today: today + Duration::days(1),
            tomorrow: today + Duration::days(2),
            day_two: today + Duration::days(3),
            day_eight: today + Duration::days(9),
        },
    };
    assert!(
        GroupedDueDateRequest::continue_from(user.clone(), cursor.clone(), Some(conflicting))
            .is_err()
    );
    let req = GroupedDueDateRequest::continue_from(user, cursor, None).unwrap();
    assert_eq!(req.grouping.field, original.field);
    assert_eq!(req.grouping.group_key.as_deref(), Some("today"));
    assert!(
        matches!(req.cursor, Query::Cursor(ref c) if c.val.last_val.is_none() && c.id == Uuid::from_u128(12))
    );
}

#[test]
fn invalid_boundaries_and_missing_group_key_fail() {
    let today = DateTime::<Utc>::UNIX_EPOCH;
    let grouping = GroupingConfig::new(GroupByField::Deadline {
        boundaries: DeadlineBoundaries {
            today,
            tomorrow: today,
            day_two: today,
            day_eight: today,
        },
    });
    let user = MacroUserIdStr::parse_from_str("macro|user@example.com").unwrap();
    assert!(
        GroupedDueDateRequest::initial(
            user.clone(),
            10,
            DueDateSort::Latest,
            EntityFilterAst::default(),
            grouping
        )
        .is_err()
    );
    let cursor = Cursor {
        id: Uuid::from_u128(1),
        limit: 10,
        val: CursorVal {
            sort_type: DueDateSort::Latest,
            last_val: None,
        },
        filter: GroupedDueDateContext {
            filters: EntityFilterAst::default(),
            grouping: GroupingConfig::new(GroupByField::EntityType),
        },
    };
    assert!(GroupedDueDateRequest::continue_from(user, cursor, None).is_err());
}
