use super::resolve::{
    ResolvedFilters, can_short_circuit, collect_complete_emails, fold_unresolved,
};
use super::*;
use crate::domain::models::{PreviewView, PreviewViewStandardLabel};
use filter_ast::Expr;
use item_filters::ast::email::{Email, EmailLiteral};
use macro_user_id::cowlike::CowLike;
use macro_user_id::email::EmailStr;
use uuid::Uuid;

fn complete(s: &str) -> Email {
    Email::Complete(EmailStr::parse_from_str(s).unwrap().into_owned())
}

/// A `ResolvedFilters` that has resolved every Complete email referenced
/// here. Lets tests exercise the fast (`m.from_contact_id = $uuid`) path
/// without spinning up a DB.
fn resolved_with(emails: &[(&str, Uuid)]) -> ResolvedFilters {
    let mut r = ResolvedFilters::empty().with_trash(Uuid::new_v4());
    for (e, id) in emails {
        r = r.with_contact(e.to_lowercase(), *id);
    }
    r
}

/// `ResolvedFilters` populated only with the listed emails (no trash
/// label). Used by the `resolve::*` constant-folding tests where we only
/// care which Complete emails resolve.
fn resolved_with_random_ids(emails: &[&str]) -> ResolvedFilters {
    let mut r = ResolvedFilters::empty();
    for e in emails {
        r = r.with_contact(e.to_lowercase(), Uuid::new_v4());
    }
    r
}

#[test]
fn unresolved_sender_short_circuits() {
    let expr = Expr::Literal(EmailLiteral::Sender(complete("missing@x.com")));
    let r = resolved_with_random_ids(&[]);
    assert!(can_short_circuit(&expr, &r));
}

#[test]
fn resolved_sender_does_not_short_circuit() {
    let expr = Expr::Literal(EmailLiteral::Sender(complete("known@x.com")));
    let r = resolved_with_random_ids(&["known@x.com"]);
    assert!(!can_short_circuit(&expr, &r));
}

#[test]
fn unresolved_under_not_does_not_short_circuit() {
    let expr = Expr::is_not(Expr::Literal(EmailLiteral::Sender(complete(
        "missing@x.com",
    ))));
    let r = resolved_with_random_ids(&[]);
    assert!(!can_short_circuit(&expr, &r));
}

#[test]
fn or_with_one_unresolved_does_not_short_circuit() {
    let expr = Expr::or(
        Expr::Literal(EmailLiteral::Sender(complete("missing@x.com"))),
        Expr::Literal(EmailLiteral::Sender(complete("known@x.com"))),
    );
    let r = resolved_with_random_ids(&["known@x.com"]);
    assert!(!can_short_circuit(&expr, &r));
}

#[test]
fn and_with_one_unresolved_short_circuits() {
    let expr = Expr::and(
        Expr::Literal(EmailLiteral::Sender(complete("missing@x.com"))),
        Expr::Literal(EmailLiteral::Sender(complete("known@x.com"))),
    );
    let r = resolved_with_random_ids(&["known@x.com"]);
    assert!(can_short_circuit(&expr, &r));
}

#[test]
fn collect_dedups_case_insensitively() {
    let expr = Expr::or(
        Expr::Literal(EmailLiteral::Sender(complete("Foo@X.com"))),
        Expr::Literal(EmailLiteral::Recipient(complete("foo@x.com"))),
    );
    let collected = collect_complete_emails(&expr);
    assert_eq!(collected, vec!["foo@x.com"]);
}

#[test]
fn partial_emails_are_never_constant() {
    let expr = Expr::Literal(EmailLiteral::Sender(Email::Partial("foo".to_string())));
    let r = ResolvedFilters::empty();
    assert!(!can_short_circuit(&expr, &r));
    assert_eq!(fold_unresolved(&expr, &r), None);
}

