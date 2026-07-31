use super::*;

#[test]
fn email_message_pagination_uses_rest_compatible_defaults() {
    assert_eq!(parse_email_message_pagination(None, None).unwrap(), (0, 5));
}

#[test]
fn email_message_pagination_accepts_valid_values() {
    assert_eq!(
        parse_email_message_pagination(Some(7), Some(20)).unwrap(),
        (7, 20)
    );
}

#[test]
fn email_message_pagination_rejects_invalid_values() {
    assert_eq!(
        parse_email_message_pagination(Some(-1), None)
            .unwrap_err()
            .message,
        "offset must be non-negative"
    );
    assert_eq!(
        parse_email_message_pagination(None, Some(0))
            .unwrap_err()
            .message,
        "limit must be positive"
    );
    assert_eq!(
        parse_email_message_pagination(None, Some(101))
            .unwrap_err()
            .message,
        "limit must not exceed 100"
    );
}
