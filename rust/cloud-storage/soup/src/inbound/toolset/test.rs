use super::list_entities::build_summary;
#[allow(unused_imports)]
use super::*;
use ai::generate_tool_input_schema;
use ai::tool::types::tool_object::validate_tool_schema;
use non_empty::IsEmpty;
use uuid::Uuid;

#[test]
fn test_list_entities_schema_validation() {
    let schema = generate_tool_input_schema!(ListEntities);

    let result = validate_tool_schema(&schema);
    assert!(result.is_ok(), "{:?}", result);

    let (name, description) = result.unwrap();
    assert_eq!(
        name, "ListEntities",
        "Tool name should match the schemars title"
    );
    assert!(
        description.contains("Browse the user's workspace"),
        "Description should contain expected text"
    );
}

#[test]
fn test_default_values() {
    let list = ListEntities::default();
    assert!(list.include_types.is_none());
    assert!(matches!(list.sort_by, SortBy::RecentlyViewed));
}

#[test]
fn test_full_ast_input_deserializes() {
    let input = serde_json::json!({
        "callf": {"l": {"CallId": "00000000-0000-0000-0000-000000000000"}},
        "cf": {"l": {"cid": "00000000-0000-0000-0000-000000000000"}},
        "chanf": {"l": {"ChannelId": "00000000-0000-0000-0000-000000000000"}},
        "df": {"l": {"id": "00000000-0000-0000-0000-000000000000"}},
        "ef": {"&": [
            {"l": {"Importance": true}},
            {"l": {"Shared": "exclude"}}
        ]},
        "emailView": "inbox",
        "limit": 100,
        "pf": {"l": {"pid": "00000000-0000-0000-0000-000000000000"}},
        "sortBy": "recently_updated"
    });

    let list: ListEntities = serde_json::from_value(input).unwrap();
    assert_eq!(list.limit, Some(100));
    assert!(matches!(list.sort_by, SortBy::RecentlyUpdated));
    assert!(!list.entity_filter_ast().is_empty());
    assert_eq!(
        list.email_view().unwrap(),
        email::domain::models::PreviewView::default()
    );
}

#[test]
fn test_email_preset_defaults_to_email_results() {
    let list: ListEntities = serde_json::from_value(serde_json::json!({
        "emailPreset": "signal"
    }))
    .unwrap();

    let ast = list.entity_filter_ast();
    assert!(ast.email_filter.tree.is_some());
    assert!(ast.document_filter.is_some());
    assert!(ast.project_filter.is_some());
    assert!(ast.chat_filter.is_some());
    assert!(ast.channel_filter.is_some());
    assert!(ast.call_filter.is_some());
    assert_eq!(list.effective_include_types(), Some(vec![ItemType::Email]));
}

#[test]
fn test_include_types_document_without_filter_keeps_document_unfiltered() {
    let list: ListEntities = serde_json::from_value(serde_json::json!({
        "includeTypes": ["document"]
    }))
    .unwrap();

    let ast = list.entity_filter_ast();
    assert!(ast.document_filter.is_none());
    assert_eq!(
        list.effective_include_types(),
        Some(vec![ItemType::Document])
    );
}

#[test]
fn test_build_summary_empty() {
    let summary = build_summary(&[], false, &None);
    assert_eq!(summary, "No items found in workspace.");

    let summary = build_summary(&[], false, &Some(vec![ItemType::Document]));
    assert_eq!(summary, "No items found matching the specified types.");
}

#[test]
fn test_build_summary_with_items() {
    let items = vec![
        EntityItem::Document {
            id: Uuid::new_v4(),
            name: "test.md".to_string(),
        },
        EntityItem::Document {
            id: Uuid::new_v4(),
            name: "other.md".to_string(),
        },
        EntityItem::Email {
            id: Uuid::new_v4(),
            subject: Some("Hello".to_string()),
        },
    ];

    let summary = build_summary(&items, false, &None);
    assert!(summary.contains("2 documents"));
    assert!(summary.contains("1 email"));
    assert!(summary.starts_with("Found"));

    let summary = build_summary(&items, true, &None);
    assert!(summary.contains("More items available"));
}

// run `cargo test -p soup inbound::toolset::test::print_input_schema -- --nocapture --include-ignored`
#[test]
#[ignore = "prints the input schema"]
fn print_input_schema() {
    let schema = generate_tool_input_schema!(ListEntities);
    println!("{}", serde_json::to_string_pretty(&schema).unwrap());
}

// run `cargo test -p soup inbound::toolset::test::print_output_schema -- --nocapture --include-ignored`
#[test]
#[ignore = "prints the output schema"]
fn print_output_schema() {
    let generator = ai::tool::minimized_output_schema_generator();
    let schema = generator.into_root_schema_for::<ListEntitiesResponse>();
    println!("{}", serde_json::to_string_pretty(&schema).unwrap());
}
