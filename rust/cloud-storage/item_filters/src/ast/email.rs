use filter_ast::{ExpandFrame, Expr, FoldTree, TryExpandNode};
use macro_user_id::{cowlike::CowLike, email::EmailStr};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{EmailFilters, SharedEmailFilter, ast::ExpandErr, ast::date::DateLiteral};

/// Possible email values in the ast
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Email {
    /// A string which is not a valid fully qualified email
    Partial(String),
    /// a fully valid qualified [EmailStr]
    Complete(EmailStr<'static>),
}

/// The literal type that can appear in the item filter ast
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EmailLiteral {
    /// The sender field of the email
    Sender(Email),
    /// The cc field of the email
    Cc(Email),
    /// The bcc field of the email
    Bcc(Email),
    /// The recipient field of the email
    Recipient(Email),
    /// This value filters by email thread ID
    ThreadId(Uuid),
    /// This value filters by project ID
    ProjectId(String),
    /// This node value filters by email importance. false short-circuits to match nothing.
    Importance(bool),
    /// This node value filters by notification done state for emails.
    NotificationDone(bool),
    /// This node value filters by notification seen state for emails.
    NotificationSeen(bool),
    /// Controls whether shared email threads are included in results.
    Shared(SharedEmailFilter),
    /// When true, only include threads that have at least one message with an
    /// `.ics` calendar attachment (filename or `application/ics` mime type).
    /// When false, no constraint is applied.
    CalendarOnly(bool),
    /// Filter by thread created_at timestamp
    #[serde(rename = "ca")]
    CreatedAt(DateLiteral),
    /// Filter by thread updated_at timestamp (view-dependent field)
    #[serde(rename = "ua")]
    UpdatedAt(DateLiteral),
}

impl ExpandFrame<EmailLiteral> for EmailFilters {
    type Err = ExpandErr;
    fn expand_ast(input: Self) -> Result<Option<filter_ast::Expr<EmailLiteral>>, Self::Err> {
        let EmailFilters {
            senders,
            cc,
            bcc,
            recipients,
            email_thread_ids,
            project_ids,
            importance,
            notification_filters,
            include_labels: _,
            exclude_labels: _,
            shared,
            calendar_only,
        } = input;

        fn map_email(s: String) -> Email {
            match EmailStr::parse_from_str(&s) {
                Ok(e) => Email::Complete(e.into_owned()),
                Err(_) => Email::Partial(s),
            }
        }

        let sender_nodes = senders
            .into_iter()
            .map(map_email)
            .expand(EmailLiteral::Sender, Expr::or);
        let cc_nodes = cc
            .into_iter()
            .map(map_email)
            .expand(EmailLiteral::Cc, Expr::or);
        let bcc_nodes = bcc
            .into_iter()
            .map(map_email)
            .expand(EmailLiteral::Bcc, Expr::or);
        let recipient_nodes = recipients
            .into_iter()
            .map(map_email)
            .expand(EmailLiteral::Recipient, Expr::or);

        let thread_id_nodes = email_thread_ids
            .iter()
            .map(|s| Uuid::parse_str(s))
            .try_expand(|r| r.map(EmailLiteral::ThreadId), Expr::or)?;

        let project_id_nodes = project_ids
            .into_iter()
            .expand(EmailLiteral::ProjectId, Expr::or);

        let importance_node = importance.map(|imp| Expr::Literal(EmailLiteral::Importance(imp)));
        let notification_done_node = notification_filters
            .done
            .map(|done| Expr::Literal(EmailLiteral::NotificationDone(done)));
        let notification_seen_node = notification_filters
            .seen
            .map(|seen| Expr::Literal(EmailLiteral::NotificationSeen(seen)));
        let shared_node = if shared.is_default() {
            None
        } else {
            Some(Expr::Literal(EmailLiteral::Shared(shared)))
        };
        let calendar_only_node = calendar_only
            .filter(|v| *v)
            .map(|v| Expr::Literal(EmailLiteral::CalendarOnly(v)));

        Ok([
            sender_nodes,
            cc_nodes,
            bcc_nodes,
            recipient_nodes,
            thread_id_nodes,
            project_id_nodes,
            importance_node,
            notification_done_node,
            notification_seen_node,
            shared_node,
            calendar_only_node,
        ]
        .into_iter()
        .fold_with(Expr::and))
    }
}
