use filter_ast::{ExpandFrame, Expr, FoldTree, TryExpandNode};
use macro_user_id::{cowlike::CowLike, email::EmailStr};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{EmailFilters, ast::ExpandErr};

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
        ]
        .into_iter()
        .fold_with(Expr::and))
    }
}
