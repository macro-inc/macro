use super::*;
use crate::domain::models::{PreviewView, PreviewViewStandardLabel};
use filter_ast::Expr;
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
    let debug = result.to_debug_sql();

    assert!(debug.contains("m.from_contact_id"));
    assert!(debug.contains("LOWER(c.email_address) = LOWER("));
    assert!(result.has_bind_string("test@example.com"));
    assert!(result.has_no_raw_containing("test@example.com"));
}

#[test]
fn test_build_message_email_filter_sender_partial() {
    let email = Email::Partial("example".to_string());
    let expr = Expr::Literal(EmailLiteral::Sender(email));
    let result = build_message_email_filter(&expr);
    let debug = result.to_debug_sql();

    assert!(debug.contains("m.from_contact_id"));
    assert!(debug.contains("ILIKE"));
    assert!(result.has_bind_string("%example%"));
    assert!(result.has_no_raw_containing("example"));
}

#[test]
fn test_build_message_email_filter_importance_true_includes_drafts() {
    let expr = Expr::Literal(EmailLiteral::Importance(true));
    let result = build_message_email_filter(&expr);
    let debug = result.to_debug_sql();

    assert!(debug.contains("m.is_draft = TRUE"));
}

#[test]
fn test_build_message_email_filter_importance_true_excludes_trash() {
    let expr = Expr::Literal(EmailLiteral::Importance(true));
    let result = build_message_email_filter(&expr);
    let debug = result.to_debug_sql();

    assert!(debug.contains("l.name = 'TRASH'"));
    assert!(debug.contains("NOT EXISTS"));
}

#[test]
fn test_build_message_email_filter_importance_true_includes_email_filters() {
    let expr = Expr::Literal(EmailLiteral::Importance(true));
    let result = build_message_email_filter(&expr);
    let debug = result.to_debug_sql();

    assert!(debug.contains("FROM email_filters ef"));
    assert!(
        debug
            .contains("LOWER(ef.email_domain) = LOWER(split_part(sender_c.email_address, '@', 2))")
    );
    assert!(debug.contains("ef.is_important = TRUE"));
    assert!(debug.contains("ef_addr.is_important = FALSE"));
}

#[test]
fn test_build_message_email_filter_importance_false_includes_email_filters() {
    let expr = Expr::Literal(EmailLiteral::Importance(false));
    let result = build_message_email_filter(&expr);
    let debug = result.to_debug_sql();

    assert!(debug.contains("FROM email_filters ef"));
    assert!(debug.contains("LOWER(ef.email_address) = LOWER(sender_c.email_address)"));
    assert!(debug.contains("ef.is_important = FALSE"));
    assert!(debug.contains("ef_addr.is_important = TRUE"));
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
    let debug = result.to_debug_sql();

    assert!(debug.contains("email_message_recipients"));
    assert!(debug.contains("recipient_type = 'TO'"));
    assert!(result.has_bind_string("recipient@example.com"));
    assert!(result.has_no_raw_containing("recipient@example.com"));
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
    let debug = result.to_debug_sql();

    assert!(debug.contains("recipient_type = 'CC'"));
    assert!(result.has_bind_string("cc@example.com"));
    assert!(result.has_no_raw_containing("cc@example.com"));
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
    let debug = result.to_debug_sql();

    assert!(debug.contains("recipient_type = 'BCC'"));
    assert!(result.has_bind_string("bcc@example.com"));
    assert!(result.has_no_raw_containing("bcc@example.com"));
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
    let debug = result.to_debug_sql();

    assert!(debug.contains("AND"));
    assert!(result.has_bind_string("sender@example.com"));
    assert!(result.has_bind_string("recipient@example.com"));
    assert!(result.has_no_raw_containing("sender@example.com"));
    assert!(result.has_no_raw_containing("recipient@example.com"));
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
    let debug = result.to_debug_sql();

    assert!(debug.contains("OR"));
    assert!(result.has_bind_string("sender1@example.com"));
    assert!(result.has_bind_string("sender2@example.com"));
    assert!(result.has_no_raw_containing("sender1@example.com"));
    assert!(result.has_no_raw_containing("sender2@example.com"));
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
    let debug = result.to_debug_sql();

    assert!(debug.contains("NOT"));
    assert!(result.has_bind_string("blocked@example.com"));
    assert!(result.has_no_raw_containing("blocked@example.com"));
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
    let debug = result.to_debug_sql();
    assert!(debug.contains("inbox_visible = TRUE"));
    assert!(debug.contains("latest_inbound_message_ts IS NOT NULL"));
}

