use super::*;

#[test]
fn default_is_active_and_unlimited_but_explicit_limits_are_bounded() {
    let default = EntityNotificationQuery::default();
    assert_eq!(default.states, NotificationState::ACTIVE);
    assert_eq!(default.limit, None);
    assert!(default.validate().is_ok());
    for limit in [0, 501, u32::MAX] {
        assert!(
            EntityNotificationQuery {
                limit: Some(limit),
                ..default.clone()
            }
            .validate()
            .is_err()
        );
    }
    for limit in [1, 500] {
        assert!(
            EntityNotificationQuery {
                limit: Some(limit),
                ..default.clone()
            }
            .validate()
            .is_ok()
        );
    }
}
