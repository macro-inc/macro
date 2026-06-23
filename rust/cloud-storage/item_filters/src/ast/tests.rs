use std::str::FromStr;

use super::*;
use crate::{CallFilters, CallStatus, ForeignEntityFilters, PropertyFilter};
use cool_asserts::assert_matches;
use model_file_type::FileType;
use serde_json::json;
use uuid::Uuid;

use super::properties;

#[test]
fn it_works_with_file_type() {
    let res: Result<Vec<_>, _> = ["pdf", "md", "txt", "html"]
        .into_iter()
        .map(FileType::from_str)
        .collect();

    assert_matches!(
        res.unwrap(),
        [FileType::Pdf, FileType::Md, FileType::Txt, FileType::Html]
    );
}

#[test]
fn it_expands_filters() {
    let document_id = Uuid::new_v4();
    let project_id = Uuid::new_v4();
    let f = EntityFilters {
        document_filters: DocumentFilters {
            file_types: vec!["pdf".to_string(), "txt".to_string()],
            document_ids: vec![document_id.to_string()],
            project_ids: vec![project_id.to_string()],
            owners: vec!["macro|hello@test.com".to_string()],
            importance: Some(true),
            ..Default::default()
        },
        ..Default::default()
    };

    let ast = Arc::into_inner(
        EntityFilterAst::new_from_filters(f)
            .unwrap()
            .unwrap()
            .document_filter
            .unwrap(),
    )
    .unwrap();

    let json = serde_json::to_value(ast).unwrap();
    let exp = json!({
        "&": [
            {
                "&": [
                    {
                        "&": [
                            {
                                "&": [
                                    {
                                        "|": [
                                            {
                                                "l": {
                                                    "ft": "pdf",
                                                }
                                            },
                                            {
                                                "l": {
                                                    "ft": "txt"
                                                }
                                            }
                                        ]
                                    },
                                    {
                                        "l": {
                                            "id": document_id
                                        }
                                    }
                                ]
                            },
                            {
                                "l": {
                                    "pid": project_id
                                }
                            }
                        ]
                    },
                    {
                        "l": {
                            "o": "macro|hello@test.com"
                        }
                    }
                ]
            },
            {
                "l": {
                    "imp": true
                }
            }
        ]
    });

    assert_eq!(json, exp);
}

#[test]
fn it_expands_file_associations() {
    let f = EntityFilters {
        document_filters: DocumentFilters {
            file_types: vec!["assoc:vector".to_string()],
            document_ids: vec![],
            project_ids: vec![],
            owners: vec![],
            ..Default::default()
        },
        ..Default::default()
    };

    let ast = Arc::into_inner(
        EntityFilterAst::new_from_filters(f)
            .unwrap()
            .unwrap()
            .document_filter
            .unwrap(),
    )
    .unwrap();

    let json = serde_json::to_value(ast).unwrap();
    println!("{}", serde_json::to_string_pretty(&json).unwrap());

    let exp = serde_json::json!({
      "|": [
        {
          "|": [
            {
              "|": [
                {
                  "|": [
                    {
                      "l": {
                        "ft": "ai"
                      }
                    },
                    {
                      "l": {
                        "ft": "eps"
                      }
                    }
                  ]
                },
                {
                  "l": {
                    "ft": "ps"
                  }
                }
              ]
            },
            {
              "l": {
                "ft": "dxf"
              }
            }
          ]
        },
        {
          "l": {
            "ft": "dwg"
          }
        }
      ]
    });
    assert_eq!(json, exp);
}

#[test]
fn it_expands_other_association() {
    let f = EntityFilters {
        document_filters: DocumentFilters {
            file_types: vec!["assoc:other".to_string()],
            document_ids: vec![],
            project_ids: vec![],
            owners: vec![],
            ..Default::default()
        },
        ..Default::default()
    };

    let ast = Arc::into_inner(
        EntityFilterAst::new_from_filters(f)
            .unwrap()
            .unwrap()
            .document_filter
            .unwrap(),
    )
    .unwrap();

    let json = serde_json::to_string(&ast).unwrap();

    assert_eq!(json.trim(), include_str!("tests/other.json").trim());
}

#[test]
fn it_expands_email_thread_ids() {
    let thread_id = Uuid::new_v4();
    let f = EntityFilters {
        email_filters: crate::EmailFilters {
            email_thread_ids: vec![thread_id.to_string()],
            ..Default::default()
        },
        ..Default::default()
    };

    let ast = Arc::into_inner(
        EntityFilterAst::new_from_filters(f)
            .unwrap()
            .unwrap()
            .email_filter
            .tree
            .unwrap(),
    )
    .unwrap();

    let json = serde_json::to_value(ast).unwrap();
    let exp = json!({
        "l": {
            "ThreadId": thread_id
        }
    });

    assert_eq!(json, exp);
}