#[test]
fn test_build_view_thread_filter_sent() {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Sent);
    let result = build_view_thread_filter(&view);
    let debug = result.to_debug_sql();
    assert!(debug.contains("latest_outbound_message_ts IS NOT NULL"));
}

#[test]
fn test_build_view_message_filter_drafts() {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Drafts);
    let result = build_view_message_filter(&view);
    let debug = result.to_debug_sql();
    assert!(debug.contains("is_draft = TRUE"));
}

#[test]
fn test_build_view_message_filter_starred() {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Starred);
    let result = build_view_message_filter(&view);
    let debug = result.to_debug_sql();
    assert!(debug.contains("is_starred = TRUE"));
    assert!(debug.contains("is_draft = FALSE"));
}

#[test]
fn test_build_view_message_filter_important() {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Important);
    let result = build_view_message_filter(&view);
    let debug = result.to_debug_sql();
    assert!(debug.contains("IMPORTANT"));
    assert!(debug.contains("m.is_draft = TRUE"));
    assert!(debug.contains("EXISTS"));
}

#[test]
fn test_build_view_message_filter_user_label() {
    let view = PreviewView::UserLabel("MyLabel".to_string());
    let result = build_view_message_filter(&view);
    let debug = result.to_debug_sql();
    assert!(debug.contains("EXISTS"));
    assert!(result.has_bind_string("MyLabel"));
    assert!(result.has_no_raw_containing("MyLabel"));
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
    assert_eq!(
        result,
        "COALESCE(t.latest_non_spam_message_ts, t.updated_at)"
    );
}

#[test]
fn test_build_query_shared_include_uses_union_instead_of_or() {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox);
    let expr = Expr::Literal(EmailLiteral::Shared(
        item_filters::SharedEmailFilter::Include,
    ));
    let sql = super::query::debug_build_query_sql(&view, &expr);

    assert!(sql.contains("UNION"));
    assert!(sql.contains("t.id IN (SELECT thread_id FROM SharedEmailThreads)"));
    assert!(!sql.contains(" OR t.id IN (SELECT thread_id FROM SharedEmailThreads)"));
}

#[test]
fn test_build_query_projects_real_updated_at_for_candidate_threads() {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let expr = Expr::Literal(EmailLiteral::Shared(
        item_filters::SharedEmailFilter::Include,
    ));
    let sql = super::query::debug_build_query_sql(&view, &expr);

    assert!(sql.contains("t.updated_at AS updated_at"));
    assert!(!sql.contains("COALESCE(t.latest_non_spam_message_ts, t.updated_at) AS updated_at"));
}

#[test]
fn test_build_query_orders_by_id_to_match_cursor_tiebreak() {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let expr = Expr::Literal(EmailLiteral::Shared(
        item_filters::SharedEmailFilter::Include,
    ));
    let sql = super::query::debug_build_query_sql(&view, &expr);

    assert!(sql.contains("ORDER BY effective_ts DESC, id DESC"));
    assert!(sql.contains("ORDER BY t.effective_ts DESC, t.id DESC"));
    assert!(!sql.contains("ORDER BY effective_ts DESC, updated_at DESC"));
    assert!(!sql.contains("ORDER BY t.effective_ts DESC, t.updated_at DESC"));
}

