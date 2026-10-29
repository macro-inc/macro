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
    let request = notification_request(
        &notification_content(
            "Macro — new message",
            None,
            Some("Hello 👋\nSecond line"),
            None,
        ),
        None,
    );
    assert_eq!(request.content().title().to_string(), "Macro — new message");
    assert_eq!(
        request.content().body().to_string(),
        "Hello 👋\nSecond line"
    );
    assert!(request.trigger().is_none());

    let title_only =
        notification_request(&notification_content("Reminder", None, None, None), None);
    assert_eq!(title_only.content().title().to_string(), "Reminder");
    assert!(title_only.content().body().is_empty());
}

#[test]
fn conversation_notifications_name_and_stack_their_conversation() {
    let request = notification_request(
        &notification_content("Ada", Some("design"), Some("Ship it"), Some("channel-1")),
        None,
    );
    assert_eq!(request.content().subtitle().to_string(), "design");
    assert_eq!(
        request.content().threadIdentifier().to_string(),
        "channel-1"
    );
    assert!(request.content().sound().is_some());

    let direct = notification_request(&notification_content("Ada", None, None, None), None);
    assert!(direct.content().subtitle().is_empty());
    assert!(direct.content().threadIdentifier().is_empty());
}

#[test]
fn repeated_notifications_do_not_replace_each_other() {
    let first = notification_request(&notification_content("Same title", None, None, None), None);
    let second = notification_request(&notification_content("Same title", None, None, None), None);
    assert_ne!(first.identifier(), second.identifier());
    assert!(Uuid::parse_str(&first.identifier().to_string()).is_ok());
}

#[test]
fn delivered_notifications_keep_their_destination_without_webview_callbacks() {
    let request = notification_request(
        &notification_content("Message", None, None, None),
        Some("first-notification"),
    );
    let second = notification_request(
        &notification_content("Message", None, None, None),
        Some("second-notification"),
    );
    let repeated = notification_request(
        &notification_content("Message", None, None, None),
        Some("first-notification"),
    );
    assert_ne!(request.identifier(), repeated.identifier());
    for (request, expected) in [
        (request, "first-notification"),
        (second, "second-notification"),
    ] {
        let url = activation::notification_url(&request.identifier().to_string())
            .expect("delivered notification has a navigation destination");
        assert_eq!(url.path(), "/notification");
        assert!(
            url.query_pairs()
                .any(|(key, value)| key == "notificationId" && value == expected)
        );
    }
}

#[test]
fn legacy_and_unrelated_notification_identifiers_cannot_route() {
    for identifier in [
        "legacy-delivery-id",
        "macro:///notification?notificationId=",
        "macro:///notification?deliveryId=123",
        "macro:///task/123?notificationId=123",
        "https://example.com/notification?notificationId=123",
        "macro://external/notification?notificationId=123",
    ] {
        assert!(activation::notification_url(identifier).is_none());
    }
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
