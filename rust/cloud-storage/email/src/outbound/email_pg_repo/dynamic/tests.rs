use super::*;
use item_filters::ast::email::{Email, EmailLiteral};
use macro_user_id::cowlike::CowLike;
use macro_user_id::email::EmailStr;
use uuid::Uuid;

#[test]
fn test_build_message_email_filter_sender_complete() {
    let email = Email::Complete(
        EmailStr::parse_from_str("test@example.com")
            .unwrap()
            .into_owned(),
    );
    let expr = Expr::Literal(EmailLiteral::Sender(email));
    let result = build_message_email_filter(&expr);

    assert!(result.contains("m.from_contact_id"));
    assert!(result.contains("LOWER(c.email_address) = LOWER('test@example.com')"));
}

#[test]
fn test_build_message_email_filter_sender_partial() {
    let email = Email::Partial("example".to_string());
    let expr = Expr::Literal(EmailLiteral::Sender(email));
    let result = build_message_email_filter(&expr);

    assert!(result.contains("m.from_contact_id"));
    assert!(result.contains("c.email_address ILIKE '%example%'"));
}

#[test]
fn test_build_message_email_filter_recipient() {
    let email = Email::Complete(
        EmailStr::parse_from_str("recipient@example.com")
            .unwrap()
            .into_owned(),
    );
    let expr = Expr::Literal(EmailLiteral::Recipient(email));
    let result = build_message_email_filter(&expr);

    assert!(result.contains("email_message_recipients"));
    assert!(result.contains("recipient_type = 'TO'"));
    assert!(result.contains("LOWER(c.email_address) = LOWER('recipient@example.com')"));
}

#[test]
fn test_build_message_email_filter_cc() {
    let email = Email::Complete(
        EmailStr::parse_from_str("cc@example.com")
            .unwrap()
            .into_owned(),
    );
    let expr = Expr::Literal(EmailLiteral::Cc(email));
    let result = build_message_email_filter(&expr);

    assert!(result.contains("recipient_type = 'CC'"));
}

#[test]
fn test_build_message_email_filter_bcc() {
    let email = Email::Complete(
        EmailStr::parse_from_str("bcc@example.com")
            .unwrap()
            .into_owned(),
    );
    let expr = Expr::Literal(EmailLiteral::Bcc(email));
    let result = build_message_email_filter(&expr);

    assert!(result.contains("recipient_type = 'BCC'"));
}

#[test]
fn test_build_message_email_filter_and() {
    let email1 = Email::Complete(
        EmailStr::parse_from_str("sender@example.com")
            .unwrap()
            .into_owned(),
    );
    let email2 = Email::Complete(
        EmailStr::parse_from_str("recipient@example.com")
            .unwrap()
            .into_owned(),
    );
    let expr = Expr::and(
        Expr::Literal(EmailLiteral::Sender(email1)),
        Expr::Literal(EmailLiteral::Recipient(email2)),
    );
    let result = build_message_email_filter(&expr);

    assert!(result.contains("AND"));
    assert!(result.contains("sender@example.com"));
    assert!(result.contains("recipient@example.com"));
}

#[test]
fn test_build_message_email_filter_or() {
    let email1 = Email::Complete(
        EmailStr::parse_from_str("sender1@example.com")
            .unwrap()
            .into_owned(),
    );
    let email2 = Email::Complete(
        EmailStr::parse_from_str("sender2@example.com")
            .unwrap()
            .into_owned(),
    );
    let expr = Expr::or(
        Expr::Literal(EmailLiteral::Sender(email1)),
        Expr::Literal(EmailLiteral::Sender(email2)),
    );
    let result = build_message_email_filter(&expr);

    assert!(result.contains("OR"));
    assert!(result.contains("sender1@example.com"));
    assert!(result.contains("sender2@example.com"));
}

#[test]
fn test_build_message_email_filter_not() {
    let email = Email::Complete(
        EmailStr::parse_from_str("blocked@example.com")
            .unwrap()
            .into_owned(),
    );
    let expr = Expr::is_not(Expr::Literal(EmailLiteral::Sender(email)));
    let result = build_message_email_filter(&expr);

    assert!(result.contains("NOT"));
    assert!(result.contains("blocked@example.com"));
}

#[test]
fn test_escape_like_pattern() {
    assert_eq!(escape_like_pattern("test"), "test");
    assert_eq!(escape_like_pattern("test%"), r"test\%");
    assert_eq!(escape_like_pattern("test_"), r"test\_");
    assert_eq!(escape_like_pattern(r"test\"), r"test\\");
    assert_eq!(escape_like_pattern(r"test\%_"), r"test\\\%\_");
}

#[test]
fn test_build_view_thread_filter_inbox() {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox);
    let result = build_view_thread_filter(&view);
    assert!(result.contains("inbox_visible = TRUE"));
    assert!(result.contains("latest_inbound_message_ts IS NOT NULL"));
}

#[test]
fn test_build_view_thread_filter_sent() {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Sent);
    let result = build_view_thread_filter(&view);
    assert!(result.contains("latest_outbound_message_ts IS NOT NULL"));
}

#[test]
fn test_build_view_message_filter_drafts() {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Drafts);
    let result = build_view_message_filter(&view, "$1");
    assert!(result.contains("is_draft = TRUE"));
}

