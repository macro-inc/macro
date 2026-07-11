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
    let ast = list.entity_filter_ast(None);

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
    let ast = list.entity_filter_ast(None);

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

    let ast = list.entity_filter_ast(None);
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

    let ast = list.entity_filter_ast(None);
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

    let ast = list.entity_filter_ast(None);
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
            file_type: Some("md".to_string()),
            sub_type: None,
            tags: vec![],
        },
        EntityItem::Document {
            id: Uuid::new_v4(),
            name: "other.md".to_string(),
            file_type: Some("md".to_string()),
            sub_type: Some("task".to_string()),
            tags: vec![],
        },
        EntityItem::Email {
            id: Uuid::new_v4(),
            subject: Some("Hello".to_string()),
            snippet: Some("Can you review this?".to_string()),
            sender_name: Some("Ada".to_string()),
            sender_email: Some("ada@example.com".to_string()),
            inbox_visible: true,
            is_read: false,
            is_draft: false,
            tags: vec![],
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

    let entity_item = EntityItem::from_soup_item(item, &Default::default());

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

#[test]
fn test_tags_arg_deserializes_and_documents_match_modes() {
    let validated = generate_validated_input_schema::<ListEntities>().unwrap();
    let schema_json = serde_json::to_string(&validated.schema).unwrap();
    assert!(
        schema_json.contains("any of them by default"),
        "tags arg should document the default any-of combining"
    );
    assert!(
        schema_json.contains("tagsMatch"),
        "tags arg should point at tagsMatch for all-of combining"
    );
    assert!(
        schema_json.contains("is ambiguous"),
        "tagsMatch arg should document the all-mode scope requirement"
    );
    assert!(
        schema_json.contains("ListTags"),
        "tags arg should point at ListTags"
    );

    let list: ListEntities = serde_json::from_value(serde_json::json!({
        "tags": [
            { "label": "bug-report" },
            { "label": "urgent", "scope": "team" }
        ]
    }))
    .unwrap();
    let tags = list.tags.unwrap();
    assert_eq!(tags.len(), 2);
    assert_eq!(tags[0].label, "bug-report");
    assert!(tags[0].scope.is_none());
    assert_eq!(
        tags[1].scope,
        Some(models_properties::service::tag_sets::TagScope::Team)
    );
    assert_eq!(
        list.tags_match,
        models_properties::service::tag_sets::TagMatch::Any,
        "tagsMatch defaults to any"
    );

    let list: ListEntities = serde_json::from_value(serde_json::json!({
        "tags": [{ "label": "bug-report" }],
        "tagsMatch": "all"
    }))
    .unwrap();
    assert_eq!(
        list.tags_match,
        models_properties::service::tag_sets::TagMatch::All
    );
}

#[test]
fn test_tag_filter_expr_ands_with_existing_propf() {
    use filter_ast::Expr;
    use item_filters::ast::properties::{PropertiesLiteral, PropertyMatchValue};

    let list: ListEntities = serde_json::from_value(serde_json::json!({
        "propf": {
            "l": {
                "pd": "00000001-0000-0000-0000-000000000002",
                "et": "TASK",
                "v": { "so": "00000001-0000-0000-0002-000000000004" }
            }
        }
    }))
    .unwrap();

    let tag_expr = Expr::val(PropertiesLiteral {
        property_definition_id: Uuid::new_v4(),
        entity_type: None,
        value: PropertyMatchValue::SelectOption(Uuid::new_v4()),
    });

    let ast = list.entity_filter_ast(Some(tag_expr));
    let tree = serde_json::to_value(ast.properties_filter.unwrap().as_ref()).unwrap();
    let and = tree.get("&").expect("tag filter should AND with propf");
    assert_eq!(and.as_array().unwrap().len(), 2);

    // Without a propf, the tag expr becomes the whole tree.
    let list = ListEntities::default();
    let tag_expr = Expr::val(PropertiesLiteral {
        property_definition_id: Uuid::new_v4(),
        entity_type: None,
        value: PropertyMatchValue::SelectOption(Uuid::new_v4()),
    });
    let ast = list.entity_filter_ast(Some(tag_expr));
    let tree = serde_json::to_value(ast.properties_filter.unwrap().as_ref()).unwrap();
    assert!(tree.get("l").is_some());
}

#[test]
fn test_from_soup_item_resolves_tags_via_caller_map() {
    use macro_user_id::user_id::MacroUserIdStr;
    use models_properties::service::property_definition::PropertyDefinition;
    use models_properties::service::property_value::PropertyValue;
    use models_properties::service::tag_sets::{AppliedTag, TagScope};
    use models_properties::{DataType, PropertyOwner};
    use models_soup::SoupProperty;
    use models_soup::document::SoupDocument;
    use std::collections::HashMap;

    let known_option = Uuid::new_v4();
    let unknown_option = Uuid::new_v4();
    let definition_id = Uuid::new_v4();

    let now = Utc::now();
    let tag_property = SoupProperty {
        definition: PropertyDefinition {
            id: definition_id,
            owner: PropertyOwner::User {
                user_id: "user1".to_string(),
            },
            display_name: "Tags".to_string(),
            data_type: DataType::Tag,
            is_multi_select: true,
            specific_entity_type: None,
            created_at: now,
            updated_at: now,
            is_system: false,
            is_metadata: false,
        },
        value: Some(PropertyValue::SelectOption(vec![
            known_option,
            unknown_option,
        ])),
    };

    let doc = SoupDocument {
        id: Uuid::new_v4(),
        document_version_id: 1,
        owner_id: MacroUserIdStr::try_from("macro|user1@test.com".to_string()).unwrap(),
        name: "tagged.md".to_string(),
        file_type: None,
        sha: None,
        project_id: None,
        branched_from_id: None,
        branched_from_version_id: None,
        document_family_id: None,
        created_at: now,
        updated_at: now,
        viewed_at: None,
        sub_type: None,
        deleted_at: None,
        properties: vec![tag_property],
    };

    let tag_map: HashMap<_, _> = [(
        known_option,
        AppliedTag {
            label: "bug-report".to_string(),
            scope: TagScope::Personal,
        },
    )]
    .into();

    let entity_item = EntityItem::from_soup_item(SoupItem::Document(doc), &tag_map);
    match entity_item {
        EntityItem::Document { tags, .. } => {
            // The unknown option (another user's tag) is dropped.
            assert_eq!(
                tags,
                vec![AppliedTag {
                    label: "bug-report".to_string(),
                    scope: TagScope::Personal,
                }]
            );
        }
        other => panic!("expected document item, got {other:?}"),
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
