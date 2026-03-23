use super::SqlFragment;
use crate::domain::models::{PreviewView, PreviewViewStandardLabel};
use filter_ast::Expr;
use item_filters::ast::email::{Email, EmailLiteral};
use recursion::CollapsibleExt;

pub(super) fn has_thread_literals(ast: &Expr<EmailLiteral>) -> bool {
    ast.collapse_frames(|frame| match frame {
        filter_ast::ExprFrame::And(a, b) | filter_ast::ExprFrame::Or(a, b) => a || b,
        filter_ast::ExprFrame::Not(a) => a,
        filter_ast::ExprFrame::Literal(EmailLiteral::ThreadId(_) | EmailLiteral::ProjectId(_)) => {
            true
        }
        filter_ast::ExprFrame::Literal(EmailLiteral::Shared(_)) => false,
        filter_ast::ExprFrame::Literal(_) => false,
    })
}

pub(super) fn has_message_literals(ast: &Expr<EmailLiteral>) -> bool {
    ast.collapse_frames(|frame| match frame {
        filter_ast::ExprFrame::And(a, b) | filter_ast::ExprFrame::Or(a, b) => a || b,
        filter_ast::ExprFrame::Not(a) => a,
        filter_ast::ExprFrame::Literal(
            EmailLiteral::ThreadId(_) | EmailLiteral::ProjectId(_) | EmailLiteral::Shared(_),
        ) => false,
        filter_ast::ExprFrame::Literal(_) => true,
    })
}

/// Builds a parameterized email address match fragment.
/// `preamble` is the raw SQL before the email comparison (EXISTS subquery header).
fn build_email_match(preamble: &str, email: &Email) -> SqlFragment {
    match email {
        Email::Complete(e) => {
            let mut f = SqlFragment::raw(format!(
                "{preamble}\n                    AND LOWER(c.email_address) = LOWER("
            ));
            f.extend(SqlFragment::bind_string(e.0.as_ref().to_string()));
            f.push_raw(")\n                )");
            f
        }
        Email::Partial(s) => {
            let mut f = SqlFragment::raw(format!(
                "{preamble}\n                    AND c.email_address ILIKE "
            ));
            f.extend(SqlFragment::bind_string(format!(
                "%{}%",
                escape_like_pattern(s)
            )));
            f.push_raw("\n                )");
            f
        }
    }
}