#[test]
fn test_build_message_email_filter_sender_complete_resolved_emits_contact_id() {
    let id = Uuid::new_v4();
    let expr = Expr::Literal(EmailLiteral::Sender(complete("test@example.com")));
    let resolved = resolved_with(&[("test@example.com", id)]);
    let result = build_message_email_filter(&expr, &resolved);
    let debug = result.to_debug_sql();

    assert!(debug.contains("m.from_contact_id = "));
    // No LOWER/email_contacts join when we have a resolved contact id.
    assert!(!debug.contains("LOWER(c.email_address)"));
    assert!(!debug.contains("FROM email_contacts"));
    assert!(result.has_bind_uuid(&id));
    // The email address itself never appears in the SQL — only the uuid.
    assert!(result.has_no_raw_containing("test@example.com"));
}

#[test]
fn test_build_message_email_filter_sender_complete_unresolved_emits_false() {
    let expr = Expr::Literal(EmailLiteral::Sender(complete("missing@example.com")));
    let result = build_message_email_filter(&expr, &ResolvedFilters::empty());
    let debug = result.to_debug_sql();

    assert!(debug.contains("FALSE"));
    assert!(result.has_no_raw_containing("missing@example.com"));
}

#[test]
fn test_build_message_email_filter_sender_partial() {
    let email = Email::Partial("example".to_string());
    let expr = Expr::Literal(EmailLiteral::Sender(email));
    let result = build_message_email_filter(&expr, &ResolvedFilters::empty());
    let debug = result.to_debug_sql();

    assert!(debug.contains("m.from_contact_id"));
    assert!(debug.contains("ILIKE"));
    assert!(result.has_bind_string("%example%"));
    assert!(result.has_no_raw_containing("example"));
}

#[test]
fn test_build_message_email_filter_importance_true_includes_drafts() {
    let expr = Expr::Literal(EmailLiteral::Importance(true));
    let result = build_message_email_filter(&expr, &ResolvedFilters::empty());
    let debug = result.to_debug_sql();

    assert!(debug.contains("m.is_draft = TRUE"));
}

#[test]
fn test_build_message_email_filter_importance_true_excludes_trash() {
    let expr = Expr::Literal(EmailLiteral::Importance(true));
    let result = build_message_email_filter(&expr, &ResolvedFilters::empty());
    let debug = result.to_debug_sql();

    assert!(debug.contains("l.name = 'TRASH'"));
    assert!(debug.contains("NOT EXISTS"));
}

#[test]
fn test_build_message_email_filter_importance_true_includes_email_filters() {
    let expr = Expr::Literal(EmailLiteral::Importance(true));
    let result = build_message_email_filter(&expr, &ResolvedFilters::empty());
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
    let result = build_message_email_filter(&expr, &ResolvedFilters::empty());
    let debug = result.to_debug_sql();

    assert!(debug.contains("FROM email_filters ef"));
    assert!(debug.contains("LOWER(ef.email_address) = LOWER(sender_c.email_address)"));
    assert!(debug.contains("ef.is_important = FALSE"));
    assert!(debug.contains("ef_addr.is_important = TRUE"));
}

#[test]
fn test_build_message_email_filter_recipient_resolved() {
    let id = Uuid::new_v4();
    let expr = Expr::Literal(EmailLiteral::Recipient(complete("recipient@example.com")));
    let resolved = resolved_with(&[("recipient@example.com", id)]);
    let result = build_message_email_filter(&expr, &resolved);
    let debug = result.to_debug_sql();

    assert!(debug.contains("email_message_recipients"));
    assert!(debug.contains("recipient_type = 'TO'"));
    assert!(debug.contains("mr.contact_id = "));
    // No email_contacts join: we already resolved the contact id.
    assert!(!debug.contains("JOIN email_contacts"));
    assert!(result.has_bind_uuid(&id));
    assert!(result.has_no_raw_containing("recipient@example.com"));
}

