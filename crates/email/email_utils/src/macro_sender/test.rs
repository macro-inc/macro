use super::is_macro_notification_sender;

#[test]
fn matches_every_environment_prefix() {
    assert!(is_macro_notification_sender(
        "no-reply@notification.macro.com"
    ));
    assert!(is_macro_notification_sender(
        "no-reply-dev@notification.macro.com"
    ));
    assert!(is_macro_notification_sender(
        "no-reply-local@notification.macro.com"
    ));
}

#[test]
fn is_case_and_whitespace_insensitive() {
    assert!(is_macro_notification_sender(
        "No-Reply@Notification.Macro.COM"
    ));
    assert!(is_macro_notification_sender(
        "  no-reply@notification.macro.com\n"
    ));
}

#[test]
fn rejects_other_macro_and_lookalike_domains() {
    assert!(!is_macro_notification_sender("teo@macro.com"));
    assert!(!is_macro_notification_sender("no-reply@macro.com"));
    assert!(!is_macro_notification_sender(
        "no-reply@sub.notification.macro.com"
    ));
    assert!(!is_macro_notification_sender(
        "no-reply@notification.macro.com.evil.example"
    ));
    assert!(!is_macro_notification_sender(
        "no-reply@notification-macro.com"
    ));
    assert!(!is_macro_notification_sender("notification.macro.com"));
    assert!(!is_macro_notification_sender(""));
}