#[test]
fn test_build_view_message_filter_starred() {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Starred);
    let result = build_view_message_filter(&view, "$1");
    assert!(result.contains("is_starred = TRUE"));
    assert!(result.contains("is_draft = FALSE"));
}

#[test]
fn test_build_view_message_filter_important() {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Important);
    let result = build_view_message_filter(&view, "$1");
    assert!(result.contains("IMPORTANT"));
    assert!(result.contains("EXISTS"));
}

#[test]
fn test_build_view_message_filter_user_label() {
    let view = PreviewView::UserLabel("MyLabel".to_string());
    let result = build_view_message_filter(&view, "$1");
    assert!(result.contains("MyLabel"));
    assert!(result.contains("EXISTS"));
}

#[test]
fn test_get_sort_timestamp_field_sent() {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Sent);
    let result = get_sort_timestamp_field(&view);
    assert_eq!(result, "t.latest_outbound_message_ts");
}

#[test]
fn test_get_sort_timestamp_field_inbox() {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox);
    let result = get_sort_timestamp_field(&view);
    assert_eq!(result, "t.latest_inbound_message_ts");
}

#[test]
fn test_get_sort_timestamp_field_default() {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let result = get_sort_timestamp_field(&view);
    assert_eq!(result, "t.latest_non_spam_message_ts");
}

#[test]
fn test_build_thread_email_filter_single_thread_id() {
    let id = Uuid::new_v4();
    let expr = Expr::Literal(EmailLiteral::ThreadId(id));
    let result = build_thread_email_filter(&expr);

    assert!(result.contains(&format!("t.id = '{id}'::uuid")));
}

#[test]
fn test_build_thread_email_filter_multiple_thread_ids() {
    let id1 = Uuid::new_v4();
    let id2 = Uuid::new_v4();
    let expr = Expr::or(
        Expr::Literal(EmailLiteral::ThreadId(id1)),
        Expr::Literal(EmailLiteral::ThreadId(id2)),
    );
    let result = build_thread_email_filter(&expr);

    assert!(result.contains(&format!("t.id = '{id1}'::uuid")));
    assert!(result.contains(&format!("t.id = '{id2}'::uuid")));
    assert!(result.contains("OR"));
}

#[test]
fn test_build_thread_email_filter_maps_sender_to_true() {
    let email = Email::Complete(
        EmailStr::parse_from_str("test@example.com")
            .unwrap()
            .into_owned(),
    );
    let expr = Expr::Literal(EmailLiteral::Sender(email));
    let result = build_thread_email_filter(&expr);

    assert!(result.contains("TRUE"));
    assert!(!result.contains("t.id"));
}

#[test]
fn test_build_message_email_filter_maps_thread_id_to_true() {
    let id = Uuid::new_v4();
    let expr = Expr::Literal(EmailLiteral::ThreadId(id));
    let result = build_message_email_filter(&expr);

    assert!(result.contains("TRUE"));
    assert!(!result.contains("t.id"));
}

#[test]
fn test_combined_thread_id_and_sender_splits_correctly() {
    let id = Uuid::new_v4();
    let email = Email::Complete(
        EmailStr::parse_from_str("sender@example.com")
            .unwrap()
            .into_owned(),
    );
    let expr = Expr::and(
        Expr::Literal(EmailLiteral::ThreadId(id)),
        Expr::Literal(EmailLiteral::Sender(email)),
    );

    let thread_result = build_thread_email_filter(&expr);
    assert!(thread_result.contains(&format!("t.id = '{id}'::uuid")));
    assert!(!thread_result.contains("from_contact_id"));

    let message_result = build_message_email_filter(&expr);
    assert!(message_result.contains("from_contact_id"));
    assert!(!message_result.contains(&format!("t.id = '{id}'")));
}

#[test]
fn test_has_thread_literals_true_when_thread_id_present() {
    let id = Uuid::new_v4();
    let expr = Expr::Literal(EmailLiteral::ThreadId(id));
    assert!(has_thread_literals(&expr));
}

#[test]
fn test_has_thread_literals_false_when_only_message_literals() {
    let email = Email::Complete(
        EmailStr::parse_from_str("test@example.com")
            .unwrap()
            .into_owned(),
    );
    let expr = Expr::Literal(EmailLiteral::Sender(email));
    assert!(!has_thread_literals(&expr));
}

#[test]
fn test_has_message_literals_true_when_sender_present() {
    let email = Email::Complete(
        EmailStr::parse_from_str("test@example.com")
            .unwrap()
            .into_owned(),
    );
    let expr = Expr::Literal(EmailLiteral::Sender(email));
    assert!(has_message_literals(&expr));
}

#[test]
fn test_has_message_literals_false_when_only_thread_id() {
    let id = Uuid::new_v4();
    let expr = Expr::Literal(EmailLiteral::ThreadId(id));
    assert!(!has_message_literals(&expr));
}

#[test]
fn test_has_both_literals_in_combined_ast() {
    let id = Uuid::new_v4();
    let email = Email::Complete(
        EmailStr::parse_from_str("test@example.com")
            .unwrap()
            .into_owned(),
    );
    let expr = Expr::and(
        Expr::Literal(EmailLiteral::ThreadId(id)),
        Expr::Literal(EmailLiteral::Sender(email)),
    );
    assert!(has_thread_literals(&expr));
    assert!(has_message_literals(&expr));
}
