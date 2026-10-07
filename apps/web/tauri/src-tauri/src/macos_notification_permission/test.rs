use super::*;

#[test]
fn an_unanswered_system_prompt_is_not_a_denial() {
    assert_eq!(
        permission_from_status(UNAuthorizationStatus::NotDetermined),
        NotificationPermission::Default
    );
}

#[test]
fn system_denial_and_unknown_statuses_do_not_grant_permission() {
    for status in [UNAuthorizationStatus::Denied, UNAuthorizationStatus(99)] {
        assert_eq!(
            permission_from_status(status),
            NotificationPermission::Denied
        );
    }
}

#[test]
fn authorized_and_limited_authorization_can_deliver_notifications() {
    for status in [
        UNAuthorizationStatus::Authorized,
        UNAuthorizationStatus::Provisional,
        UNAuthorizationStatus::Ephemeral,
    ] {
        assert_eq!(
            permission_from_status(status),
            NotificationPermission::Granted
        );
    }
}

#[test]
fn permission_values_match_the_frontend_notification_permission_contract() {
    for (permission, value) in [
        (NotificationPermission::Default, "default"),
        (NotificationPermission::Denied, "denied"),
        (NotificationPermission::Granted, "granted"),
    ] {
        assert_eq!(serde_json::to_value(permission).unwrap(), value);
    }
}

#[test]
fn native_authorization_errors_reach_the_frontend_with_their_details() {
    let error = NotificationPermissionError::Native {
        domain: "UNErrorDomain".into(),
        code: 1,
        description: "Notifications are not allowed".into(),
    };
    assert_eq!(
        serde_json::to_value(error).unwrap(),
        "macOS notification authorization failed (UNErrorDomain 1): Notifications are not allowed"
    );
}
