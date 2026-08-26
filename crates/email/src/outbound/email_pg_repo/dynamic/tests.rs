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

// ---------------------------------------------------------------------------
// Email::Domain emits an exact-domain predicate, not an ILIKE substring
// ---------------------------------------------------------------------------
//
// `Email::Domain("acme.com")` must match contacts whose address ends in
// `@acme.com` exactly — not anything containing the substring "acme.com".
// The SQL predicate is `LOWER(SPLIT_PART(c.email_address, '@', 2)) = $domain`,
// backed by the expression index `idx_email_contacts_email_domain`.
// These tests guard against three regressions:
//   1. accidentally falling back to `ILIKE '%domain%'` (would re-introduce
//      false positives like `macro.community` matching `macro.com`)
//   2. forgetting to lowercase the bound value before sending it (the index
//      is built on `LOWER(...)`, so a mixed-case bind would miss the index)
//   3. leaking the domain into raw SQL instead of binding it (sql injection)

#[test]
fn test_build_message_email_filter_sender_domain_emits_split_part_eq() {
    let expr = Expr::Literal(EmailLiteral::Sender(Email::Domain("acme.com".to_string())));
    let result = build_message_email_filter(&expr, &ResolvedFilters::empty());
    let debug = result.to_debug_sql();

    assert!(
        debug.contains("LOWER(SPLIT_PART(c.email_address, '@', 2)) ="),
        "expected exact-domain predicate, got: {debug}"
    );
    assert!(!debug.contains("ILIKE"), "domain match must not use ILIKE");
    assert!(result.has_bind_string("acme.com"));
    // No `%domain%` wildcards — that would re-introduce the substring bug.
    assert!(!result.has_bind_string("%acme.com%"));
    assert!(result.has_no_raw_containing("acme.com"));
}

#[test]
fn test_build_message_email_filter_domain_lowercases_bind_value() {
    // The expression index is `LOWER(SPLIT_PART(email_address, '@', 2))`. If
    // we bind a mixed-case domain, the predicate becomes
    // `LOWER(SPLIT_PART(c.email_address, '@', 2)) = 'ACME.COM'`, which never
    // matches anything (LHS is lowercase, RHS isn't) AND can't use the
    // index. The fix is to lowercase the bound value.
    let expr = Expr::Literal(EmailLiteral::Sender(Email::Domain("AcMe.CoM".to_string())));
    let result = build_message_email_filter(&expr, &ResolvedFilters::empty());

    assert!(result.has_bind_string("acme.com"));
    assert!(!result.has_bind_string("AcMe.CoM"));
}

#[test]
fn test_build_message_email_filter_recipient_domain() {
    let expr = Expr::Literal(EmailLiteral::Recipient(Email::Domain(
        "acme.com".to_string(),
    )));
    let result = build_message_email_filter(&expr, &ResolvedFilters::empty());
    let debug = result.to_debug_sql();

    assert!(debug.contains("email_message_recipients"));
    assert!(debug.contains("recipient_type = 'TO'"));
    assert!(debug.contains("LOWER(SPLIT_PART(c.email_address, '@', 2)) ="));
    assert!(!debug.contains("ILIKE"));
    assert!(result.has_bind_string("acme.com"));
    assert!(result.has_no_raw_containing("acme.com"));
}

#[test]
fn test_build_message_email_filter_cc_domain() {
    let expr = Expr::Literal(EmailLiteral::Cc(Email::Domain("acme.com".to_string())));
    let result = build_message_email_filter(&expr, &ResolvedFilters::empty());
    let debug = result.to_debug_sql();

    assert!(debug.contains("recipient_type = 'CC'"));
    assert!(debug.contains("LOWER(SPLIT_PART(c.email_address, '@', 2)) ="));
    assert!(!debug.contains("ILIKE"));
    assert!(result.has_bind_string("acme.com"));
}

#[test]
fn test_build_message_email_filter_bcc_domain() {
    let expr = Expr::Literal(EmailLiteral::Bcc(Email::Domain("acme.com".to_string())));
    let result = build_message_email_filter(&expr, &ResolvedFilters::empty());
    let debug = result.to_debug_sql();

    assert!(debug.contains("recipient_type = 'BCC'"));
    assert!(debug.contains("LOWER(SPLIT_PART(c.email_address, '@', 2)) ="));
    assert!(!debug.contains("ILIKE"));
    assert!(result.has_bind_string("acme.com"));
}

