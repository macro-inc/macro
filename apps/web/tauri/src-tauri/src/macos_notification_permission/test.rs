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
    let error = NotificationError::Native {
        operation: NotificationOperation::Authorization,
        domain: "UNErrorDomain".into(),
        code: 1,
        description: "Notifications are not allowed".into(),
    };
    assert_eq!(
        serde_json::to_value(error).unwrap(),
        "macOS notification authorization failed (UNErrorDomain 1): Notifications are not allowed"
    );
}

#[test]
fn immediate_notifications_preserve_the_title_and_optional_body() {
    let request = notification_request("Macro — new message", Some("Hello 👋\nSecond line"));
    assert_eq!(request.content().title().to_string(), "Macro — new message");
    assert_eq!(
        request.content().body().to_string(),
        "Hello 👋\nSecond line"
    );
    assert!(request.trigger().is_none());

    let title_only = notification_request("Reminder", None);
    assert_eq!(title_only.content().title().to_string(), "Reminder");
    assert!(title_only.content().body().is_empty());
}

#[test]
fn repeated_notifications_do_not_replace_each_other() {
    let first = notification_request("Same title", None);
    let second = notification_request("Same title", None);
    assert_ne!(first.identifier(), second.identifier());
    assert!(Uuid::parse_str(&first.identifier().to_string()).is_ok());
}

#[test]
fn native_delivery_errors_reach_the_frontend_with_their_details() {
    // SAFETY: no user-info dictionary is supplied, so its generic types cannot
    // mismatch the native values.
    let error = unsafe {
        NSError::errorWithDomain_code_userInfo(&NSString::from_str("UNErrorDomain"), 1, None)
    };
    let result = native_error(NotificationOperation::Delivery, &error);
    assert_eq!(
        serde_json::to_value(result).unwrap(),
        format!(
            "macOS notification delivery failed (UNErrorDomain 1): {}",
            error.localizedDescription()
        )
    );
}
