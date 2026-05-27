use super::list_entities::{NotificationSourceItem, build_summary};
#[allow(unused_imports)]
use super::*;
use ai_toolset::generate_tool_input_schema;
use ai_toolset::tool_object::validate_tool_schema;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use models_soup::{
    document::SoupDocument,
    item::SoupItem,
    notification::{SoupNotification, SoupNotificationSource},
};
use non_empty::IsEmpty;
use uuid::Uuid;

fn test_user_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap()
}

fn soup_document(id: Uuid, name: &str) -> SoupDocument {
    SoupDocument {
        id,
        document_version_id: 1,
        owner_id: test_user_id(),
        name: name.to_string(),
        file_type: None,
        sha: None,
        project_id: None,
        branched_from_id: None,
        branched_from_version_id: None,
        document_family_id: None,
        created_at: DateTime::<Utc>::default(),
        updated_at: DateTime::<Utc>::default(),
        viewed_at: None,
        sub_type: None,
        deleted_at: None,
        properties: Vec::new(),
    }
}

fn soup_notification(id: Uuid, source_entity_id: Uuid) -> SoupNotification {
    let created_at = DateTime::<Utc>::default();

    SoupNotification {
        id,
        owner_id: test_user_id(),
        event_type: "test_event".to_string(),
        source_entity_type: EntityType::Document,
        source_entity_id: source_entity_id.to_string(),
        sent: true,
        done: false,
        created_at,
        viewed_at: None,
        updated_at: created_at,
        deleted_at: None,
        metadata: serde_json::json!({}),
        sender_id: None,
        source: None,
    }
}

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
    assert!(matches!(list.sort_by, SortBy::RecentlyUpdated));
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
        EntityItem::Notification {
            id: Uuid::new_v4(),
            event_type: "document_shared".to_string(),
            source_entity_type: "document".to_string(),
            source_entity_id: Uuid::new_v4().to_string(),
            source: None,
        },
    ];

    let summary = build_summary(&items, false, &None);
    assert!(summary.contains("2 documents"));
    assert!(summary.contains("1 email"));
    assert!(summary.contains("1 notification"));
    assert!(summary.starts_with("Found"));

    let summary = build_summary(&items, true, &None);
    assert!(summary.contains("More items available"));
}

#[test]
fn test_notification_item_maps_fields_and_source() {
    let notification_id = Uuid::new_v4();
    let source_id = Uuid::new_v4();
    let mut notification = soup_notification(notification_id, source_id);
    notification.source = Some(SoupNotificationSource::Document(soup_document(
        source_id,
        "source.md",
    )));

    let item = EntityItem::from(SoupItem::Notification(Box::new(notification)));
    let EntityItem::Notification {
        id,
        event_type,
        source_entity_type,
        source_entity_id,
        source: Some(source),
    } = item
    else {
        panic!("expected notification item with source");
    };

    assert_eq!(id, notification_id);
    assert_eq!(event_type, "test_event");
    assert_eq!(source_entity_type, "document");
    assert_eq!(source_entity_id, source_id.to_string());

    let NotificationSourceItem::Document { id, name } = source else {
        panic!("expected document source");
    };
    assert_eq!(id, source_id);
    assert_eq!(name, "source.md");
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
    let generator = ai_toolset::tool_object::minimized_output_schema_generator();
    let schema = generator.into_root_schema_for::<ListEntitiesResponse>();
    println!("{}", serde_json::to_string_pretty(&schema).unwrap());
}