pub(super) fn build_message_email_filter(ast: &Expr<EmailLiteral>) -> SqlFragment {
    let fragment = ast.collapse_frames(|frame| match frame {
        filter_ast::ExprFrame::And(a, b) => SqlFragment::and(a, b),
        filter_ast::ExprFrame::Or(a, b) => SqlFragment::or(a, b),
        filter_ast::ExprFrame::Not(a) => SqlFragment::not(a),

        filter_ast::ExprFrame::Literal(
            EmailLiteral::ThreadId(_) | EmailLiteral::ProjectId(_),
        ) => SqlFragment::raw("TRUE"),

        filter_ast::ExprFrame::Literal(EmailLiteral::Sender(email)) => build_email_match(
            r#"EXISTS (
                    SELECT 1 FROM email_contacts c
                    WHERE c.id = m.from_contact_id"#,
            &email,
        ),

        filter_ast::ExprFrame::Literal(EmailLiteral::Recipient(email)) => build_email_match(
            r#"EXISTS (
                    SELECT 1 FROM email_message_recipients mr
                    JOIN email_contacts c ON mr.contact_id = c.id
                    WHERE mr.message_id = m.id
                    AND mr.recipient_type = 'TO'"#,
            &email,
        ),

        filter_ast::ExprFrame::Literal(EmailLiteral::Cc(email)) => build_email_match(
            r#"EXISTS (
                    SELECT 1 FROM email_message_recipients mr
                    JOIN email_contacts c ON mr.contact_id = c.id
                    WHERE mr.message_id = m.id
                    AND mr.recipient_type = 'CC'"#,
            &email,
        ),

        filter_ast::ExprFrame::Literal(EmailLiteral::Bcc(email)) => build_email_match(
            r#"EXISTS (
                    SELECT 1 FROM email_message_recipients mr
                    JOIN email_contacts c ON mr.contact_id = c.id
                    WHERE mr.message_id = m.id
                    AND mr.recipient_type = 'BCC'"#,
            &email,
        ),

        filter_ast::ExprFrame::Literal(EmailLiteral::Importance(true)) => {
            SqlFragment::raw(
                r#"(
                NOT EXISTS (
                    SELECT 1 FROM email_message_labels ml
                    JOIN email_labels l ON ml.label_id = l.id
                    WHERE ml.message_id = m.id
                    AND l.name = 'TRASH'
                )
                AND (
                    m.is_draft = TRUE
                    OR EXISTS (
                        SELECT 1 FROM email_message_labels ml
                        JOIN email_labels l ON ml.label_id = l.id
                        WHERE ml.message_id = m.id
                        AND l.name IN ('CATEGORY_PERSONAL', 'SENT', 'DRAFT')
                    )
                    OR NOT EXISTS (
                        SELECT 1 FROM email_message_labels ml
                        JOIN email_labels l ON ml.label_id = l.id
                        WHERE ml.message_id = m.id
                        AND l.name IN ('CATEGORY_UPDATES', 'CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS')
                    )
                )
            )"#,
            )
        }
        filter_ast::ExprFrame::Literal(EmailLiteral::Importance(false)) => {
            SqlFragment::raw(
                r#"(
                NOT EXISTS (
                    SELECT 1 FROM email_message_labels ml
                    JOIN email_labels l ON ml.label_id = l.id
                    WHERE ml.message_id = m.id
                    AND l.name IN ('CATEGORY_PERSONAL', 'SENT', 'DRAFT')
                )
                AND EXISTS (
                    SELECT 1 FROM email_message_labels ml
                    JOIN email_labels l ON ml.label_id = l.id
                    WHERE ml.message_id = m.id
                    AND l.name IN ('CATEGORY_UPDATES', 'CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS')
                )
            )"#,
            )
        }
        filter_ast::ExprFrame::Literal(EmailLiteral::NotificationDone(_)) => {
            SqlFragment::raw("TRUE")
        }
        filter_ast::ExprFrame::Literal(EmailLiteral::NotificationSeen(_)) => {
            SqlFragment::raw("TRUE")
        }
        filter_ast::ExprFrame::Literal(EmailLiteral::Shared(_)) => SqlFragment::raw("TRUE"),
    });

    fragment.with_and_prefix()
}

/// Builds thread-level SQL WHERE conditions. Message-level literals map to TRUE.
pub(super) fn build_thread_email_filter(ast: &Expr<EmailLiteral>) -> SqlFragment {
    let fragment = ast.collapse_frames(|frame| match frame {
        filter_ast::ExprFrame::And(a, b) => SqlFragment::and(a, b),
        filter_ast::ExprFrame::Or(a, b) => SqlFragment::or(a, b),
        filter_ast::ExprFrame::Not(a) => SqlFragment::not(a),

        filter_ast::ExprFrame::Literal(EmailLiteral::ThreadId(id)) => {
            let mut f = SqlFragment::raw("t.id = ");
            f.extend(SqlFragment::bind_uuid(id));
            f
        }

        filter_ast::ExprFrame::Literal(EmailLiteral::ProjectId(id)) => {
            let mut f = SqlFragment::raw("t.project_id = ");
            f.extend(SqlFragment::bind_string(id));
            f
        }

        filter_ast::ExprFrame::Literal(
            EmailLiteral::Sender(_)
            | EmailLiteral::Cc(_)
            | EmailLiteral::Bcc(_)
            | EmailLiteral::Recipient(_)
            | EmailLiteral::Importance(_)
            | EmailLiteral::NotificationDone(_)
            | EmailLiteral::NotificationSeen(_)
            | EmailLiteral::Shared(_),
        ) => SqlFragment::raw("TRUE"),
    });

    fragment.with_and_prefix()
}

