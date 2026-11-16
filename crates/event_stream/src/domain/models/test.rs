use super::*;

#[test]
fn cursors_parse_order_and_print_as_redis_entry_ids() {
    let earlier: Cursor = "1791910053617-3".parse().unwrap();
    let later: Cursor = "1791910053617-10".parse().unwrap();

    assert!(earlier < later, "sequence compares numerically");
    assert!(later < Cursor::floor_at(1_791_910_053_618));
    assert_eq!(later.to_string(), "1791910053617-10");
    assert_eq!("12345".parse::<Cursor>(), Err(InvalidCursor));
    assert_eq!("a-1".parse::<Cursor>(), Err(InvalidCursor));
}

#[test]
fn a_log_record_round_trips_without_empty_fields() {
    let record = LogRecord {
        event: None,
        invalidations: vec![Invalidation::BotDeleted {
            bot_id: Uuid::from_u128(1),
        }],
    };

    let wire = serde_json::to_value(&record).unwrap();

    assert_eq!(
        wire,
        serde_json::json!({
            "invalidations": [
                { "kind": "bot_deleted", "bot_id": "00000000-0000-0000-0000-000000000001" }
            ]
        })
    );
    assert_eq!(serde_json::from_value::<LogRecord>(wire).unwrap(), record);
}
