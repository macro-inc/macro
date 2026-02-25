use std::str::FromStr;

use super::*;
use cool_asserts::assert_matches;
use model_file_type::FileType;
use serde_json::json;
use uuid::Uuid;

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
#[ignore]
fn it_expands_file_associations() {
    let f = EntityFilters {
        document_filters: DocumentFilters {
            file_types: vec!["assoc:vector".to_string()],
            document_ids: vec![],
            project_ids: vec![],
            owners: vec![],
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
#[ignore]
fn it_expands_other_association() {
    let f = EntityFilters {
        document_filters: DocumentFilters {
            file_types: vec!["assoc:other".to_string()],
            document_ids: vec![],
            project_ids: vec![],
            owners: vec![],
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
