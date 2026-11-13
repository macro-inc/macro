use super::*;

#[test]
fn unexpected_negative_positions_encode_as_zero() {
    let id = Uuid::from_u128(1);
    let before_epoch = DateTime::from_timestamp_micros(-1).unwrap();
    let expected = format!("00000000000000000000-{id}");
    assert_eq!(
        encode_cursor(&MessageCursor {
            created_at: before_epoch,
            id
        }),
        expected
    );
    let key = encode_reply_cursor(&MessageReplyCursor {
        import_order: Some(-1),
        created_at: before_epoch,
        id,
    });
    assert_eq!(key, format!("00000000000000000000-{expected}"));
    let decoded = decode_reply_cursor(&key).unwrap();
    assert_eq!(decoded.import_order, Some(0));
    assert_eq!(decoded.created_at.timestamp_micros(), 0);
}