#[test]
fn test_partial_and_domain_emit_different_predicates_for_same_string() {
    // A regression test: before the split, `Email::Partial("acme.com")` and
    // `Email::Domain("acme.com")` shared the same `ILIKE '%acme.com%'`
    // predicate. Splitting them is the whole point of the change — confirm
    // they now produce structurally different SQL even with identical input.
    let s = "acme.com";

    let partial = build_message_email_filter(
        &Expr::Literal(EmailLiteral::Sender(Email::Partial(s.to_string()))),
        &ResolvedFilters::empty(),
    );
    let domain = build_message_email_filter(
        &Expr::Literal(EmailLiteral::Sender(Email::Domain(s.to_string()))),
        &ResolvedFilters::empty(),
    );

    let partial_debug = partial.to_debug_sql();
    let domain_debug = domain.to_debug_sql();

    // Partial is a substring scan against the full address.
    assert!(partial_debug.contains("ILIKE"));
    assert!(!partial_debug.contains("SPLIT_PART"));
    assert!(partial.has_bind_string("%acme.com%"));

    // Domain is an exact match against the domain portion only.
    assert!(domain_debug.contains("SPLIT_PART"));
    assert!(!domain_debug.contains("ILIKE"));
    assert!(domain.has_bind_string("acme.com"));
}

#[test]
fn test_has_thread_literals_true_when_notification_seen_present() {
    let expr = Expr::Literal(EmailLiteral::NotificationSeen(false));
    assert!(has_thread_literals(&expr));
    assert!(!has_message_literals(&expr));
}

#[test]
fn test_notification_seen_compiles_to_thread_is_read() {
    let unread = build_thread_email_filter(
        &Expr::Literal(EmailLiteral::NotificationSeen(false)),
        DEFAULT_SORT_TS,
    )
    .to_debug_sql();
    assert!(unread.contains("t.is_read = FALSE"));

    let read = build_thread_email_filter(
        &Expr::Literal(EmailLiteral::NotificationSeen(true)),
        DEFAULT_SORT_TS,
    )
    .to_debug_sql();
    assert!(read.contains("t.is_read = TRUE"));
}

#[test]
fn test_notification_seen_is_noop_in_message_filter() {
    for seen in [true, false] {
        let result = build_message_email_filter(
            &Expr::Literal(EmailLiteral::NotificationSeen(seen)),
            &ResolvedFilters::empty(),
        );
        let debug = result.to_debug_sql();
        assert!(debug.contains("TRUE"));
        assert!(!debug.contains("is_read"));
    }
}

#[test]
fn test_full_query_notification_seen_filters_candidate_by_is_read() {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox);
    let unread = super::query::debug_build_query_sql(
        &view,
        &Expr::Literal(EmailLiteral::NotificationSeen(false)),
    );
    assert!(
        unread.contains("t.is_read = FALSE"),
        "unread NotificationSeen must land in the candidate WHERE: {unread}"
    );

    let read = super::query::debug_build_query_sql(
        &view,
        &Expr::Literal(EmailLiteral::NotificationSeen(true)),
    );
    assert!(
        read.contains("t.is_read = TRUE"),
        "read NotificationSeen must land in the candidate WHERE: {read}"
    );
}

#[test]
fn test_importance_compiles_to_thread_signal_flag() {
    let thread = build_thread_email_filter(
        &Expr::Literal(EmailLiteral::Importance(true)),
        "t.updated_at",
    )
    .to_debug_sql();
    assert!(thread.contains("t.is_signal"));
    assert!(!thread.contains("NOT t.is_signal"));

    let thread = build_thread_email_filter(
        &Expr::Literal(EmailLiteral::Importance(false)),
        "t.updated_at",
    )
    .to_debug_sql();
    assert!(thread.contains("NOT t.is_signal"));
}

#[test]
fn test_importance_is_noop_in_message_filter() {
    // The heuristic lives in the denormalized flag now; the lateral must not
    // re-evaluate it per message.
    for imp in [true, false] {
        let result = build_message_email_filter(
            &Expr::Literal(EmailLiteral::Importance(imp)),
            &ResolvedFilters::empty(),
        );
        let debug = result.to_debug_sql();
        assert!(!debug.contains("email_filters"));
        assert!(!debug.contains("CATEGORY"));
        assert!(!debug.contains("is_important"));
    }
}