#[test]
fn test_build_thread_email_filter_single_thread_id() {
    let id = Uuid::new_v4();
    let expr = Expr::Literal(EmailLiteral::ThreadId(id));
    let result = build_thread_email_filter(&expr);
    let debug = result.to_debug_sql();

    assert!(debug.contains("t.id = "));
    assert!(result.has_bind_uuid(&id));
    assert!(result.has_no_raw_containing(&id.to_string()));
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
    let debug = result.to_debug_sql();

    assert!(result.has_bind_uuid(&id1));
    assert!(result.has_bind_uuid(&id2));
    assert!(debug.contains("OR"));
    assert!(result.has_no_raw_containing(&id1.to_string()));
    assert!(result.has_no_raw_containing(&id2.to_string()));
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
    let debug = result.to_debug_sql();

    assert!(debug.contains("TRUE"));
    assert!(!debug.contains("t.id"));
}

#[test]
fn test_build_message_email_filter_maps_thread_id_to_true() {
    let id = Uuid::new_v4();
    let expr = Expr::Literal(EmailLiteral::ThreadId(id));
    let result = build_message_email_filter(&expr);
    let debug = result.to_debug_sql();

    assert!(debug.contains("TRUE"));
    assert!(!debug.contains("t.id"));
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
    let thread_debug = thread_result.to_debug_sql();
    assert!(thread_result.has_bind_uuid(&id));
    assert!(!thread_debug.contains("from_contact_id"));

    let message_result = build_message_email_filter(&expr);
    let message_debug = message_result.to_debug_sql();
    assert!(message_debug.contains("from_contact_id"));
    assert!(message_result.has_bind_string("sender@example.com"));
    assert!(!message_result.has_bind_uuid(&id));
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

#[test]
fn test_build_thread_email_filter_single_project_id() {
    let expr = Expr::Literal(EmailLiteral::ProjectId("project-123".to_string()));
    let result = build_thread_email_filter(&expr);
    let debug = result.to_debug_sql();

    assert!(debug.contains("t.project_id = "));
    assert!(result.has_bind_string("project-123"));
    assert!(result.has_no_raw_containing("project-123"));
}

#[test]
fn test_build_thread_email_filter_multiple_project_ids() {
    let expr = Expr::or(
        Expr::Literal(EmailLiteral::ProjectId("project-1".to_string())),
        Expr::Literal(EmailLiteral::ProjectId("project-2".to_string())),
    );
    let result = build_thread_email_filter(&expr);
    let debug = result.to_debug_sql();

    assert!(debug.contains("OR"));
    assert!(result.has_bind_string("project-1"));
    assert!(result.has_bind_string("project-2"));
    assert!(result.has_no_raw_containing("project-1"));
    assert!(result.has_no_raw_containing("project-2"));
}

#[test]
fn test_build_message_email_filter_maps_project_id_to_true() {
    let expr = Expr::Literal(EmailLiteral::ProjectId("project-123".to_string()));
    let result = build_message_email_filter(&expr);
    let debug = result.to_debug_sql();

    assert!(debug.contains("TRUE"));
    assert!(!debug.contains("project_id"));
}

#[test]
fn test_has_thread_literals_true_when_project_id_present() {
    let expr = Expr::Literal(EmailLiteral::ProjectId("project-123".to_string()));
    assert!(has_thread_literals(&expr));
}

#[test]
fn test_has_message_literals_false_when_only_project_id() {
    let expr = Expr::Literal(EmailLiteral::ProjectId("project-123".to_string()));
    assert!(!has_message_literals(&expr));
}

#[test]
fn test_combined_project_id_and_sender_splits_correctly() {
    let email = Email::Complete(
        EmailStr::parse_from_str("sender@example.com")
            .unwrap()
            .into_owned(),
    );
    let expr = Expr::and(
        Expr::Literal(EmailLiteral::ProjectId("project-123".to_string())),
        Expr::Literal(EmailLiteral::Sender(email)),
    );

    let thread_result = build_thread_email_filter(&expr);
    let thread_debug = thread_result.to_debug_sql();
    assert!(thread_debug.contains("t.project_id = "));
    assert!(thread_result.has_bind_string("project-123"));
    assert!(!thread_debug.contains("from_contact_id"));

    let message_result = build_message_email_filter(&expr);
    let message_debug = message_result.to_debug_sql();
    assert!(message_debug.contains("from_contact_id"));
    assert!(message_result.has_bind_string("sender@example.com"));
    assert!(!message_result.has_bind_string("project-123"));
}

#[test]
fn test_sql_injection_project_id_not_in_raw_sql() {
    let expr = Expr::Literal(EmailLiteral::ProjectId("'; DROP TABLE--".to_string()));
    let result = build_thread_email_filter(&expr);

    assert!(result.has_bind_string("'; DROP TABLE--"));
    assert!(result.has_no_raw_containing("DROP"));
    assert!(result.has_no_raw_containing("';"));
}

#[test]
fn test_sql_injection_email_not_in_raw_sql() {
    let malicious = Email::Complete(EmailStr::parse_from_str("evil@x.com").unwrap().into_owned());
    let expr = Expr::Literal(EmailLiteral::Sender(malicious));
    let result = build_message_email_filter(&expr);

    assert!(result.has_bind_string("evil@x.com"));
    assert!(result.has_no_raw_containing("evil@x.com"));
}

#[test]
fn test_sql_injection_partial_email_not_in_raw_sql() {
    let expr = Expr::Literal(EmailLiteral::Sender(Email::Partial(
        "'; DROP TABLE--".to_string(),
    )));
    let result = build_message_email_filter(&expr);

    assert!(result.has_no_raw_containing("DROP"));
    assert!(result.has_no_raw_containing("';"));
}

#[test]
fn test_sql_injection_user_label_not_in_raw_sql() {
    let view = PreviewView::UserLabel("'; DROP TABLE--".to_string());
    let result = build_view_message_filter(&view);

    assert!(result.has_no_raw_containing("DROP"));
    assert!(result.has_no_raw_containing("';"));
    assert!(result.has_bind_string("'; DROP TABLE--"));
}

#[test]
fn test_sql_injection_thread_id_not_in_raw_sql() {
    let id = Uuid::new_v4();
    let expr = Expr::Literal(EmailLiteral::ThreadId(id));
    let result = build_thread_email_filter(&expr);

    assert!(result.has_bind_uuid(&id));
    assert!(result.has_no_raw_containing(&id.to_string()));
}

#[test]
fn test_build_thread_email_filter_calendar_only_true_emits_ics_exists() {
    let expr = Expr::Literal(EmailLiteral::CalendarOnly(true));
    let result = build_thread_email_filter(&expr);
    let debug = result.to_debug_sql();

    assert!(debug.contains("EXISTS"));
    assert!(debug.contains("email_attachments"));
    assert!(debug.contains("m_cal.thread_id = t.id"));
    assert!(debug.contains("a_cal.filename ILIKE '%.ics'"));
    assert!(debug.contains("a_cal.mime_type = 'text/calendar'"));
    assert!(debug.contains("a_cal.mime_type = 'application/ics'"));
}

#[test]
fn test_build_thread_email_filter_calendar_only_false_maps_to_true() {
    let expr = Expr::Literal(EmailLiteral::CalendarOnly(false));
    let result = build_thread_email_filter(&expr);
    let debug = result.to_debug_sql();

    assert!(debug.contains("TRUE"));
    assert!(!debug.contains("email_attachments"));
}

#[test]
fn test_build_message_email_filter_maps_calendar_only_to_true() {
    let expr = Expr::Literal(EmailLiteral::CalendarOnly(true));
    let result = build_message_email_filter(&expr);
    let debug = result.to_debug_sql();

    assert!(debug.contains("TRUE"));
    assert!(!debug.contains("email_attachments"));
}

#[test]
fn test_has_thread_literals_true_when_calendar_only_present() {
    let expr = Expr::Literal(EmailLiteral::CalendarOnly(true));
    assert!(has_thread_literals(&expr));
}

#[test]
fn test_has_message_literals_false_when_only_calendar_only() {
    let expr = Expr::Literal(EmailLiteral::CalendarOnly(true));
    assert!(!has_message_literals(&expr));
}
