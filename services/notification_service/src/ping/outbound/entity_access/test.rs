use entity_access::domain::models::AccessError;

use super::can_view_from;

#[test]
fn a_malformed_or_missing_link_is_one_the_user_cannot_see() {
    assert!(!can_view_from(Err(AccessError::BadRequest("invalid entity id"))).unwrap());
    assert!(!can_view_from(Err(AccessError::NotFound("chat"))).unwrap());
    assert!(!can_view_from(Err(AccessError::Unauthorized)).unwrap());
    assert!(can_view_from(Ok(true)).unwrap());
    assert!(!can_view_from(Ok(false)).unwrap());
}

#[test]
fn a_failed_access_check_is_an_error() {
    assert!(can_view_from(Err(AccessError::internal("database down"))).is_err());
}