#[test]
fn test_build_message_email_filter_cc_resolved() {
    let id = Uuid::new_v4();
    let expr = Expr::Literal(EmailLiteral::Cc(complete("cc@example.com")));
    let resolved = resolved_with(&[("cc@example.com", id)]);
    let result = build_message_email_filter(&expr, &resolved);
    let debug = result.to_debug_sql();

    assert!(debug.contains("recipient_type = 'CC'"));
    assert!(debug.contains("mr.contact_id = "));
    assert!(result.has_bind_uuid(&id));
    assert!(result.has_no_raw_containing("cc@example.com"));
}

#[test]
fn test_build_message_email_filter_bcc_resolved() {
    let id = Uuid::new_v4();
    let expr = Expr::Literal(EmailLiteral::Bcc(complete("bcc@example.com")));
    let resolved = resolved_with(&[("bcc@example.com", id)]);
    let result = build_message_email_filter(&expr, &resolved);
    let debug = result.to_debug_sql();

    assert!(debug.contains("recipient_type = 'BCC'"));
    assert!(debug.contains("mr.contact_id = "));
    assert!(result.has_bind_uuid(&id));
    assert!(result.has_no_raw_containing("bcc@example.com"));
}

#[test]
fn test_build_message_email_filter_and() {
    let id1 = Uuid::new_v4();
    let id2 = Uuid::new_v4();
    let expr = Expr::and(
        Expr::Literal(EmailLiteral::Sender(complete("sender@example.com"))),
        Expr::Literal(EmailLiteral::Recipient(complete("recipient@example.com"))),
    );
    let resolved = resolved_with(&[("sender@example.com", id1), ("recipient@example.com", id2)]);
    let result = build_message_email_filter(&expr, &resolved);
    let debug = result.to_debug_sql();

    assert!(debug.contains("AND"));
    assert!(result.has_bind_uuid(&id1));
    assert!(result.has_bind_uuid(&id2));
    assert!(result.has_no_raw_containing("sender@example.com"));
    assert!(result.has_no_raw_containing("recipient@example.com"));
}

#[test]
fn test_build_message_email_filter_or() {
    let id1 = Uuid::new_v4();
    let id2 = Uuid::new_v4();
    let expr = Expr::or(
        Expr::Literal(EmailLiteral::Sender(complete("sender1@example.com"))),
        Expr::Literal(EmailLiteral::Sender(complete("sender2@example.com"))),
    );
    let resolved = resolved_with(&[("sender1@example.com", id1), ("sender2@example.com", id2)]);
    let result = build_message_email_filter(&expr, &resolved);
    let debug = result.to_debug_sql();

    assert!(debug.contains("OR"));
    assert!(result.has_bind_uuid(&id1));
    assert!(result.has_bind_uuid(&id2));
    assert!(result.has_no_raw_containing("sender1@example.com"));
    assert!(result.has_no_raw_containing("sender2@example.com"));
}