/// Escapes special characters in LIKE patterns to prevent SQL injection
pub(super) fn escape_like_pattern(s: &str) -> String {
    s.replace('\\', r"\\")
        .replace('%', r"\%")
        .replace('_', r"\_")
}

/// Builds thread-level WHERE conditions based on the view type
pub(super) fn build_view_thread_filter(view: &PreviewView) -> SqlFragment {
    match view {
        PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox) => SqlFragment::raw(
            " AND t.inbox_visible = TRUE AND t.latest_inbound_message_ts IS NOT NULL",
        ),
        PreviewView::StandardLabel(PreviewViewStandardLabel::Sent) => {
            SqlFragment::raw(" AND t.latest_outbound_message_ts IS NOT NULL")
        }
        PreviewView::StandardLabel(PreviewViewStandardLabel::Drafts)
        | PreviewView::StandardLabel(PreviewViewStandardLabel::Starred)
        | PreviewView::StandardLabel(PreviewViewStandardLabel::All)
        | PreviewView::StandardLabel(PreviewViewStandardLabel::Important)
        | PreviewView::UserLabel(_) => SqlFragment::empty(),
        PreviewView::StandardLabel(PreviewViewStandardLabel::Other) => {
            SqlFragment::raw(" AND t.inbox_visible = TRUE")
        }
    }
}

/// Builds message-level WHERE conditions based on the view type
pub(super) fn build_view_message_filter(view: &PreviewView) -> SqlFragment {
    match view {
        PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox)
        | PreviewView::StandardLabel(PreviewViewStandardLabel::All) => SqlFragment::empty(),
        PreviewView::StandardLabel(PreviewViewStandardLabel::Sent) => {
            SqlFragment::raw(" AND m.is_sent = TRUE")
        }
        PreviewView::StandardLabel(PreviewViewStandardLabel::Drafts) => {
            SqlFragment::raw(" AND m.is_draft = TRUE")
        }
        PreviewView::StandardLabel(PreviewViewStandardLabel::Starred) => {
            SqlFragment::raw(" AND m.is_starred = TRUE AND m.is_draft = FALSE")
        }
        PreviewView::StandardLabel(PreviewViewStandardLabel::Important) => SqlFragment::raw(
            r#" AND (
                    m.is_draft = TRUE
                    OR EXISTS (
                        SELECT 1 FROM email_message_labels ml
                        JOIN email_labels l ON ml.label_id = l.id
                        WHERE ml.message_id = m.id
                        AND l.name = 'IMPORTANT'
                        AND l.link_id = t.link_id
                    )
                )"#,
        ),
        PreviewView::StandardLabel(PreviewViewStandardLabel::Other) => SqlFragment::raw(
            r#" AND NOT EXISTS (
                    SELECT 1 FROM email_message_labels ml
                    JOIN email_labels l ON ml.label_id = l.id
                    WHERE ml.message_id = m.id
                    AND l.name IN ('IMPORTANT', 'CATEGORY_PERSONAL')
                    AND l.link_id = t.link_id
                )"#,
        ),
        PreviewView::UserLabel(label_name) => {
            let mut f = SqlFragment::raw(
                r#" AND EXISTS (
                    SELECT 1 FROM email_message_labels ml
                    JOIN email_labels l ON ml.label_id = l.id
                    WHERE ml.message_id = m.id
                    AND l.name = "#,
            );
            f.extend(SqlFragment::bind_string(label_name.clone()));
            f.push_raw(
                r#"
                    AND l.link_id = t.link_id
                )"#,
            );
            f
        }
    }
}

/// Returns the appropriate timestamp field to use for sorting based on the view
pub(super) fn get_sort_timestamp_field(view: &PreviewView) -> &'static str {
    match view {
        PreviewView::StandardLabel(PreviewViewStandardLabel::Sent) => {
            "t.latest_outbound_message_ts"
        }
        PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox) => {
            "t.latest_inbound_message_ts"
        }
        _ => "COALESCE(t.latest_non_spam_message_ts, t.updated_at)",
    }
}
