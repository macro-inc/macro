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
        sort_direction: None,
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
        sort_direction: None,
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
        sort_direction: None,
    })
    .into_request(test_macro_user_id(), vec![])
    .unwrap();

    assert_eq!(request.limit, 25);
    assert!(matches!(request.cursor, SoupQuery::Simple(_)));
    assert_eq!(request.email_preview_view.to_string(), "sent");
    assert!(matches!(request.soup_type, SoupType::UnExpanded));
}

#[test]
fn maps_notified_at_to_notified_soup_request() {
    let request = SoupInput::Initial(Box::new(SoupInitialInput {
        limit: Some(500),
        expand: None,
        sort_method: Some(GraphqlSimpleSortMethod::NotifiedAt),
        email_view: None,
        filters: None,
        sort_direction: None,
    }))
    .into_request(test_macro_user_id(), vec![])
    .unwrap();

    assert_eq!(request.limit, 500);
    assert!(matches!(request.cursor, SoupQuery::Notified(_)));
}

#[test]
fn continues_a_notified_cursor_as_a_notified_request() {
    let cursor = Base64Str::encode_json(CursorWithValAndFilter {
        id: "00000000-0000-0000-0000-000000000001".to_owned(),
        limit: 500,
        val: CursorVal {
            sort_type: NotifiedAt,
            last_val: chrono::DateTime::default(),
        },
        filter: item_filters::ast::EntityFilterAst::default(),
    });
    let request = SoupInput::Continuation(SoupContinuationInput {
        cursor: cursor.to_string(),
        expand: None,
        email_view: None,
        sort_direction: None,
    })
    .into_request(test_macro_user_id(), vec![])
    .unwrap();

    assert_eq!(request.limit, 500);
    assert!(matches!(request.cursor, SoupQuery::Notified(_)));
}

#[test]
fn rejects_ascending_notified_at() {
    let result = SoupInput::Initial(Box::new(SoupInitialInput {
        limit: None,
        expand: None,
        sort_method: Some(GraphqlSimpleSortMethod::NotifiedAt),
        email_view: None,
        filters: None,
        sort_direction: Some(GraphqlSortDirection::Asc),
    }))
    .into_request(test_macro_user_id(), vec![]);

    assert!(result.is_err());
}

#[test]
fn rejects_grouped_notified_at() {
    let result = GroupedSoupInput::Initial(Box::new(GroupedSoupInitialInput {
        group_by: GraphqlGroupByInput {
            field: GraphqlGroupByField::EntityType,
            property_definition_id: None,
            entity_type: None,
        },
        limit: None,
        sort_method: Some(GraphqlSimpleSortMethod::NotifiedAt),
        filters: None,
    }))
    .into_request(test_macro_user_id());

    assert!(result.is_err());
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
