use super::*;

#[test]
fn the_request_matches_the_lexical_service_schema() {
    let request = NotionSnapshotRequest {
        markdown: "See <mention-page url=\"https://www.notion.so/p\">Plan</mention-page>",
        links: NotionSnapshotLinks {
            databases: Vec::new(),
            pages: [(
                "3fb607323e2e80629886fc0c028d50a7".to_string(),
                NotionSnapshotPage {
                    document_id: "0e5b6a2c-7c39-4a63-9a0c-5c1f2f6c0001".to_string(),
                    name: "Plan".to_string(),
                },
            )]
            .into(),
            users: [(
                "12345678123412341234123456789abc".to_string(),
                NotionSnapshotUser {
                    user_id: "macro|teo@acme.test".to_string(),
                    email: "teo@acme.test".to_string(),
                },
            )]
            .into(),
        },
    };

    assert_eq!(
        serde_json::to_value(&request).unwrap(),
        serde_json::json!({
            "markdown": "See <mention-page url=\"https://www.notion.so/p\">Plan</mention-page>",
            "links": {
                "pages": {
                    "3fb607323e2e80629886fc0c028d50a7": {
                        "documentId": "0e5b6a2c-7c39-4a63-9a0c-5c1f2f6c0001",
                        "name": "Plan"
                    }
                },
                "users": {
                    "12345678123412341234123456789abc": {
                        "userId": "macro|teo@acme.test",
                        "email": "teo@acme.test"
                    }
                }
            }
        })
    );
}

#[test]
fn database_placements_match_the_snapshot_endpoint_union_and_keep_ordinals() {
    let links = NotionSnapshotLinks {
        databases: vec![
            NotionSnapshotDatabaseOccurrence {
                container_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into(),
                ordinal: 0,
                target: NotionSnapshotDatabaseTarget::Resolved {
                    database_id: "00000000-0000-4000-8000-000000000001".into(),
                    table_id: "00000000-0000-4000-8000-000000000002".into(),
                    view_id: Some("00000000-0000-4000-8000-000000000003".into()),
                },
            },
            NotionSnapshotDatabaseOccurrence {
                container_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into(),
                ordinal: 1,
                target: NotionSnapshotDatabaseTarget::Fallback {
                    reason: NotionSnapshotDatabaseFallback::NotImported,
                },
            },
        ],
        ..NotionSnapshotLinks::default()
    };
    assert_eq!(
        serde_json::to_value(links).unwrap(),
        serde_json::json!({
            "pages":{}, "users":{}, "databases":[
                {"containerId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "ordinal":0, "target":{
                    "databaseId":"00000000-0000-4000-8000-000000000001", "tableId":"00000000-0000-4000-8000-000000000002", "viewId":"00000000-0000-4000-8000-000000000003"
                }},
                {"containerId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "ordinal":1, "target":{"reason":"notImported"}}
            ]
        })
    );
}
