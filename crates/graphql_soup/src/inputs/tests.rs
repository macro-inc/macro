use async_graphql::ID;
use filter_ast::Expr;
use item_filters::ast::{chat::ChatLiteral, document::DocumentLiteral};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_pagination::{CursorVal, Query};

use super::*;

fn test_macro_user_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|user@example.com")
        .unwrap()
        .into_owned()
}

#[test]
fn maps_email_view_to_soup_request() {
    let request = SoupInput::Initial(Box::new(SoupInitialInput {
        limit: None,
        expand: None,
        sort_method: None,
        email_view: Some(GraphqlEmailView::Sent),
        filters: None,
    }))
    .into_request(test_macro_user_id(), vec![])
    .unwrap();

    assert_eq!(request.email_preview_view.to_string(), "sent");
}

#[test]
fn defaults_email_view_to_inbox() {
    let request = SoupInput::Initial(Box::new(SoupInitialInput {
        limit: None,
        expand: None,
        sort_method: None,
        email_view: None,
        filters: None,
    }))
    .into_request(test_macro_user_id(), vec![])
    .unwrap();

    assert_eq!(request.email_preview_view.to_string(), "inbox");
}

#[test]
fn maps_soup_cursor_continuation() {
    let cursor = Base64Str::encode_json(CursorWithValAndFilter {
        id: uuid::Uuid::from_u128(1),
        limit: 25,
        val: CursorVal {
            sort_type: SimpleSortMethod::UpdatedAt,
            last_val: chrono::DateTime::default(),
        },
        filter: item_filters::ast::EntityFilterAst::default(),
    });
    let request = SoupInput::Continuation(SoupContinuationInput {
        cursor: cursor.to_string(),
        expand: Some(false),
        email_view: Some(GraphqlEmailView::Sent),
    })
    .into_request(test_macro_user_id(), vec![])
    .unwrap();

    assert_eq!(request.limit, 25);
    assert!(matches!(request.cursor, SoupQuery::Simple(_)));
    assert_eq!(request.email_preview_view.to_string(), "sent");
    assert!(matches!(request.soup_type, SoupType::UnExpanded));
}

#[test]
fn maps_initial_grouped_input() {
    let request = GroupedSoupInput::Initial(Box::new(GroupedSoupInitialInput {
        group_by: GraphqlGroupByInput {
            field: GraphqlGroupByField::EntityType,
            property_definition_id: None,
            entity_type: None,
        },
        limit: Some(42),
        sort_method: Some(GraphqlSimpleSortMethod::UpdatedAt),
        filters: None,
    }))
    .into_request(test_macro_user_id())
    .unwrap();

    assert_eq!(request.limit, 42);
    assert!(request.grouping.group_key.is_none());
    assert!(matches!(
        request.cursor,
        Query::Sort(SimpleSortMethod::UpdatedAt, _)
    ));
}

#[test]
fn maps_grouped_cursor_continuation() {
    let cursor = Base64Str::encode_json(CursorWithValAndFilter {
        id: uuid::Uuid::from_u128(1),
        limit: 25,
        val: CursorVal {
            sort_type: SimpleSortMethod::UpdatedAt,
            last_val: chrono::DateTime::default(),
        },
        filter: item_filters::ast::EntityFilterAst::default(),
    });
    let request = GroupedSoupInput::Continuation(GroupedSoupContinuationInput {
        group_by: GraphqlGroupByInput {
            field: GraphqlGroupByField::EntityType,
            property_definition_id: None,
            entity_type: None,
        },
        group_key: "document".to_owned(),
        cursor: cursor.to_string(),
    })
    .into_request(test_macro_user_id())
    .unwrap();

    assert_eq!(request.limit, 25);
    assert_eq!(request.grouping.group_key.as_deref(), Some("document"));
    assert!(matches!(request.cursor, Query::Cursor(_)));
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