#[test]
fn test_build_message_email_filter_not() {
    let id = Uuid::new_v4();
    let expr = Expr::is_not(Expr::Literal(EmailLiteral::Sender(complete(
        "blocked@example.com",
    ))));
    let resolved = resolved_with(&[("blocked@example.com", id)]);
    let result = build_message_email_filter(&expr, &resolved);
    let debug = result.to_debug_sql();

    assert!(debug.contains("NOT"));
    assert!(result.has_bind_uuid(&id));
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

const DEFAULT_SORT_TS: &str = "t.updated_at";

#[test]
fn test_build_thread_email_filter_single_thread_id() {
    let id = Uuid::new_v4();
    let expr = Expr::Literal(EmailLiteral::ThreadId(id));
    let result = build_thread_email_filter(&expr, DEFAULT_SORT_TS);
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
    let result = build_thread_email_filter(&expr, DEFAULT_SORT_TS);
    let debug = result.to_debug_sql();

    assert!(result.has_bind_uuid(&id1));
    assert!(result.has_bind_uuid(&id2));
    assert!(debug.contains("OR"));
    assert!(result.has_no_raw_containing(&id1.to_string()));
    assert!(result.has_no_raw_containing(&id2.to_string()));
}

#[test]
fn test_build_thread_email_filter_maps_sender_to_true() {
    let expr = Expr::Literal(EmailLiteral::Sender(complete("test@example.com")));
    let result = build_thread_email_filter(&expr, DEFAULT_SORT_TS);
    let debug = result.to_debug_sql();

    assert!(debug.contains("TRUE"));
    assert!(!debug.contains("t.id"));
}

#[test]
fn test_build_message_email_filter_maps_thread_id_to_true() {
    let id = Uuid::new_v4();
    let expr = Expr::Literal(EmailLiteral::ThreadId(id));
    let result = build_message_email_filter(&expr, &ResolvedFilters::empty());
    let debug = result.to_debug_sql();

    assert!(debug.contains("TRUE"));
    assert!(!debug.contains("t.id"));
}

#[test]
fn test_combined_thread_id_and_sender_splits_correctly() {
    let id = Uuid::new_v4();
    let contact_id = Uuid::new_v4();
    let expr = Expr::and(
        Expr::Literal(EmailLiteral::ThreadId(id)),
        Expr::Literal(EmailLiteral::Sender(complete("sender@example.com"))),
    );

    let thread_result = build_thread_email_filter(&expr, DEFAULT_SORT_TS);
    let thread_debug = thread_result.to_debug_sql();
    assert!(thread_result.has_bind_uuid(&id));
    assert!(!thread_debug.contains("from_contact_id"));

    let resolved = resolved_with(&[("sender@example.com", contact_id)]);
    let message_result = build_message_email_filter(&expr, &resolved);
    let message_debug = message_result.to_debug_sql();
    assert!(message_debug.contains("from_contact_id"));
    assert!(message_result.has_bind_uuid(&contact_id));
}

#[test]
fn test_has_thread_literals_true_when_thread_id_present() {
    let id = Uuid::new_v4();
    let expr = Expr::Literal(EmailLiteral::ThreadId(id));
    assert!(has_thread_literals(&expr));
}

#[test]
fn test_has_thread_literals_false_when_only_message_literals() {
    let expr = Expr::Literal(EmailLiteral::Sender(complete("test@example.com")));
    assert!(!has_thread_literals(&expr));
}

#[test]
fn test_has_message_literals_true_when_sender_present() {
    let expr = Expr::Literal(EmailLiteral::Sender(complete("test@example.com")));
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
    let expr = Expr::and(
        Expr::Literal(EmailLiteral::ThreadId(id)),
        Expr::Literal(EmailLiteral::Sender(complete("test@example.com"))),
    );
    assert!(has_thread_literals(&expr));
    assert!(has_message_literals(&expr));
}

#[test]
fn test_build_thread_email_filter_single_project_id() {
    let expr = Expr::Literal(EmailLiteral::ProjectId("project-123".to_string()));
    let result = build_thread_email_filter(&expr, DEFAULT_SORT_TS);
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
    let result = build_thread_email_filter(&expr, DEFAULT_SORT_TS);
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
    let result = build_message_email_filter(&expr, &ResolvedFilters::empty());
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
    let contact_id = Uuid::new_v4();
    let expr = Expr::and(
        Expr::Literal(EmailLiteral::ProjectId("project-123".to_string())),
        Expr::Literal(EmailLiteral::Sender(complete("sender@example.com"))),
    );

    let thread_result = build_thread_email_filter(&expr, DEFAULT_SORT_TS);
    let thread_debug = thread_result.to_debug_sql();
    assert!(thread_debug.contains("t.project_id = "));
    assert!(thread_result.has_bind_string("project-123"));
    assert!(!thread_debug.contains("from_contact_id"));

    let resolved = resolved_with(&[("sender@example.com", contact_id)]);
    let message_result = build_message_email_filter(&expr, &resolved);
    let message_debug = message_result.to_debug_sql();
    assert!(message_debug.contains("from_contact_id"));
    assert!(message_result.has_bind_uuid(&contact_id));
    assert!(!message_result.has_bind_string("project-123"));
}

#[test]
fn test_sql_injection_project_id_not_in_raw_sql() {
    let expr = Expr::Literal(EmailLiteral::ProjectId("'; DROP TABLE--".to_string()));
    let result = build_thread_email_filter(&expr, DEFAULT_SORT_TS);

    assert!(result.has_bind_string("'; DROP TABLE--"));
    assert!(result.has_no_raw_containing("DROP"));
    assert!(result.has_no_raw_containing("';"));
}

#[test]
fn test_sql_injection_email_not_in_raw_sql() {
    // Resolved Complete emails: the address is replaced by a uuid bind, so
    // the raw SQL never contains the email at all. Verify the email string
    // is absent from raw SQL — that's the property we care about.
    let id = Uuid::new_v4();
    let expr = Expr::Literal(EmailLiteral::Sender(complete("evil@x.com")));
    let resolved = resolved_with(&[("evil@x.com", id)]);
    let result = build_message_email_filter(&expr, &resolved);

    assert!(result.has_bind_uuid(&id));
    assert!(result.has_no_raw_containing("evil@x.com"));
}

#[test]
fn test_sql_injection_partial_email_not_in_raw_sql() {
    let expr = Expr::Literal(EmailLiteral::Sender(Email::Partial(
        "'; DROP TABLE--".to_string(),
    )));
    let result = build_message_email_filter(&expr, &ResolvedFilters::empty());

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
    let result = build_thread_email_filter(&expr, DEFAULT_SORT_TS);

    assert!(result.has_bind_uuid(&id));
    assert!(result.has_no_raw_containing(&id.to_string()));
}

#[test]
fn test_build_thread_address_filter_emits_in_cte_reference() {
    // The candidate WHERE just references the materialized CTE by name —
    // the actual matching set is built once in `matching_threads AS
    // MATERIALIZED (...)` at the top of the query.
    let expr = Expr::Literal(EmailLiteral::Sender(complete("a@b.com")));
    let result = build_thread_address_filter(&expr);
    let debug = result.to_debug_sql();

    assert!(debug.contains("t.id IN (SELECT thread_id FROM matching_threads)"));
    // No address-resolution details leak into the candidate WHERE itself.
    assert!(!debug.contains("from_contact_id"));
    assert!(!debug.contains("email_messages"));
}

#[test]
fn test_build_thread_address_filter_empty_when_no_address_literals() {
    let id = Uuid::new_v4();
    let expr = Expr::Literal(EmailLiteral::ThreadId(id));
    let result = build_thread_address_filter(&expr);
    assert!(result.is_empty());
}

#[test]
fn test_build_thread_address_filter_skips_mixed_or_to_avoid_false_negatives() {
    // `Sender(X) OR Importance(true)` cannot be safely reduced to `Sender(X)`
    // at the candidate stage — a thread matching only Importance would be
    // wrongly excluded. Expect no pushdown.
    let expr = Expr::or(
        Expr::Literal(EmailLiteral::Sender(complete("a@b.com"))),
        Expr::Literal(EmailLiteral::Importance(true)),
    );
    let result = build_thread_address_filter(&expr);
    assert!(result.is_empty());
}

#[test]
fn test_matching_threads_cte_body_single_sender_uses_union_form() {
    let id = Uuid::new_v4();
    let expr = Expr::Literal(EmailLiteral::Sender(complete("a@b.com")));
    let resolved = resolved_with(&[("a@b.com", id)]);
    let body = build_matching_threads_cte_body(&expr, &resolved).expect("body present");
    let debug = body.to_debug_sql();

    // Single sender: one UNION branch (no UNION keyword needed), index probe
    // on idx_email_messages_from_contact_id.
    assert!(debug.contains("SELECT m.thread_id FROM email_messages m"));
    assert!(debug.contains("m.from_contact_id = "));
    assert!(!debug.contains("UNION"));
    assert!(!debug.contains("LOWER(c.email_address)"));
    assert!(body.has_bind_uuid(&id));
}

#[test]
fn test_matching_threads_cte_body_or_of_kinds_emits_one_union_branch_per_literal() {
    // Sender OR Cc OR Bcc OR Recipient over the same email — the common
    // "filter by this address in any role" case. Each leaf becomes its own
    // index-driven UNION branch instead of a single OR-laden subquery.
    let id = Uuid::new_v4();
    let expr = Expr::or(
        Expr::or(
            Expr::or(
                Expr::Literal(EmailLiteral::Sender(complete("x@y.com"))),
                Expr::Literal(EmailLiteral::Cc(complete("x@y.com"))),
            ),
            Expr::Literal(EmailLiteral::Bcc(complete("x@y.com"))),
        ),
        Expr::Literal(EmailLiteral::Recipient(complete("x@y.com"))),
    );
    let resolved = resolved_with(&[("x@y.com", id)]);
    let body = build_matching_threads_cte_body(&expr, &resolved).expect("body present");
    let debug = body.to_debug_sql();

    // Three UNIONs join the four branches.
    assert_eq!(debug.matches("UNION").count(), 3);
    assert!(debug.contains("recipient_type = 'TO'"));
    assert!(debug.contains("recipient_type = 'CC'"));
    assert!(debug.contains("recipient_type = 'BCC'"));
    assert!(debug.contains("m.from_contact_id = "));
    assert!(body.has_bind_uuid(&id));
    // No correlated `m.thread_id = t.id` — uncorrelated branches.
    assert!(!debug.contains("m.thread_id = t.id"));
}

#[test]
fn test_matching_threads_cte_body_skips_unresolved_complete_branches() {
    // Sender(known) OR Sender(missing) — drops the missing branch from the
    // UNION rather than emitting a `WHERE FALSE` branch.
    let id = Uuid::new_v4();
    let expr = Expr::or(
        Expr::Literal(EmailLiteral::Sender(complete("known@x.com"))),
        Expr::Literal(EmailLiteral::Sender(complete("missing@x.com"))),
    );
    let resolved = resolved_with(&[("known@x.com", id)]);
    let body = build_matching_threads_cte_body(&expr, &resolved).expect("body present");
    let debug = body.to_debug_sql();

    // Only one branch left → no UNION keyword.
    assert!(!debug.contains("UNION"));
    assert!(debug.contains("m.from_contact_id = "));
    assert!(body.has_bind_uuid(&id));
}

#[test]
fn test_matching_threads_cte_body_partial_emits_ilike_branch_with_email_contacts_join() {
    let expr = Expr::Literal(EmailLiteral::Sender(Email::Partial("acme".into())));
    let body =
        build_matching_threads_cte_body(&expr, &ResolvedFilters::empty()).expect("body present");
    let debug = body.to_debug_sql();

    assert!(debug.contains("FROM email_contacts c"));
    assert!(debug.contains("ILIKE"));
    assert!(body.has_bind_string("%acme%"));
}

#[test]
fn test_matching_threads_cte_body_and_of_conjuncts_uses_combined_predicate_form() {
    // `Sender(X) AND Recipient(Y)` requires single-message semantics —
    // can't UNION the two (would change AND to OR). Expect a single
    // SELECT DISTINCT subquery whose WHERE ANDs both predicates.
    let sender_id = Uuid::new_v4();
    let recipient_id = Uuid::new_v4();
    let expr = Expr::and(
        Expr::Literal(EmailLiteral::Sender(complete("s@x.com"))),
        Expr::Literal(EmailLiteral::Recipient(complete("r@x.com"))),
    );
    let resolved = resolved_with(&[("s@x.com", sender_id), ("r@x.com", recipient_id)]);
    let body = build_matching_threads_cte_body(&expr, &resolved).expect("body present");
    let debug = body.to_debug_sql();

    assert!(debug.contains("SELECT DISTINCT m.thread_id"));
    assert!(!debug.contains("UNION"));
    // Both literals appear inside the combined predicate.
    assert!(body.has_bind_uuid(&sender_id));
    assert!(body.has_bind_uuid(&recipient_id));
    // Importance / NOT/AND patterns aren't extracted into this body.
    assert!(!debug.contains("ef.is_important"));
}

#[test]
fn test_matching_threads_cte_body_uses_resolved_trash_label_id() {
    // With a resolved trash label, the per-branch TRASH check is a direct
    // ml.label_id probe rather than a name+link_id join.
    let contact_id = Uuid::new_v4();
    let trash_id = Uuid::new_v4();
    let expr = Expr::Literal(EmailLiteral::Sender(complete("a@b.com")));
    let resolved = ResolvedFilters::empty()
        .with_contact("a@b.com", contact_id)
        .with_trash(trash_id);
    let body = build_matching_threads_cte_body(&expr, &resolved).expect("body present");
    let debug = body.to_debug_sql();

    assert!(debug.contains("ml.label_id = "));
    assert!(!debug.contains("l.name = 'TRASH'"));
    assert!(!debug.contains("JOIN email_labels"));
    assert!(body.has_bind_uuid(&trash_id));
}

#[test]
fn test_matching_threads_cte_body_none_when_no_address_literals() {
    let id = Uuid::new_v4();
    let expr = Expr::Literal(EmailLiteral::ThreadId(id));
    let body = build_matching_threads_cte_body(&expr, &ResolvedFilters::empty());
    assert!(body.is_none());
}

#[test]
fn test_full_query_emits_matching_threads_cte_and_in_reference() {
    // End-to-end: the full SQL contains both the materialized CTE
    // definition and the candidate WHERE reference to it. The candidate
    // WHERE no longer contains an inline matching subquery.
    let contact_id = Uuid::new_v4();
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox);
    let expr = Expr::Literal(EmailLiteral::Sender(complete("a@b.com")));
    let resolved = ResolvedFilters::empty()
        .with_contact("a@b.com", contact_id)
        .with_trash(Uuid::new_v4());
    let sql = super::query::debug_build_query_sql_with_resolved(&view, &expr, resolved);

    assert!(
        sql.contains("matching_threads AS MATERIALIZED ("),
        "MATERIALIZED CTE missing: {sql}"
    );
    assert!(
        sql.contains("t.id IN (SELECT thread_id FROM matching_threads)"),
        "candidate WHERE doesn't reference the CTE: {sql}"
    );
    // No inline EXISTS or correlated subquery remains in the candidate WHERE.
    let candidate_end = sql
        .find("ORDER BY effective_ts DESC, id DESC")
        .expect("candidate ORDER BY missing");
    let candidate_section = &sql[..candidate_end];
    assert!(
        !candidate_section.contains("m.thread_id = t.id"),
        "stale correlated subquery still present in candidate: {sql}",
    );
}