#[test]
fn test_importance_query_has_no_message_exists_pushdown() {
    use item_filters::SharedEmailFilter;

    // The Signal-tab shape: inbox view + Importance(true) + Shared(exclude).
    // The candidate stage must filter on t.is_signal directly, with no
    // per-message EXISTS mirror (the inbox view has no message filter).
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox);
    let expr = Expr::and(
        Expr::Literal(EmailLiteral::Importance(true)),
        Expr::Literal(EmailLiteral::Shared(SharedEmailFilter::Exclude)),
    );
    let sql = super::query::debug_build_query_sql(&view, &expr);

    assert!(sql.contains("t.is_signal"));
    assert!(!sql.contains("AND EXISTS (SELECT 1 FROM email_messages m WHERE m.thread_id = t.id"));
    assert!(!sql.contains("is_important = "));
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
fn test_build_query_multi_link_fans_out_per_link() {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Sent);
    let expr = Expr::Literal(EmailLiteral::CalendarOnly(false));
    let sql = super::query::debug_build_query_sql_multi_link(&view, &expr);

    // Each link gets its own ordered, LIMITed candidate scan...
    assert!(
        sql.contains("FROM unnest(") && sql.contains("CROSS JOIN LATERAL"),
        "multi-link candidates must fan out per link: {sql}"
    );
    assert!(
        sql.contains("t.link_id = links.link_id"),
        "per-link branch must scope to a single link: {sql}"
    );
    assert!(
        !sql.contains("t.link_id = ANY("),
        "multi-link owned scan must not use = ANY: {sql}"
    );
    // ...with a per-branch LIMIT feeding the outer sort.
    assert_eq!(
        sql.matches("ORDER BY effective_ts DESC, id DESC").count(),
        2,
        "expected per-link and outer candidate ordering: {sql}"
    );
}

#[test]
fn test_build_query_single_link_keeps_any_scan() {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Sent);
    let expr = Expr::Literal(EmailLiteral::CalendarOnly(false));
    let sql = super::query::debug_build_query_sql(&view, &expr);

    assert!(sql.contains("t.link_id = ANY("));
    assert!(!sql.contains("FROM unnest("));
}

#[test]
fn test_build_query_team_scoped_multi_link_does_not_fan_out() {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox);
    let expr = Expr::Literal(EmailLiteral::Sender(Email::Domain("acme.com".to_string())));
    let sql = super::query::debug_build_query_sql_team_scoped_multi_link(&view, &expr);

    // Team-scoped candidates dedupe across links before the cursor; a
    // per-link LIMIT could starve the dedupe of duplicate copies.
    assert!(!sql.contains("FROM unnest("));
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

// ---------------------------------------------------------------------------
// Team-scoped (CRM) dedupe: one row per conversation across team mailboxes
// ---------------------------------------------------------------------------
//
// Two team members on the same email each have their own email_threads row
// (different link_id), so a team-widened query returns the conversation
// twice. The team-scoped query shape dedupes on the root message's RFC-822
// Message-ID (email_messages.global_id) with the caller's own copy winning.

#[test]
fn test_build_query_team_scoped_dedupes_on_root_global_id() {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox);
    let expr = Expr::Literal(EmailLiteral::Sender(Email::Domain("acme.com".to_string())));
    let sql = super::query::debug_build_query_sql_team_scoped(&view, &expr);

    assert!(
        sql.contains("SELECT DISTINCT ON (dedupe_key) *"),
        "missing dedupe wrapper: {sql}"
    );
    assert!(
        sql.contains("m_root.global_id IS NOT NULL"),
        "dedupe key must come from root-message global_id: {sql}"
    );
    assert!(
        sql.contains("m_root.is_draft = FALSE"),
        "drafts carry mailbox-local Message-IDs and must not be the key: {sql}"
    );
    assert!(
        sql.contains("ORDER BY m_root.internal_date_ts ASC NULLS LAST, m_root.id ASC"),
        "root selection must be deterministic under timestamp ties: {sql}"
    );
    assert!(
        sql.contains("t.id::text"),
        "threads without a usable global_id must fall back to their own id: {sql}"
    );
    // Own copy wins, then recency, then id.
    assert!(
        sql.contains("ORDER BY dedupe_key, is_own_link DESC, effective_ts DESC, id DESC"),
        "wrong representative preference order: {sql}"
    );
}

#[test]
fn test_build_query_team_scoped_cursor_applies_after_dedupe() {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox);
    let expr = Expr::Literal(EmailLiteral::Sender(Email::Domain("acme.com".to_string())));
    let sql = super::query::debug_build_query_sql_team_scoped(&view, &expr);

    // The cursor compares the representative's already-computed effective_ts
    // outside the dedupe wrapper...
    assert!(
        sql.contains("(effective_ts, id) < ("),
        "post-dedupe cursor missing: {sql}"
    );
    // ...and the per-candidate cursor CASE is gone — filtering before
    // DISTINCT ON would let duplicates resurface on later pages.
    assert!(
        !sql.contains("END, t.id"),
        "candidate-level cursor must not exist in team-scoped queries: {sql}"
    );
}

