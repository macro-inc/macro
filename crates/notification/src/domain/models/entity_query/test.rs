use super::*;

#[test]
fn default_is_active_and_bounded_and_explicit_limits_are_validated() {
    let default = EntityNotificationQuery::default();
    assert_eq!(default.states, NotificationState::ACTIVE);
    assert_eq!(default.limit, 20);
    assert!(!default.channel_feed_only);
    assert!(default.validate().is_ok());
    for limit in [0, 501, u32::MAX] {
        assert!(
            EntityNotificationQuery {
                limit,
                ..default.clone()
            }
            .validate()
            .is_err()
        );
    }
    for limit in [1, 500] {
        assert!(
            EntityNotificationQuery {
                limit,
                ..default.clone()
            }
            .validate()
            .is_ok()
        );
    }
}