#[test]
fn it_expands_email_thread_ids_with_sender() {
    let thread_id = Uuid::new_v4();
    let f = EntityFilters {
        email_filters: crate::EmailFilters {
            senders: vec!["test@example.com".to_string()],
            email_thread_ids: vec![thread_id.to_string()],
            ..Default::default()
        },
        ..Default::default()
    };

    let ast = Arc::into_inner(
        EntityFilterAst::new_from_filters(f)
            .unwrap()
            .unwrap()
            .email_filter
            .tree
            .unwrap(),
    )
    .unwrap();

    let json = serde_json::to_value(ast).unwrap();
    // Should be AND of sender and thread_id
    assert!(json.get("&").is_some());
}

#[test]
fn it_expands_channel_types() {
    let f = EntityFilters {
        channel_filters: crate::ChannelFilters {
            channel_types: vec!["public".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };

    let ast = Arc::into_inner(
        EntityFilterAst::new_from_filters(f)
            .unwrap()
            .unwrap()
            .channel_filter
            .unwrap(),
    )
    .unwrap();

    let json = serde_json::to_value(ast).unwrap();
    let exp = json!({
        "l": {
            "ChannelType": "public"
        }
    });

    assert_eq!(json, exp);
}

#[test]
fn it_expands_multiple_channel_types() {
    let f = EntityFilters {
        channel_filters: crate::ChannelFilters {
            channel_types: vec!["public".to_string(), "direct_message".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };

    let ast = Arc::into_inner(
        EntityFilterAst::new_from_filters(f)
            .unwrap()
            .unwrap()
            .channel_filter
            .unwrap(),
    )
    .unwrap();

    let json = serde_json::to_value(ast).unwrap();
    // Should be OR of two channel types
    assert!(json.get("|").is_some());
}

#[test]
fn it_expands_channel_type_with_channel_id() {
    let channel_id = Uuid::new_v4();
    let f = EntityFilters {
        channel_filters: crate::ChannelFilters {
            channel_ids: vec![channel_id.to_string()],
            channel_types: vec!["private".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };

    let ast = Arc::into_inner(
        EntityFilterAst::new_from_filters(f)
            .unwrap()
            .unwrap()
            .channel_filter
            .unwrap(),
    )
    .unwrap();

    let json = serde_json::to_value(ast).unwrap();
    // Should be AND of channel_id and channel_type
    assert!(json.get("&").is_some());
}

#[test]
fn it_expands_channel_thread_filters() {
    let thread_id = Uuid::new_v4();
    let channel_id = Uuid::new_v4();
    let f = EntityFilters {
        channel_thread_filters: crate::ChannelThreadFilters {
            thread_ids: vec![thread_id.to_string()],
            channel_ids: vec![channel_id.to_string()],
            root_sender_ids: vec!["macro|hello@test.com".to_string()],
        },
        ..Default::default()
    };

    let ast = Arc::into_inner(
        EntityFilterAst::new_from_filters(f)
            .unwrap()
            .unwrap()
            .channel_thread_filter
            .unwrap(),
    )
    .unwrap();

    let json = serde_json::to_value(ast).unwrap();
    assert!(json.get("&").is_some());
}

#[test]
fn it_expands_single_channel_thread_id() {
    let thread_id = Uuid::new_v4();
    let f = EntityFilters {
        channel_thread_filters: crate::ChannelThreadFilters {
            thread_ids: vec![thread_id.to_string()],
            ..Default::default()
        },
        ..Default::default()
    };

    let ast = Arc::into_inner(
        EntityFilterAst::new_from_filters(f)
            .unwrap()
            .unwrap()
            .channel_thread_filter
            .unwrap(),
    )
    .unwrap();

    let json = serde_json::to_value(ast).unwrap();
    let exp = json!({
        "l": {
            "ThreadId": thread_id
        }
    });

    assert_eq!(json, exp);
}

#[test]
fn it_expands_document_notification_filters() {
    let f = EntityFilters {
        document_filters: DocumentFilters {
            notification_filters: crate::NotificationFilters {
                done: Some(false),
                seen: Some(false),
            },
            ..Default::default()
        },
        ..Default::default()
    };

    let ast = Arc::into_inner(
        EntityFilterAst::new_from_filters(f)
            .unwrap()
            .unwrap()
            .document_filter
            .unwrap(),
    )
    .unwrap();

    let json = serde_json::to_string(&ast).unwrap();
    assert!(json.contains(r#""nd":false"#));
    assert!(json.contains(r#""ns":false"#));
}

#[test]
fn it_expands_document_task_include_cbm_atm_nc_as_or() {
    let f = EntityFilters {
        document_filters: DocumentFilters {
            file_types: vec!["pdf".to_string()],
            task_filters: crate::TaskFilters {
                include_cbm_atm_nc: Some(true),
            },
            ..Default::default()
        },
        ..Default::default()
    };

    let ast = Arc::into_inner(
        EntityFilterAst::new_from_filters(f)
            .unwrap()
            .unwrap()
            .document_filter
            .unwrap(),
    )
    .unwrap();

    let json = serde_json::to_value(ast).unwrap();
    assert!(
        json.get("|").is_some(),
        "include flag should OR with base filters"
    );
    let as_text = serde_json::to_string(&json).unwrap();
    assert!(as_text.contains(r#""cbm":true"#));
}

#[test]
fn task_include_cbm_atm_nc_false_is_noop() {
    let f = EntityFilters {
        document_filters: DocumentFilters {
            task_filters: crate::TaskFilters {
                include_cbm_atm_nc: Some(false),
            },
            ..Default::default()
        },
        ..Default::default()
    };

    assert!(
        EntityFilterAst::new_from_filters(f).unwrap().is_none(),
        "false should be equivalent to not setting the include flag"
    );
}

#[test]
fn it_expands_single_property_select_option() {
    let prop_def_id = Uuid::new_v4();
    let option_id = Uuid::new_v4();
    let f = EntityFilters {
        property_filters: vec![PropertyFilter {
            property_definition_id: prop_def_id.to_string(),
            entity_type: Some("TASK".to_string()),
            option_ids: vec![option_id.to_string()],
            entity_ids: vec![],
        }],
        ..Default::default()
    };

    let ast_result = EntityFilterAst::new_from_filters(f).unwrap().unwrap();
    assert!(ast_result.properties_filter.is_some());
}

#[test]
fn it_expands_multiple_option_ids_as_or() {
    let prop_def_id = Uuid::new_v4();
    let option_a = Uuid::new_v4();
    let option_b = Uuid::new_v4();
    let f = EntityFilters {
        property_filters: vec![PropertyFilter {
            property_definition_id: prop_def_id.to_string(),
            entity_type: Some("TASK".to_string()),
            option_ids: vec![option_a.to_string(), option_b.to_string()],
            entity_ids: vec![],
        }],
        ..Default::default()
    };

    let ast_result = EntityFilterAst::new_from_filters(f).unwrap().unwrap();
    let ast = Arc::into_inner(ast_result.properties_filter.unwrap()).unwrap();

    let json = serde_json::to_value(ast).unwrap();
    // Two options should be OR'd together
    assert!(
        json.get("|").is_some(),
        "multiple option_ids should OR together"
    );
}

#[test]
fn it_expands_entity_ref_filter() {
    let prop_def_id = Uuid::new_v4();
    let entity_id = "macro|user@test.com".to_string();
    let f = EntityFilters {
        property_filters: vec![PropertyFilter {
            property_definition_id: prop_def_id.to_string(),
            entity_type: Some("TASK".to_string()),
            option_ids: vec![],
            entity_ids: vec![entity_id.clone()],
        }],
        ..Default::default()
    };

    let ast_result = EntityFilterAst::new_from_filters(f).unwrap().unwrap();
    let ast = Arc::into_inner(ast_result.properties_filter.unwrap()).unwrap();

    let json = serde_json::to_value(ast).unwrap();
    let exp = json!({
        "l": {
            "pd": prop_def_id,
            "et": "TASK",
            "v": { "er": entity_id }
        }
    });

    assert_eq!(json, exp);
}

#[test]
fn it_ands_multiple_property_filters() {
    let status_id = Uuid::new_v4();
    let priority_id = Uuid::new_v4();
    let option_a = Uuid::new_v4();
    let option_b = Uuid::new_v4();
    let f = EntityFilters {
        property_filters: vec![
            PropertyFilter {
                property_definition_id: status_id.to_string(),
                entity_type: Some("TASK".to_string()),
                option_ids: vec![option_a.to_string()],
                entity_ids: vec![],
            },
            PropertyFilter {
                property_definition_id: priority_id.to_string(),
                entity_type: Some("TASK".to_string()),
                option_ids: vec![option_b.to_string()],
                entity_ids: vec![],
            },
        ],
        ..Default::default()
    };

    let ast_result = EntityFilterAst::new_from_filters(f).unwrap().unwrap();
    let ast = Arc::into_inner(ast_result.properties_filter.unwrap()).unwrap();

    let json = serde_json::to_value(ast).unwrap();
    // Two property filters should be AND'd together
    assert!(
        json.get("&").is_some(),
        "multiple property filters should AND together"
    );
}

#[test]
fn it_ors_mixed_option_and_entity_ref_within_single_filter() {
    let prop_def_id = Uuid::new_v4();
    let option_id = Uuid::new_v4();
    let entity_id = "some-entity-id".to_string();
    let f = EntityFilters {
        property_filters: vec![PropertyFilter {
            property_definition_id: prop_def_id.to_string(),
            entity_type: Some("TASK".to_string()),
            option_ids: vec![option_id.to_string()],
            entity_ids: vec![entity_id],
        }],
        ..Default::default()
    };

    let ast_result = EntityFilterAst::new_from_filters(f).unwrap().unwrap();
    let ast = Arc::into_inner(ast_result.properties_filter.unwrap()).unwrap();

    let json = serde_json::to_value(ast).unwrap();
    // option_id and entity_id should be OR'd within the same filter
    assert!(
        json.get("|").is_some(),
        "option_ids and entity_ids within one filter should OR together"
    );
}

#[test]
fn empty_property_filters_produce_no_ast() {
    let f = EntityFilters {
        property_filters: vec![],
        ..Default::default()
    };

    assert!(
        EntityFilterAst::new_from_filters(f).unwrap().is_none(),
        "empty property_filters should produce no AST"
    );
}

#[test]
fn property_filter_with_empty_values_produce_no_ast() {
    let prop_def_id = Uuid::new_v4();
    let f = EntityFilters {
        property_filters: vec![PropertyFilter {
            property_definition_id: prop_def_id.to_string(),
            entity_type: Some("TASK".to_string()),
            option_ids: vec![],
            entity_ids: vec![],
        }],
        ..Default::default()
    };

    assert!(
        EntityFilterAst::new_from_filters(f).unwrap().is_none(),
        "property filter with no values should produce no AST"
    );
}

#[test]
fn it_expands_property_filter_without_entity_type() {
    let prop_def_id = Uuid::new_v4();
    let option_id = Uuid::new_v4();
    let f = EntityFilters {
        property_filters: vec![PropertyFilter {
            property_definition_id: prop_def_id.to_string(),
            entity_type: None,
            option_ids: vec![option_id.to_string()],
            entity_ids: vec![],
        }],
        ..Default::default()
    };

    let ast_result = EntityFilterAst::new_from_filters(f).unwrap().unwrap();
    let ast = Arc::into_inner(ast_result.properties_filter.unwrap()).unwrap();

    let json = serde_json::to_value(ast).unwrap();
    let exp = json!({
        "l": {
            "pd": prop_def_id,
            "v": { "so": option_id }
        }
    });

    // entity_type should be absent in serialization when None
    assert_eq!(json, exp);
}

#[test]
fn it_expands_property_filter_with_entity_type() {
    let prop_def_id = Uuid::new_v4();
    let option_id = Uuid::new_v4();
    let f = EntityFilters {
        property_filters: vec![PropertyFilter {
            property_definition_id: prop_def_id.to_string(),
            entity_type: Some("TASK".to_string()),
            option_ids: vec![option_id.to_string()],
            entity_ids: vec![],
        }],
        ..Default::default()
    };

    let ast_result = EntityFilterAst::new_from_filters(f).unwrap().unwrap();
    let ast = Arc::into_inner(ast_result.properties_filter.unwrap()).unwrap();

    let json = serde_json::to_value(ast).unwrap();
    let exp = json!({
        "l": {
            "pd": prop_def_id,
            "et": "TASK",
            "v": { "so": option_id }
        }
    });

    // entity_type should be present when Some
    assert_eq!(json, exp);
}

#[test]
fn it_expands_single_document_sub_type() {
    let f = EntityFilters {
        document_filters: DocumentFilters {
            sub_types: vec!["task".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };

    let ast = Arc::into_inner(
        EntityFilterAst::new_from_filters(f)
            .unwrap()
            .unwrap()
            .document_filter
            .unwrap(),
    )
    .unwrap();

    let json = serde_json::to_value(ast).unwrap();
    let exp = json!({
        "l": {
            "dst": "task"
        }
    });

    assert_eq!(json, exp);
}

#[test]
fn it_expands_sub_type_with_file_type() {
    let f = EntityFilters {
        document_filters: DocumentFilters {
            file_types: vec!["pdf".to_string()],
            sub_types: vec!["task".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };

    let ast = Arc::into_inner(
        EntityFilterAst::new_from_filters(f)
            .unwrap()
            .unwrap()
            .document_filter
            .unwrap(),
    )
    .unwrap();

    let json = serde_json::to_value(ast).unwrap();
    // Should be AND of file_type and sub_type
    assert!(
        json.get("&").is_some(),
        "file_type and sub_type should AND together"
    );
    let as_text = serde_json::to_string(&json).unwrap();
    assert!(as_text.contains(r#""dst":"task""#));
    assert!(as_text.contains(r#""ft":"pdf""#));
}

#[test]
fn invalid_sub_type_returns_error() {
    let f = EntityFilters {
        document_filters: DocumentFilters {
            sub_types: vec!["nonexistent".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };

    assert!(
        EntityFilterAst::new_from_filters(f).is_err(),
        "invalid sub type should return an error"
    );
}

#[test]
fn empty_sub_types_produce_no_ast() {
    let f = EntityFilters {
        document_filters: DocumentFilters {
            sub_types: vec![],
            ..Default::default()
        },
        ..Default::default()
    };

    assert!(
        EntityFilterAst::new_from_filters(f).unwrap().is_none(),
        "empty sub_types should produce no AST"
    );
}

#[test]
fn invalid_entity_type_returns_error() {
    let prop_def_id = Uuid::new_v4();
    let option_id = Uuid::new_v4();
    let f = EntityFilters {
        property_filters: vec![PropertyFilter {
            property_definition_id: prop_def_id.to_string(),
            entity_type: Some("TASK'; DROP TABLE documents; --".to_string()),
            option_ids: vec![option_id.to_string()],
            entity_ids: vec![],
        }],
        ..Default::default()
    };

    assert!(
        EntityFilterAst::new_from_filters(f).is_err(),
        "SQL injection in entity_type should be rejected"
    );
}

#[test]
fn entity_ref_with_single_quote_returns_error() {
    let prop_def_id = Uuid::new_v4();
    let f = EntityFilters {
        property_filters: vec![PropertyFilter {
            property_definition_id: prop_def_id.to_string(),
            entity_type: Some("TASK".to_string()),
            option_ids: vec![],
            entity_ids: vec!["x'); DROP TABLE documents; --".to_string()],
        }],
        ..Default::default()
    };

    assert!(
        EntityFilterAst::new_from_filters(f).is_err(),
        "SQL injection in entity_ids should be rejected"
    );
}

#[test]
fn entity_ref_ast_deserialization_rejects_injection() {
    let json = serde_json::json!({
        "l": {
            "pd": Uuid::new_v4(),
            "et": "TASK",
            "v": { "er": "x'); DROP TABLE documents; --" }
        }
    });

    let result = serde_json::from_value::<filter_ast::Expr<properties::PropertiesLiteral>>(json);
    assert!(
        result.is_err(),
        "direct AST deserialization should reject SQL injection in EntityRef"
    );
}

#[test]
fn entity_type_ast_deserialization_rejects_invalid() {
    let json = serde_json::json!({
        "l": {
            "pd": Uuid::new_v4(),
            "et": "INVALID_TYPE",
            "v": { "so": Uuid::new_v4() }
        }
    });

    let result = serde_json::from_value::<filter_ast::Expr<properties::PropertiesLiteral>>(json);
    assert!(
        result.is_err(),
        "direct AST deserialization should reject invalid entity type"
    );
}

#[test]
fn call_filter_status_expands_status_only() {
    let f = CallFilters {
        status: Some(CallStatus::Missed),
        ..Default::default()
    };
    let ast = CallFilters::expand_ast(f)
        .unwrap()
        .expect("status filter should expand to a literal");
    let json = serde_json::to_value(&ast).unwrap();
    let exp = json!({ "l": { "Status": "MISSED" } });
    assert_eq!(json, exp);
}

#[test]
fn call_filter_status_expands_channel_and_status_as_and() {
    let channel_id = Uuid::new_v4();
    let f = CallFilters {
        channel_ids: vec![channel_id.to_string()],
        status: Some(CallStatus::Unattended),
        ..Default::default()
    };
    let ast = CallFilters::expand_ast(f).unwrap().unwrap();
    let json = serde_json::to_value(&ast).unwrap();
    let exp = json!({
        "&": [
            { "l": { "ChannelId": channel_id } },
            { "l": { "Status": "UNATTENDED" } }
        ]
    });
    assert_eq!(json, exp);
}

#[test]
fn it_expands_call_filter_with_attended_only() {
    let f = CallFilters {
        attended: Some(true),
        ..Default::default()
    };
    let ast = CallFilters::expand_ast(f)
        .unwrap()
        .expect("attended filter should expand to a literal");
    let json = serde_json::to_value(&ast).unwrap();
    let exp = json!({ "l": { "Attended": true } });
    assert_eq!(json, exp);
}

#[test]
fn it_expands_call_filter_with_attended_false() {
    let f = CallFilters {
        attended: Some(false),
        ..Default::default()
    };
    let ast = CallFilters::expand_ast(f).unwrap().unwrap();
    let json = serde_json::to_value(&ast).unwrap();
    let exp = json!({ "l": { "Attended": false } });
    assert_eq!(json, exp);
}

#[test]
fn it_expands_call_filter_with_channel_and_attended_as_and() {
    let channel_id = Uuid::new_v4();
    let f = CallFilters {
        channel_ids: vec![channel_id.to_string()],
        attended: Some(true),
        ..Default::default()
    };
    let ast = CallFilters::expand_ast(f).unwrap().unwrap();
    let json = serde_json::to_value(&ast).unwrap();
    let exp = json!({
        "&": [
            { "l": { "ChannelId": channel_id } },
            { "l": { "Attended": true } }
        ]
    });
    assert_eq!(json, exp);
}

#[test]
fn it_expands_call_filter_with_call_ids() {
    let call_id = Uuid::new_v4();
    let f = CallFilters {
        call_ids: vec![call_id.to_string()],
        ..Default::default()
    };
    let ast = CallFilters::expand_ast(f).unwrap().unwrap();
    let json = serde_json::to_value(&ast).unwrap();
    let exp = json!({ "l": { "CallId": call_id } });
    assert_eq!(json, exp);
}

#[test]
fn it_expands_call_filter_without_attended_is_none_when_empty() {
    let f = CallFilters::default();
    let ast = CallFilters::expand_ast(f).unwrap();
    assert!(ast.is_none(), "empty filter should expand to None");
}

#[test]
fn foreign_entity_empty_filters_produce_no_ast() {
    let ast = ForeignEntityFilters::expand_ast(ForeignEntityFilters::default()).unwrap();
    assert!(ast.is_none(), "empty filter should expand to None");
}

#[test]
fn foreign_entity_ids_parse_as_uuid_literals() {
    let id = Uuid::new_v4();
    let f = EntityFilters {
        foreign_entity_filters: ForeignEntityFilters {
            ids: vec![id.to_string()],
            ..Default::default()
        },
        ..Default::default()
    };

    let ast = Arc::into_inner(
        EntityFilterAst::new_from_filters(f)
            .unwrap()
            .unwrap()
            .foreign_entity_filter
            .unwrap(),
    )
    .unwrap();

    let json = serde_json::to_value(ast).unwrap();
    let exp = json!({
        "l": {
            "id": id
        }
    });

    assert_eq!(json, exp);
}

#[test]
fn foreign_entity_external_ids_expand_as_or_tree() {
    let f = EntityFilters {
        foreign_entity_filters: ForeignEntityFilters {
            foreign_entity_ids: vec!["external-a".to_string(), "external-b".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };

    let ast = Arc::into_inner(
        EntityFilterAst::new_from_filters(f)
            .unwrap()
            .unwrap()
            .foreign_entity_filter
            .unwrap(),
    )
    .unwrap();

    let json = serde_json::to_value(ast).unwrap();
    let exp = json!({
        "|": [
            { "l": { "feid": "external-a" } },
            { "l": { "feid": "external-b" } }
        ]
    });

    assert_eq!(json, exp);
}

#[test]
fn foreign_entity_sources_expand_as_or_tree() {
    let f = EntityFilters {
        foreign_entity_filters: ForeignEntityFilters {
            foreign_entity_sources: vec!["github".to_string(), "linear".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };

    let ast = Arc::into_inner(
        EntityFilterAst::new_from_filters(f)
            .unwrap()
            .unwrap()
            .foreign_entity_filter
            .unwrap(),
    )
    .unwrap();

    let json = serde_json::to_value(ast).unwrap();
    let exp = json!({
        "|": [
            { "l": { "fes": "github" } },
            { "l": { "fes": "linear" } }
        ]
    });

    assert_eq!(json, exp);
}

#[test]
fn foreign_entity_includes_me_expands_as_me_literal() {
    let f = EntityFilters {
        foreign_entity_filters: ForeignEntityFilters {
            includes_me: true,
            ..Default::default()
        },
        ..Default::default()
    };

    let ast = Arc::into_inner(
        EntityFilterAst::new_from_filters(f)
            .unwrap()
            .unwrap()
            .foreign_entity_filter
            .unwrap(),
    )
    .unwrap();

    let json = serde_json::to_value(ast).unwrap();
    let exp = json!({ "l": "me" });

    assert_eq!(json, exp);
}

#[test]
fn foreign_entity_includes_me_ands_with_sources() {
    let f = EntityFilters {
        foreign_entity_filters: ForeignEntityFilters {
            foreign_entity_sources: vec!["github_pull_request".to_string()],
            includes_me: true,
            ..Default::default()
        },
        ..Default::default()
    };

    let ast = Arc::into_inner(
        EntityFilterAst::new_from_filters(f)
            .unwrap()
            .unwrap()
            .foreign_entity_filter
            .unwrap(),
    )
    .unwrap();

    let json = serde_json::to_value(ast).unwrap();
    let exp = json!({
        "&": [
            { "l": { "fes": "github_pull_request" } },
            { "l": "me" }
        ]
    });

    assert_eq!(json, exp);
}

#[test]
fn foreign_entity_notification_filters_expand_as_literals() {
    let f = EntityFilters {
        foreign_entity_filters: ForeignEntityFilters {
            notification_filters: crate::NotificationFilters {
                done: Some(true),
                seen: Some(false),
            },
            ..Default::default()
        },
        ..Default::default()
    };

    let ast = Arc::into_inner(
        EntityFilterAst::new_from_filters(f)
            .unwrap()
            .unwrap()
            .foreign_entity_filter
            .unwrap(),
    )
    .unwrap();

    let json = serde_json::to_string(&ast).unwrap();
    assert!(
        json.contains(r#""nd":true"#),
        "expected done literal: {json}"
    );
    assert!(
        json.contains(r#""ns":false"#),
        "expected seen literal: {json}"
    );
}

#[test]
fn foreign_entity_notification_done_ands_with_source() {
    let f = EntityFilters {
        foreign_entity_filters: ForeignEntityFilters {
            foreign_entity_sources: vec!["github_pull_request".to_string()],
            notification_filters: crate::NotificationFilters {
                done: Some(true),
                seen: None,
            },
            ..Default::default()
        },
        ..Default::default()
    };

    let ast = Arc::into_inner(
        EntityFilterAst::new_from_filters(f)
            .unwrap()
            .unwrap()
            .foreign_entity_filter
            .unwrap(),
    )
    .unwrap();

    let json = serde_json::to_value(ast).unwrap();
    let exp = json!({
        "&": [
            { "l": { "fes": "github_pull_request" } },
            { "l": { "nd": true } }
        ]
    });

    assert_eq!(json, exp);
}

#[test]
fn foreign_entity_invalid_id_returns_uuid_error() {
    let f = EntityFilters {
        foreign_entity_filters: ForeignEntityFilters {
            ids: vec!["not-a-uuid".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };

    let err = EntityFilterAst::new_from_filters(f).unwrap_err();
    assert_matches!(err, ExpandErr::Uuid(_));
}

#[test]
fn crm_domains_expand_to_any_direction_or() {
    let f = EntityFilters {
        email_filters: crate::EmailFilters {
            crm_domains: vec!["acme.com".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };

    let ast = EntityFilterAst::new_from_filters(f).unwrap().unwrap();
    let scope = ast.email_filter.crm_scope.expect("crm scope should be set");
    assert_matches!(scope, CrmScope::Domains(ref ds) if ds == &vec!["acme.com".to_string()]);

    let tree = Arc::into_inner(ast.email_filter.tree.expect("email filter tree set")).unwrap();
    let json = serde_json::to_value(tree).unwrap();
    // OR of Sender/Cc/Bcc/Recipient Domain literals — exact tree shape isn't
    // load-bearing; we just want to confirm any-direction expansion happened.
    let s = json.to_string();
    assert!(s.contains("Sender"));
    assert!(s.contains("Cc"));
    assert!(s.contains("Bcc"));
    assert!(s.contains("Recipient"));
    assert!(s.contains("acme.com"));
}

#[test]
fn crm_addresses_expand_to_any_direction_or() {
    let f = EntityFilters {
        email_filters: crate::EmailFilters {
            crm_addresses: vec!["alice@acme.com".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };

    let ast = EntityFilterAst::new_from_filters(f).unwrap().unwrap();
    let scope = ast.email_filter.crm_scope.expect("crm scope should be set");
    assert_matches!(scope, CrmScope::Addresses(ref a) if a == &vec!["alice@acme.com".to_string()]);

    let tree = Arc::into_inner(ast.email_filter.tree.expect("email filter tree set")).unwrap();
    let json = serde_json::to_value(tree).unwrap();
    let s = json.to_string();
    assert!(s.contains("Sender"));
    assert!(s.contains("Recipient"));
    assert!(s.contains("alice@acme.com"));
}

#[test]
fn crm_domains_and_addresses_together_is_rejected() {
    let f = EntityFilters {
        email_filters: crate::EmailFilters {
            crm_domains: vec!["acme.com".to_string()],
            crm_addresses: vec!["alice@acme.com".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };
    let err = EntityFilterAst::new_from_filters(f).unwrap_err();
    assert_matches!(err, ExpandErr::CrmDomainsAndAddressesMutuallyExclusive);
}

#[test]
fn crm_domains_rejects_non_domain_string() {
    let f = EntityFilters {
        email_filters: crate::EmailFilters {
            crm_domains: vec!["not a domain".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };
    let err = EntityFilterAst::new_from_filters(f).unwrap_err();
    assert_matches!(err, ExpandErr::InvalidCrmDomain(_));
}

#[test]
fn crm_addresses_rejects_unparseable_email() {
    let f = EntityFilters {
        email_filters: crate::EmailFilters {
            crm_addresses: vec!["not an email".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };
    let err = EntityFilterAst::new_from_filters(f).unwrap_err();
    assert_matches!(err, ExpandErr::InvalidCrmAddress(_));
}

#[test]
fn empty_crm_lists_produce_no_scope_tag() {
    let f = EntityFilters {
        email_filters: crate::EmailFilters {
            senders: vec!["bob@example.com".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };
    let ast = EntityFilterAst::new_from_filters(f).unwrap().unwrap();
    assert!(ast.email_filter.crm_scope.is_none());
}

#[test]
fn crm_domains_are_lowercased_in_scope_tag() {
    // Mixed-case input must land in the scope as lowercase, otherwise the
    // CRM pre-check (which uses LOWER(domain) on the SQL side) could miss
    // matches and reject valid requests.
    let f = EntityFilters {
        email_filters: crate::EmailFilters {
            crm_domains: vec!["ACME.com".to_string(), "Widgets.IO".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };
    let ast = EntityFilterAst::new_from_filters(f).unwrap().unwrap();
    let scope = ast.email_filter.crm_scope.expect("scope");
    match scope {
        CrmScope::Domains(d) => {
            assert_eq!(d, vec!["acme.com".to_string(), "widgets.io".to_string()])
        }
        CrmScope::Addresses(_) => panic!("expected Domains variant"),
    }
}

#[test]
fn crm_addresses_are_lowercased_in_scope_tag() {
    let f = EntityFilters {
        email_filters: crate::EmailFilters {
            crm_addresses: vec!["Alice@ACME.com".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };
    let ast = EntityFilterAst::new_from_filters(f).unwrap().unwrap();
    let scope = ast.email_filter.crm_scope.expect("scope");
    match scope {
        CrmScope::Addresses(a) => assert_eq!(a, vec!["alice@acme.com".to_string()]),
        CrmScope::Domains(_) => panic!("expected Addresses variant"),
    }
}

#[test]
fn multiple_crm_domains_or_together_in_tree() {
    // Each domain expands to an any-direction OR of 4 literals. Multiple
    // domains OR with each other at the top of the CRM sub-tree, so the
    // final shape is OR-of-(OR-of-4) for each domain. We don't pin the
    // exact tree shape — just confirm both domains appear in all 4
    // direction literals.
    let f = EntityFilters {
        email_filters: crate::EmailFilters {
            crm_domains: vec!["acme.com".to_string(), "widgets.io".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };
    let ast = EntityFilterAst::new_from_filters(f).unwrap().unwrap();
    let tree = ast.email_filter.tree.as_ref().expect("tree set").as_ref();
    let mut literals: Vec<String> = Vec::new();
    collect_literals(tree, &mut literals);
    // We expect 4 directions × 2 domains = 8 literal occurrences.
    let acme_count = literals.iter().filter(|s| s.contains("acme.com")).count();
    let widgets_count = literals.iter().filter(|s| s.contains("widgets.io")).count();
    assert_eq!(
        acme_count, 4,
        "acme.com should appear in all 4 direction literals"
    );
    assert_eq!(
        widgets_count, 4,
        "widgets.io should appear in all 4 direction literals"
    );
    // And each direction must appear for both:
    for direction in ["Sender", "Cc", "Bcc", "Recipient"] {
        let count = literals.iter().filter(|s| s.contains(direction)).count();
        assert_eq!(
            count, 2,
            "{} should appear once per domain (acme + widgets) = 2",
            direction
        );
    }
}

#[test]
fn crm_scope_ands_with_per_direction_senders() {
    // When a request carries BOTH crm_domains (CRM scope) AND a regular
    // per-direction sender filter, both must appear in the final AST
    // ANDed together. The CRM scope widens visibility; the per-direction
    // filter narrows within that widened scope.
    let f = EntityFilters {
        email_filters: crate::EmailFilters {
            crm_domains: vec!["acme.com".to_string()],
            senders: vec!["bob@elsewhere.com".to_string()],
            ..Default::default()
        },
        ..Default::default()
    };
    let ast = EntityFilterAst::new_from_filters(f).unwrap().unwrap();
    let tree = ast.email_filter.tree.as_ref().expect("tree set").as_ref();
    let mut literals: Vec<String> = Vec::new();
    collect_literals(tree, &mut literals);
    // The per-direction sender must be in the tree.
    assert!(
        literals.iter().any(|s| s.contains("bob@elsewhere.com")),
        "explicit sender filter must survive into the tree"
    );
    // The CRM domain must also be in the tree, on all four directions.
    let acme_count = literals.iter().filter(|s| s.contains("acme.com")).count();
    assert_eq!(acme_count, 4, "CRM domain expanded in all 4 directions");
}

/// Walks the Expr tree and pushes each Literal's JSON string into `out`.
fn collect_literals(expr: &filter_ast::Expr<EmailLiteral>, out: &mut Vec<String>) {
    match expr {
        filter_ast::Expr::And(a, b) | filter_ast::Expr::Or(a, b) => {
            collect_literals(a, out);
            collect_literals(b, out);
        }
        filter_ast::Expr::Not(a) => collect_literals(a, out),
        filter_ast::Expr::Literal(lit) => {
            out.push(serde_json::to_string(lit).unwrap());
        }
    }
}

#[test]
fn crm_scope_rejects_empty_domains_on_deserialize() {
    // Forged payload — an "empty CRM scope" would bypass downstream auth /
    // widening intent. CrmScope's custom Deserialize impl must reject it.
    let err = serde_json::from_str::<CrmScope>(r#"{"Domains":[]}"#).unwrap_err();
    assert!(
        err.to_string().contains("at least one domain"),
        "unexpected error: {err}"
    );
}

#[test]
fn crm_scope_rejects_empty_addresses_on_deserialize() {
    let err = serde_json::from_str::<CrmScope>(r#"{"Addresses":[]}"#).unwrap_err();
    assert!(
        err.to_string().contains("at least one address"),
        "unexpected error: {err}"
    );
}

#[test]
fn crm_scope_accepts_non_empty_variants_on_deserialize() {
    let domains: CrmScope = serde_json::from_str(r#"{"Domains":["acme.com"]}"#).unwrap();
    assert!(matches!(domains, CrmScope::Domains(d) if d == vec!["acme.com".to_string()]));
    let addresses: CrmScope = serde_json::from_str(r#"{"Addresses":["a@acme.com"]}"#).unwrap();
    assert!(matches!(addresses, CrmScope::Addresses(a) if a == vec!["a@acme.com".to_string()]));
}
