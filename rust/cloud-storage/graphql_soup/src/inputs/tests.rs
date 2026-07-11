use async_graphql::ID;
use filter_ast::Expr;
use item_filters::ast::{chat::ChatLiteral, document::DocumentLiteral};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};

use super::*;

fn test_macro_user_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|user@example.com")
        .unwrap()
        .into_owned()
}

#[test]
fn maps_email_view_to_soup_request() {
    let request = SoupInput {
        limit: None,
        expand: None,
        sort_method: None,
        cursor: None,
        email_view: Some(GraphqlEmailView::Sent),
        filters: None,
    }
    .into_request(test_macro_user_id(), vec![])
    .unwrap();

    assert_eq!(request.email_preview_view.to_string(), "sent");
}

#[test]
fn defaults_email_view_to_inbox() {
    let request = SoupInput {
        limit: None,
        expand: None,
        sort_method: None,
        cursor: None,
        email_view: None,
        filters: None,
    }
    .into_request(test_macro_user_id(), vec![])
    .unwrap();

    assert_eq!(request.email_preview_view.to_string(), "inbox");
}

#[test]
fn expands_document_file_assoc() {
    let expr = GraphqlDocumentLiteral::FileAssoc("assoc:pdf".to_owned())
        .into_expr()
        .unwrap();

    assert!(matches!(expr, Expr::Literal(DocumentLiteral::FileType(_))));
}

#[test]
fn builds_binary_filter_expressions() {
    let expr = GraphqlChatExpr::And(GraphqlChatBinaryExpr {
        left: Box::new(GraphqlChatExpr::Literal(GraphqlChatLiteral::ChatId(ID(
            "00000000-0000-0000-0000-000000000001".to_owned(),
        )))),
        right: Box::new(GraphqlChatExpr::Literal(GraphqlChatLiteral::ChatId(ID(
            "00000000-0000-0000-0000-000000000002".to_owned(),
        )))),
    })
    .into_expr()
    .unwrap();

    assert!(matches!(
        expr,
        Expr::And(left, right)
            if matches!(*left, Expr::Literal(ChatLiteral::ChatId(_)))
                && matches!(*right, Expr::Literal(ChatLiteral::ChatId(_)))
    ));
}