#[test]
fn test_build_query_team_scoped_dedupe_wraps_shared_union() {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox);
    let expr = Expr::Literal(EmailLiteral::Shared(
        item_filters::SharedEmailFilter::Include,
    ));
    let sql = super::query::debug_build_query_sql_team_scoped(&view, &expr);

    // Both the Owned and Shared candidate branches must sit inside the
    // dedupe wrapper, so a conversation entering via both still collapses.
    // (Skip past the shared CTE — it has its own UNION ALLs.)
    let distinct_pos = sql
        .find("DISTINCT ON (dedupe_key)")
        .expect("dedupe wrapper missing");
    let union_pos = sql[distinct_pos..]
        .find("UNION")
        .map(|p| distinct_pos + p)
        .expect("candidate UNION missing after dedupe wrapper");
    let dedupe_close = sql
        .find(") AS deduped_threads")
        .expect("dedupe wrapper close missing");
    assert!(
        union_pos < dedupe_close,
        "UNION must be inside the dedupe wrapper: {sql}"
    );
}

#[test]
fn test_build_query_non_team_has_no_dedupe_machinery() {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox);
    let expr = Expr::Literal(EmailLiteral::Sender(Email::Domain("acme.com".to_string())));
    let sql = super::query::debug_build_query_sql(&view, &expr);

    assert!(!sql.contains("DISTINCT ON"));
    assert!(!sql.contains("dedupe_key"));
    assert!(!sql.contains("is_own_link"));
    // Cursor stays inside the candidate select on the per-mailbox path
    // (contrast with the team path, which moves it past the dedupe wrapper).
    // The default UpdatedAt sort defers the uh join, so the cursor is a plain
    // (ts, id) comparison rather than the viewed-history CASE.
    let cursor_pos = sql
        .find(", t.id) < (")
        .expect("per-mailbox cursor comparison missing");
    let lateral_pos = sql.find("CROSS JOIN LATERAL").expect("lateral missing");
    assert!(
        cursor_pos < lateral_pos,
        "cursor must sit inside the candidate select: {sql}"
    );
}

#[test]
fn test_build_query_defers_user_history_join_for_updated_at_sort() {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Sent);
    let expr = Expr::Literal(EmailLiteral::Sender(Email::Domain("acme.com".to_string())));
    let sql = super::query::debug_build_query_sql_with_sort(
        &view,
        &expr,
        models_pagination::SimpleSortMethod::UpdatedAt,
    );

    // Exactly one uh join, deferred to the outer query (after email_links)
    // rather than living in the candidate stage.
    assert_eq!(
        sql.matches("LEFT JOIN email_user_history").count(),
        1,
        "expected a single, deferred uh join: {sql}"
    );
    let uh_pos = sql.find("LEFT JOIN email_user_history").unwrap();
    let el_pos = sql.find("JOIN email_links el").unwrap();
    assert!(
        uh_pos > el_pos,
        "uh join must be deferred past the candidate LIMIT: {sql}"
    );

    // Sort/cursor no longer reference uh; effective_ts is the plain sort field,
    // and viewed_at is sourced from the deferred join.
    assert!(
        !sql.contains("WHEN 'viewed_at'"),
        "deferred sort must drop the uh CASE: {sql}"
    );
    assert!(sql.contains("t.latest_outbound_message_ts AS effective_ts"));
    assert!(sql.contains("uh.updated_at AS viewed_at"));
}

#[test]
fn test_build_query_keeps_user_history_join_inline_for_viewed_at_sort() {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Sent);
    let expr = Expr::Literal(EmailLiteral::Sender(Email::Domain("acme.com".to_string())));
    let sql = super::query::debug_build_query_sql_with_sort(
        &view,
        &expr,
        models_pagination::SimpleSortMethod::ViewedAt,
    );

    // uh drives the sort key for viewed_at, so the join must stay in the
    // candidate stage (before email_links) and cannot be deferred.
    assert_eq!(
        sql.matches("LEFT JOIN email_user_history").count(),
        1,
        "viewed_at sort must keep a single, inline uh join: {sql}"
    );
    let uh_pos = sql.find("LEFT JOIN email_user_history").unwrap();
    let el_pos = sql.find("JOIN email_links el").unwrap();
    assert!(
        uh_pos < el_pos,
        "uh join must stay in the candidate stage for viewed_at sort: {sql}"
    );
    assert!(sql.contains("WHEN 'viewed_at' THEN COALESCE(uh"));
    // viewed_at is the candidate's own column on this path.
    assert!(sql.contains("t.viewed_at,"));
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
    let body = build_matching_threads_ctes(&expr, &resolved, None).expect("body present");
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
fn test_matching_threads_ctes_or_of_kinds_merges_recipient_roles() {
    // Sender OR Cc OR Bcc OR Recipient over the same email — the common
    // "filter by this address in any role" case. Sender keeps its own
    // branch; TO/CC/BCC merge into one recipient branch. All three roles
    // cover the whole recipient_type enum, so no type filter is emitted and
    // the recipients index is probed once instead of three times.
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
    let body = build_matching_threads_ctes(&expr, &resolved, None).expect("body present");
    let debug = body.to_debug_sql();

    // One UNION joins the two branches (sender + merged recipients).
    assert_eq!(debug.matches("UNION").count(), 1);
    assert!(!debug.contains("recipient_type"));
    assert!(debug.contains("email_message_recipients"));
    assert!(debug.contains("m.from_contact_id = "));
    assert!(body.has_bind_uuid(&id));
    // No correlated `m.thread_id = t.id` — uncorrelated branches.
    assert!(!debug.contains("m.thread_id = t.id"));
}

