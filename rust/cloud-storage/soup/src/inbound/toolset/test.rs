use super::list_entities::build_summary;
#[allow(unused_imports)]
use super::*;
use ai_toolset::schema::generate_validated_input_schema;
use chrono::Utc;
use models_soup::{foreign_entity::SoupForeignEntity, item::SoupItem};
use non_empty::IsEmpty;
use uuid::Uuid;

#[test]
fn test_list_entities_schema_validation() {
    let result = generate_validated_input_schema::<ListEntities>();
    assert!(result.is_ok(), "{:?}", result);

    let validated = result.unwrap();
    assert_eq!(
        validated.name, "ListEntities",
        "Tool name should match the schemars title"
    );
    assert!(
        validated
            .description
            .contains("Browse the user's Macro workspace"),
        "Description should contain expected text"
    );
}

#[test]
fn test_list_entities_schema_guides_macro_task_queries() {
    let validated = generate_validated_input_schema::<ListEntities>().unwrap();
    let schema_json = serde_json::to_string(&validated.schema).unwrap();

    assert!(
        schema_json.contains("prefer this tool over external task trackers such as Linear"),
        "schema should prefer Macro tasks over Linear for unqualified task requests"
    );
    assert!(
        schema_json.contains("00000001-0000-0000-0000-000000000001"),
        "schema should document the Assignees property id"
    );
    assert!(
        schema_json.contains("00000001-0000-0000-0002-000000000004"),
        "schema should document the Completed status option id"
    );
}

#[test]
fn test_macro_task_completed_assigned_to_me_filter_deserializes() {
    let input = serde_json::json!({
        "includeTypes": ["document"],
        "df": {
            "&": [
                { "l": { "dst": "task" } },
                {
                    "&": [
                        { "l": { "ua": { "gte": "2026-06-11T04:00:00Z" } } },
                        { "l": { "ua": { "lt": "2026-06-12T04:00:00Z" } } }
                    ]
                }
            ]
        },
        "propf": {
            "&": [
                {
                    "l": {
                        "pd": "00000001-0000-0000-0000-000000000002",
                        "et": "TASK",
                        "v": { "so": "00000001-0000-0000-0002-000000000004" }
                    }
                },
                {
                    "l": {
                        "pd": "00000001-0000-0000-0000-000000000001",
                        "et": "TASK",
                        "v": { "er": "macro|eric@example.com" }
                    }
                }
            ]
        },
        "sortBy": "recently_updated"
    });

    let list: ListEntities = serde_json::from_value(input).unwrap();
    let ast = list.entity_filter_ast();

    assert_eq!(
        list.effective_include_types(),
        Some(vec![ItemType::Document])
    );
    assert!(ast.document_filter.is_some());
    assert!(ast.properties_filter.is_some());
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
        "fef": {"l": {"feid": "github:123"}},
        "limit": 100,
        "pf": {"l": {"pid": "00000000-0000-0000-0000-000000000000"}},
        "sortBy": "recently_updated"
    });

    let list: ListEntities = serde_json::from_value(input).unwrap();
    let ast = list.entity_filter_ast();

    assert_eq!(list.limit, Some(100));
    assert!(matches!(list.sort_by, SortBy::RecentlyUpdated));
    assert!(!ast.is_empty());
    assert!(ast.foreign_entity_filter.is_some());
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
    assert!(ast.foreign_entity_filter.is_some());
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
    assert!(ast.foreign_entity_filter.is_some());
    assert_eq!(
        list.effective_include_types(),
        Some(vec![ItemType::Document])
    );
}

#[test]
fn test_include_types_foreign_entity_without_filter_keeps_foreign_entity_unfiltered() {
    let list: ListEntities = serde_json::from_value(serde_json::json!({
        "includeTypes": ["foreign_entity"]
    }))
    .unwrap();

    let ast = list.entity_filter_ast();
    assert!(ast.document_filter.is_some());
    assert!(ast.project_filter.is_some());
    assert!(ast.chat_filter.is_some());
    assert!(ast.email_filter.tree.is_some());
    assert!(ast.channel_filter.is_some());
    assert!(ast.call_filter.is_some());
    assert!(ast.foreign_entity_filter.is_none());
    assert_eq!(
        list.effective_include_types(),
        Some(vec![ItemType::ForeignEntity])
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
        EntityItem::ForeignEntity {
            id: Uuid::new_v4(),
            foreign_entity_id: "github:123".to_string(),
            foreign_entity_source: "github".to_string(),
            metadata: serde_json::json!({ "name": "Issue 123" }),
        },
    ];

    let summary = build_summary(&items, false, &None);
    assert!(summary.contains("2 documents"));
    assert!(summary.contains("1 email"));
    assert!(summary.contains("1 foreign entity"));
    assert!(summary.starts_with("Found"));

    let summary = build_summary(&items, true, &None);
    assert!(summary.contains("More items available"));
}

#[test]
fn test_converts_foreign_entity_soup_item() {
    let id = Uuid::new_v4();
    let metadata = serde_json::json!({ "name": "Issue 123" });
    let item = SoupItem::ForeignEntity(SoupForeignEntity {
        id,
        foreign_entity_id: "github:123".to_string(),
        foreign_entity_source: "github".to_string(),
        metadata: metadata.clone(),
        stored_for_id: "team-123".to_string(),
        stored_for_auth_entity: "team".to_string(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    });

    let entity_item = EntityItem::from(item);

    match entity_item {
        EntityItem::ForeignEntity {
            id: actual_id,
            foreign_entity_id,
            foreign_entity_source,
            metadata: actual_metadata,
        } => {
            assert_eq!(actual_id, id);
            assert_eq!(foreign_entity_id, "github:123");
            assert_eq!(foreign_entity_source, "github");
            assert_eq!(actual_metadata, metadata);
        }
        other => panic!("expected foreign entity item, got {other:?}"),
    }
}

// run `cargo test -p soup inbound::toolset::test::print_input_schema -- --nocapture --include-ignored`
#[test]
#[ignore = "prints the input schema"]
fn print_input_schema() {
    let schema = generate_validated_input_schema::<ListEntities>()
        .unwrap()
        .schema;
    println!("{}", serde_json::to_string_pretty(&schema).unwrap());
}

// run `cargo test -p soup inbound::toolset::test::print_output_schema -- --nocapture --include-ignored`
#[test]
#[ignore = "prints the output schema"]
fn print_output_schema() {
    let schema = schemars::schema_for!(ListEntitiesResponse);
    println!("{}", serde_json::to_string_pretty(&schema).unwrap());
}