#[test]
fn test_build_thread_email_filter_calendar_only_true_emits_ics_exists() {
    let expr = Expr::Literal(EmailLiteral::CalendarOnly(true));
    let result = build_thread_email_filter(&expr, DEFAULT_SORT_TS);
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
    let result = build_thread_email_filter(&expr, DEFAULT_SORT_TS);
    let debug = result.to_debug_sql();

    assert!(debug.contains("TRUE"));
    assert!(!debug.contains("email_attachments"));
}

#[test]
fn test_build_message_email_filter_maps_calendar_only_to_true() {
    let expr = Expr::Literal(EmailLiteral::CalendarOnly(true));
    let result = build_message_email_filter(&expr, &ResolvedFilters::empty());
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

#[test]
fn test_build_thread_email_filter_created_at_greater_than() {
    use chrono::TimeZone;
    use item_filters::ast::date::DateLiteral;

    let dt = chrono::Utc.with_ymd_and_hms(2024, 1, 15, 12, 0, 0).unwrap();
    let expr = Expr::Literal(EmailLiteral::CreatedAt(DateLiteral::GreaterThan(dt)));
    let result = build_thread_email_filter(&expr, DEFAULT_SORT_TS);
    let debug = result.to_debug_sql();

    assert!(debug.contains("t.created_at >"));
    assert!(debug.contains("2024-01-15"));
}

#[test]
fn test_build_thread_email_filter_created_at_less_than_or_equal() {
    use chrono::TimeZone;
    use item_filters::ast::date::DateLiteral;

    let dt = chrono::Utc
        .with_ymd_and_hms(2024, 6, 30, 23, 59, 59)
        .unwrap();
    let expr = Expr::Literal(EmailLiteral::CreatedAt(DateLiteral::LessThanOrEqual(dt)));
    let result = build_thread_email_filter(&expr, DEFAULT_SORT_TS);
    let debug = result.to_debug_sql();

    assert!(debug.contains("t.created_at <="));
    assert!(debug.contains("2024-06-30"));
}

#[test]
fn test_build_thread_email_filter_updated_at_uses_sort_ts_field() {
    use chrono::TimeZone;
    use item_filters::ast::date::DateLiteral;

    let dt = chrono::Utc.with_ymd_and_hms(2024, 3, 1, 0, 0, 0).unwrap();
    let expr = Expr::Literal(EmailLiteral::UpdatedAt(DateLiteral::GreaterThanOrEqual(dt)));

    // Inbox view uses latest_inbound_message_ts
    let inbox_sort_ts = "t.latest_inbound_message_ts";
    let result = build_thread_email_filter(&expr, inbox_sort_ts);
    let debug = result.to_debug_sql();

    assert!(debug.contains("t.latest_inbound_message_ts >="));
    assert!(debug.contains("2024-03-01"));
}

#[test]
fn test_build_thread_email_filter_updated_at_with_different_sort_fields() {
    use chrono::TimeZone;
    use item_filters::ast::date::DateLiteral;

    let dt = chrono::Utc.with_ymd_and_hms(2024, 5, 15, 0, 0, 0).unwrap();
    let expr = Expr::Literal(EmailLiteral::UpdatedAt(DateLiteral::LessThan(dt)));

    // Sent view uses latest_outbound_message_ts
    let sent_sort_ts = "t.latest_outbound_message_ts";
    let result = build_thread_email_filter(&expr, sent_sort_ts);
    let debug = result.to_debug_sql();

    assert!(debug.contains("t.latest_outbound_message_ts <"));
    assert!(!debug.contains("t.updated_at <"));
}

#[test]
fn test_has_thread_literals_true_when_created_at_present() {
    use chrono::TimeZone;
    use item_filters::ast::date::DateLiteral;

    let dt = chrono::Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap();
    let expr = Expr::Literal(EmailLiteral::CreatedAt(DateLiteral::GreaterThan(dt)));
    assert!(has_thread_literals(&expr));
}

#[test]
fn test_has_thread_literals_true_when_updated_at_present() {
    use chrono::TimeZone;
    use item_filters::ast::date::DateLiteral;

    let dt = chrono::Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap();
    let expr = Expr::Literal(EmailLiteral::UpdatedAt(DateLiteral::LessThan(dt)));
    assert!(has_thread_literals(&expr));
}

#[test]
fn test_has_message_literals_false_when_only_date_filters() {
    use chrono::TimeZone;
    use item_filters::ast::date::DateLiteral;

    let dt = chrono::Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap();
    let expr = Expr::and(
        Expr::Literal(EmailLiteral::CreatedAt(DateLiteral::GreaterThan(dt))),
        Expr::Literal(EmailLiteral::UpdatedAt(DateLiteral::LessThan(dt))),
    );
    assert!(!has_message_literals(&expr));
}