#[test]
fn test_matching_threads_ctes_recipient_role_subset_keeps_type_filter() {
    // Cc OR Bcc (no TO) must not widen to all recipient roles — the merged
    // branch keeps an IN filter over exactly the requested types.
    let id = Uuid::new_v4();
    let expr = Expr::or(
        Expr::Literal(EmailLiteral::Cc(complete("x@y.com"))),
        Expr::Literal(EmailLiteral::Bcc(complete("x@y.com"))),
    );
    let resolved = resolved_with(&[("x@y.com", id)]);
    let body = build_matching_threads_ctes(&expr, &resolved, None).expect("body present");
    let debug = body.to_debug_sql();

    // Single merged branch — no UNION.
    assert!(!debug.contains("UNION"));
    assert!(debug.contains("mr.recipient_type IN ('CC', 'BCC')"));
    assert!(!debug.contains("recipient_type = "));
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
    let body = build_matching_threads_ctes(&expr, &resolved, None).expect("body present");
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
        build_matching_threads_ctes(&expr, &ResolvedFilters::empty(), None).expect("body present");
    let debug = body.to_debug_sql();

    // The contact lookup is hoisted into a CTE the branch consumes.
    assert!(debug.contains("matching_contacts_0 AS MATERIALIZED ("));
    assert!(debug.contains("FROM email_contacts c"));
    assert!(debug.contains("FROM matching_contacts_0 c"));
    assert!(debug.contains("ILIKE"));
    assert!(body.has_bind_string("%acme%"));
}

#[test]
fn test_matching_threads_ctes_domain_all_roles_share_one_contact_scan() {
    // The CRM ecd shape: one domain across all four roles. email_contacts
    // must be scanned exactly once (the hoisted CTE), feeding a sender
    // branch and one merged recipient branch with no type filter.
    let domain = Email::Domain("acme.com".to_string());
    let expr = Expr::or(
        Expr::or(
            Expr::or(
                Expr::Literal(EmailLiteral::Sender(domain.clone())),
                Expr::Literal(EmailLiteral::Cc(domain.clone())),
            ),
            Expr::Literal(EmailLiteral::Bcc(domain.clone())),
        ),
        Expr::Literal(EmailLiteral::Recipient(domain)),
    );
    let body =
        build_matching_threads_ctes(&expr, &ResolvedFilters::empty(), None).expect("body present");
    let debug = body.to_debug_sql();

    assert_eq!(debug.matches("FROM email_contacts").count(), 1);
    assert_eq!(
        debug.matches("matching_contacts_0 AS MATERIALIZED").count(),
        1
    );
    assert_eq!(debug.matches("UNION").count(), 1);
    assert!(!debug.contains("recipient_type"));
    assert!(debug.contains("FROM matching_contacts_0 c"));
    assert!(body.has_bind_string("acme.com"));
}

#[test]
fn test_matching_threads_ctes_distinct_domains_get_separate_contact_ctes() {
    let expr = Expr::or(
        Expr::Literal(EmailLiteral::Sender(Email::Domain("acme.com".into()))),
        Expr::Literal(EmailLiteral::Sender(Email::Domain("globex.com".into()))),
    );
    let body =
        build_matching_threads_ctes(&expr, &ResolvedFilters::empty(), None).expect("body present");
    let debug = body.to_debug_sql();

    assert!(debug.contains("matching_contacts_0 AS MATERIALIZED"));
    assert!(debug.contains("matching_contacts_1 AS MATERIALIZED"));
    assert!(body.has_bind_string("acme.com"));
    assert!(body.has_bind_string("globex.com"));
}

#[test]
fn test_matching_threads_cte_body_domain_emits_split_part_branch() {
    // The union-branch path is the candidate-thread pushdown — it has its
    // own copy of the address-match SQL builder. Domain on this path must
    // also emit the exact-domain predicate, not ILIKE.
    let expr = Expr::Literal(EmailLiteral::Sender(Email::Domain("acme.com".into())));
    let body =
        build_matching_threads_ctes(&expr, &ResolvedFilters::empty(), None).expect("body present");
    let debug = body.to_debug_sql();

    assert!(debug.contains("FROM email_contacts c"));
    assert!(
        debug.contains("LOWER(SPLIT_PART(c.email_address, '@', 2)) ="),
        "expected exact-domain predicate in CTE branch, got: {debug}"
    );
    assert!(!debug.contains("ILIKE"));
    assert!(body.has_bind_string("acme.com"));
    assert!(!body.has_bind_string("%acme.com%"));
    assert!(body.has_no_raw_containing("acme.com"));
}

