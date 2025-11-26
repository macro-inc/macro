use filter_ast::{ExpandFrame, Expr, FoldTree, TryExpandNode};
use macro_user_id::{cowlike::CowLike, email::EmailStr};
use serde::{Deserialize, Serialize};

use crate::{EmailFilters, ast::ExpandErr};

/// Possible email values in the ast
#[derive(Debug, Serialize, Deserialize)]
pub enum Email {
    /// A string which is not a valid fully qualified email
    Partial(String),
    /// a fully valid qualified [EmailStr]
    Complete(EmailStr<'static>),
}

/// The literal type that can appear in the item filter ast
#[derive(Debug, Serialize, Deserialize)]
pub enum EmailLiteral {
    /// The sender field of the email
    Sender(Email),
    /// The cc field of the email
    Cc(Email),
    /// The bcc field of the email
    Bcc(Email),
    /// The recipient field of the email
    Recipient(Email),
}

impl ExpandFrame<EmailLiteral> for EmailFilters {
    type Err = ExpandErr;
    fn expand_ast(input: Self) -> Result<Option<filter_ast::Expr<EmailLiteral>>, Self::Err> {
        let EmailFilters {
            senders,
            cc,
            bcc,
            recipients,
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

        Ok([sender_nodes, cc_nodes, bcc_nodes, recipient_nodes]
            .into_iter()
            .fold_with(Expr::and))
    }
}