#[test]
fn test_matching_threads_cte_body_domain_recipient_kind_uses_split_part() {
    // Recipient (and CC/BCC) go through the recipient join in the
    // union-branch builder. Verify the predicate shape is consistent across
    // address kinds.
    let expr = Expr::Literal(EmailLiteral::Recipient(Email::Domain("acme.com".into())));
    let body =
        build_matching_threads_ctes(&expr, &ResolvedFilters::empty(), None).expect("body present");
    let debug = body.to_debug_sql();

    assert!(debug.contains("email_message_recipients"));
    assert!(debug.contains("mr.recipient_type = 'TO'"));
    assert!(debug.contains("LOWER(SPLIT_PART(c.email_address, '@', 2)) ="));
    assert!(!debug.contains("ILIKE"));
    assert!(body.has_bind_string("acme.com"));
}

#[test]
fn test_matching_threads_cte_body_domain_lowercases_bind_value() {
    let expr = Expr::Literal(EmailLiteral::Sender(Email::Domain("AcMe.CoM".into())));
    let body =
        build_matching_threads_ctes(&expr, &ResolvedFilters::empty(), None).expect("body present");

    assert!(body.has_bind_string("acme.com"));
    assert!(!body.has_bind_string("AcMe.CoM"));
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
    let body = build_matching_threads_ctes(&expr, &resolved, None).expect("body present");
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
    let body = build_matching_threads_ctes(&expr, &resolved, None).expect("body present");
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
    let body = build_matching_threads_ctes(&expr, &ResolvedFilters::empty(), None);
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
fn test_full_query_team_scoped_domain_filter_hoists_contact_cte() {
    // Team-scoped CRM domain query (the `ecd` shape): the domain contact
    // lookup must appear exactly once, as a hoisted CTE ahead of
    // matching_threads in the WITH chain — not re-scanned per UNION branch.
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let domain = Email::Domain("acme.com".to_string());
    let expr = Expr::or(
        Expr::or(
            Expr::or(
                Expr::Literal(EmailLiteral::Sender(domain.clone())),
                Expr::Literal(EmailLiteral::Cc(domain.clone())),
            ),
            Expr::Literal(EmailLiteral::Bcc(domain.clone())),
        ),
        Expr::Literal(EmailLiteral::Recipient(domain)),
    );
    let sql = super::query::debug_build_query_sql_team_scoped(&view, &expr);

    let contacts_pos = sql
        .find("matching_contacts_0 AS MATERIALIZED (")
        .expect("hoisted contact CTE missing");
    let threads_pos = sql
        .find("matching_threads AS MATERIALIZED (")
        .expect("matching_threads CTE missing");
    assert!(
        contacts_pos < threads_pos,
        "contact CTE must precede matching_threads: {sql}"
    );
    // One contact scan across the whole WITH chain (the lateral's cheap
    // correlated per-message probes and Step 3's sender join sit after it).
    let with_chain = &sql[..threads_pos];
    assert_eq!(
        with_chain.matches("FROM email_contacts").count(),
        1,
        "email_contacts must be scanned once in the WITH chain: {sql}"
    );
    let matching_threads_section = &sql[threads_pos..sql.find("SELECT\n").unwrap_or(sql.len())];
    assert!(
        !matching_threads_section.contains("recipient_type"),
        "all-roles domain filter needs no recipient_type filter in matching_threads: {sql}"
    );
}

#[test]
fn test_full_query_team_scoped_uses_resolved_team_links() {
    // With team links pre-resolved, the candidate WHERE probes the link set
    // directly and the matching CTEs are scoped to the same links, instead
    // of matching mail across every mailbox in the table and discarding
    // non-team threads afterwards. The live membership subquery must remain
    // alongside the cached probe — it revalidates the cached ids at
    // execution time so a member removed between resolve_filters and the
    // main query can't leak threads.
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let team_link = Uuid::new_v4();
    let expr = Expr::Literal(EmailLiteral::Sender(Email::Domain("acme.com".into())));
    let resolved = ResolvedFilters::empty().with_team_links(vec![team_link]);
    let sql = super::query::debug_build_query_sql_team_scoped_with_resolved(&view, &expr, resolved);

    assert!(
        sql.contains("t.link_id = ANY("),
        "candidate WHERE must probe the resolved link set: {sql}"
    );
    assert!(
        sql.contains("JOIN team_user tu"),
        "live membership revalidation subquery missing: {sql}"
    );
    assert!(
        sql.contains("c.link_id = ANY("),
        "contact CTE must be scoped to team links: {sql}"
    );
    assert!(
        sql.contains("m.link_id = ANY("),
        "matching_threads branches must be scoped to team links: {sql}"
    );
}

#[test]
fn test_full_query_team_scoped_without_resolved_links_falls_back_to_subquery() {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let expr = Expr::Literal(EmailLiteral::Sender(Email::Domain("acme.com".into())));
    let sql = super::query::debug_build_query_sql_team_scoped(&view, &expr);

    assert!(
        sql.contains("JOIN team_user tu"),
        "fallback subquery missing: {sql}"
    );
    assert!(
        !sql.contains("c.link_id = ANY("),
        "CTE must stay unscoped without resolved team links: {sql}"
    );
}

#[test]
fn test_full_query_team_scoped_shared_include_leaves_cte_unscoped() {
    // Shared candidates pull threads from arbitrary links via entity_access,
    // so the team-link scope must not be applied to the matching CTEs.
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let expr = Expr::and(
        Expr::Literal(EmailLiteral::Sender(Email::Domain("acme.com".into()))),
        Expr::Literal(EmailLiteral::Shared(
            item_filters::SharedEmailFilter::Include,
        )),
    );
    let resolved = ResolvedFilters::empty().with_team_links(vec![Uuid::new_v4()]);
    let sql = super::query::debug_build_query_sql_team_scoped_with_resolved(&view, &expr, resolved);

    assert!(
        !sql.contains("c.link_id = ANY("),
        "shared-include CTE must stay unscoped: {sql}"
    );
    assert!(
        !sql.contains("m.link_id = ANY("),
        "shared-include CTE must stay unscoped: {sql}"
    );
}

#[test]
fn test_build_thread_email_filter_calendar_only_true_uses_thread_flag() {
    let expr = Expr::Literal(EmailLiteral::CalendarOnly(true));
    let result = build_thread_email_filter(&expr, DEFAULT_SORT_TS);
    let debug = result.to_debug_sql();

    assert!(debug.contains("t.has_calendar_attachment"));
    // No per-thread attachment probe remains in the candidate WHERE.
    assert!(!debug.contains("email_attachments"));
}

#[test]
fn test_full_query_calendar_only_uses_thread_flag_without_cte() {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let expr = Expr::Literal(EmailLiteral::CalendarOnly(true));
    let sql = super::query::debug_build_query_sql(&view, &expr);

    assert!(
        sql.contains("t.has_calendar_attachment"),
        "candidate WHERE must use the denormalized flag: {sql}"
    );
    assert!(
        !sql.contains("calendar_threads"),
        "calendar CTE should be gone: {sql}"
    );
    assert!(
        !sql.contains("email_attachments"),
        "no attachment scan should remain: {sql}"
    );
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

// ---------------------------------------------------------------------------
// matching_threads link scoping (owned-only, non-team queries)
// ---------------------------------------------------------------------------

#[test]
fn test_matching_threads_partial_branch_is_link_scoped_when_scope_given() {
    // Partial (ILIKE) branches join email_contacts/email_messages by text
    // match; without a link scope they scan every mailbox in the table.
    // With a scope, both the contact and message sides must be restricted.
    let links = vec![Uuid::new_v4(), Uuid::new_v4()];
    let expr = Expr::Literal(EmailLiteral::Sender(Email::Partial("acme".to_string())));
    let body = build_matching_threads_ctes(&expr, &ResolvedFilters::empty(), Some(&links))
        .expect("body present");
    let debug = body.to_debug_sql();

    assert!(debug.contains("ILIKE"));
    assert!(debug.contains("c.link_id = ANY("));
    assert!(debug.contains("m.link_id = ANY("));
}

#[test]
fn test_matching_threads_domain_branch_is_link_scoped_when_scope_given() {
    let links = vec![Uuid::new_v4()];
    let expr = Expr::Literal(EmailLiteral::Recipient(Email::Domain(
        "acme.com".to_string(),
    )));
    let body = build_matching_threads_ctes(&expr, &ResolvedFilters::empty(), Some(&links))
        .expect("body present");
    let debug = body.to_debug_sql();

    assert!(debug.contains("c.link_id = ANY("));
    assert!(debug.contains("m.link_id = ANY("));
}

#[test]
fn test_matching_threads_combined_fallback_is_link_scoped_when_scope_given() {
    // Multiple AND conjuncts take the combined-predicate fallback, whose
    // outer scan is over email_messages — the scope must land there.
    let id = Uuid::new_v4();
    let links = vec![Uuid::new_v4()];
    let expr = Expr::and(
        Expr::Literal(EmailLiteral::Sender(complete("a@b.com"))),
        Expr::Literal(EmailLiteral::Recipient(complete("a@b.com"))),
    );
    let resolved = resolved_with(&[("a@b.com", id)]);
    let body = build_matching_threads_ctes(&expr, &resolved, Some(&links)).expect("body present");
    let debug = body.to_debug_sql();

    assert!(debug.contains("SELECT DISTINCT m.thread_id FROM email_messages m"));
    assert!(debug.contains("m.link_id = ANY("));
}

#[test]
fn test_matching_threads_unscoped_without_link_scope() {
    // Shared/team queries pass None — no link_id predicates may appear,
    // since candidate threads can live on other users' links.
    let expr = Expr::Literal(EmailLiteral::Sender(Email::Partial("acme".to_string())));
    let body =
        build_matching_threads_ctes(&expr, &ResolvedFilters::empty(), None).expect("body present");
    let debug = body.to_debug_sql();

    assert!(!debug.contains("link_id = ANY("));
}

#[test]
fn test_build_query_project_filter_adds_access_gated_union_branch() {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let expr = Expr::Literal(EmailLiteral::ProjectId(
        "96a9e31b-4ea0-48c5-b72e-4ac275546501".to_string(),
    ));
    let sql = super::query::debug_build_query_sql(&view, &expr);

    // Project branch is UNIONed alongside the owned branch, not a replacement.
    assert!(
        sql.contains("t.link_id = ANY(") || sql.contains("t.link_id = links.link_id"),
        "owned branch must remain: {sql}"
    );
    assert!(
        sql.contains("UNION"),
        "project branch must be a UNION: {sql}"
    );
    // Candidate set widens to the whole project, gated on project access.
    assert!(
        sql.contains("t.project_id = ANY("),
        "project branch must filter on project_id: {sql}"
    );
    assert!(
        sql.contains("pea.entity_id::text = t.project_id")
            && sql.contains("pea.entity_type = 'project'")
            && sql.contains("pea.source_id = ANY("),
        "project branch must gate on entity_access project rows: {sql}"
    );
}

#[test]
fn test_build_query_negated_project_filter_does_not_widen() {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let expr = Expr::is_not(Expr::Literal(EmailLiteral::ProjectId(
        "96a9e31b-4ea0-48c5-b72e-4ac275546501".to_string(),
    )));
    let sql = super::query::debug_build_query_sql(&view, &expr);

    assert!(
        !sql.contains("pea.entity_type = 'project'"),
        "negated project filter must not add the project candidate branch: {sql}"
    );
}

#[test]
fn test_build_query_no_project_filter_has_no_project_branch() {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let expr = Expr::Literal(EmailLiteral::CalendarOnly(false));
    let sql = super::query::debug_build_query_sql(&view, &expr);

    assert!(
        !sql.contains("pea.entity_type = 'project'"),
        "project branch must only appear for project-scoped filters: {sql}"
    );
}

#[test]
fn test_build_query_multi_project_filter_widens_all_projects() {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let expr = Expr::or(
        Expr::Literal(EmailLiteral::ProjectId(
            "96a9e31b-4ea0-48c5-b72e-4ac275546501".to_string(),
        )),
        Expr::Literal(EmailLiteral::ProjectId(
            "159f7ca9-4ea0-48c5-b72e-4ac275546501".to_string(),
        )),
    );
    let sql = super::query::debug_build_query_sql(&view, &expr);

    // One project branch carrying every requested id via = ANY, gated per
    // row so access is checked against each thread's own project.
    assert_eq!(
        sql.matches("t.project_id = ANY(").count(),
        1,
        "multi-project filters must widen through a single ANY branch: {sql}"
    );
    assert!(
        sql.contains("pea.entity_id::text = t.project_id"),
        "access gate must be per-row: {sql}"
    );
}

#[test]
fn test_build_query_shared_only_project_branch_excludes_owned() {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let expr = Expr::and(
        Expr::Literal(EmailLiteral::ProjectId(
            "96a9e31b-4ea0-48c5-b72e-4ac275546501".to_string(),
        )),
        Expr::Literal(EmailLiteral::Shared(item_filters::SharedEmailFilter::Only)),
    );
    let sql = super::query::debug_build_query_sql(&view, &expr);

    assert!(
        sql.contains("AND NOT (t.link_id = ANY("),
        "Shared=Only must exclude the caller's own threads from the project branch: {sql}"
    );
}

#[test]
fn test_build_query_shared_include_project_branch_keeps_owned() {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let expr = Expr::and(
        Expr::Literal(EmailLiteral::ProjectId(
            "96a9e31b-4ea0-48c5-b72e-4ac275546501".to_string(),
        )),
        Expr::Literal(EmailLiteral::Shared(
            item_filters::SharedEmailFilter::Include,
        )),
    );
    let sql = super::query::debug_build_query_sql(&view, &expr);

    assert!(
        !sql.contains("AND NOT (t.link_id = ANY("),
        "Shared=Include must not exclude owned threads from the project branch: {sql}"
    );
}
