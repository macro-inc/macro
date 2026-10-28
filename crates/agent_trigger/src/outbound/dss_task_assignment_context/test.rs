use super::*;
use chrono::{TimeZone, Utc};
use entity_access::domain::models::{AccessLevel, Entity, EntityPermission};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use models_properties::service::{
    property_option::PropertyOptionValue, property_value::PropertyValue,
};
use models_properties::{
    DataType, EntityReference, EntityType as PropertyEntityType, PropertyOwner,
};
use properties::PropertyOptionInfo;
use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use system_properties::SystemPropertyKey;

fn access() -> EntityAccessReceipt<MessageWrite> {
    EntityAccessReceipt::try_new_authenticated_user(
        MacroUserIdStr::try_from_email("assigner@example.com").unwrap(),
        Entity {
            entity_type: EntityType::Document,
            entity_id: "task-1".to_owned(),
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit,
        },
    )
    .unwrap()
}

fn task() -> Value {
    json!({
        "documentId": "task-1",
        "documentName": "Fix the flaky test",
        "owner": "macro|assigner@example.com",
        "fileType": "md",
        "subType": "task",
        "deletedAt": null,
    })
}

fn server(
    responses: Vec<(&'static str, u16, Value)>,
    properties: MockTaskProperties,
) -> (
    DssTaskAssignmentContext<MockTaskProperties>,
    std::thread::JoinHandle<()>,
) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let handle = std::thread::spawn(move || {
        for (path, status, body) in responses {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            assert_eq!(line.trim_end(), format!("GET {path} HTTP/1.1"));
            loop {
                line.clear();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" || line.is_empty() {
                    break;
                }
            }
            let body = body.to_string();
            write!(stream, "HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        }
    });
    let url = format!("http://{address}");
    (
        DssTaskAssignmentContext::new(
            DocumentStorageServiceClient::new("test-key".to_owned(), url.clone()),
            LexicalClient::new("test-key".to_owned(), url),
            properties,
        ),
        handle,
    )
}

#[tokio::test]
async fn a_task_brief_names_the_current_status_priority_due_date_and_assignees() {
    let in_progress = Uuid::from_u128(0x10);
    let high = Uuid::from_u128(0x20);
    let mut properties = MockTaskProperties::new();
    properties
        .expect_task_properties()
        .once()
        .withf(|task| {
            task.entity().entity_id == "task-1" && task.entity().entity_type == EntityType::Document
        })
        .return_once(move |_| {
            Box::pin(async move {
                Ok(vec![
                    EntityPropertyInfo {
                        property_definition_id: SystemPropertyKey::Status.uuid(),
                        owner: PropertyOwner::System,
                        display_name: "Status".to_owned(),
                        data_type: DataType::SelectString,
                        is_multi_select: false,
                        is_system: true,
                        value: Some(PropertyValue::SelectOption(vec![in_progress])),
                        options: vec![
                            PropertyOptionInfo {
                                id: Uuid::from_u128(0x11),
                                display_order: 0,
                                value: PropertyOptionValue::String("Not Started".to_owned()),
                            },
                            PropertyOptionInfo {
                                id: in_progress,
                                display_order: 1,
                                value: PropertyOptionValue::String("In Progress".to_owned()),
                            },
                        ],
                    },
                    EntityPropertyInfo {
                        property_definition_id: SystemPropertyKey::Priority.uuid(),
                        owner: PropertyOwner::System,
                        display_name: "Priority".to_owned(),
                        data_type: DataType::SelectString,
                        is_multi_select: false,
                        is_system: true,
                        value: Some(PropertyValue::SelectOption(vec![high])),
                        options: vec![PropertyOptionInfo {
                            id: high,
                            display_order: 0,
                            value: PropertyOptionValue::String("High".to_owned()),
                        }],
                    },
                    EntityPropertyInfo {
                        property_definition_id: SystemPropertyKey::DueDate.uuid(),
                        owner: PropertyOwner::System,
                        display_name: "Due Date".to_owned(),
                        data_type: DataType::Date,
                        is_multi_select: false,
                        is_system: true,
                        value: Some(PropertyValue::Date(
                            Utc.with_ymd_and_hms(2026, 10, 15, 17, 0, 0).unwrap(),
                        )),
                        options: Vec::new(),
                    },
                    EntityPropertyInfo {
                        property_definition_id: SystemPropertyKey::Assignees.uuid(),
                        owner: PropertyOwner::System,
                        display_name: "Assignees".to_owned(),
                        data_type: DataType::Entity,
                        is_multi_select: true,
                        is_system: true,
                        value: Some(PropertyValue::EntityRef(vec![
                            EntityReference {
                                entity_id: "macro|assigner@example.com".to_owned(),
                                entity_type: PropertyEntityType::User,
                                specific_message_id: None,
                            },
                            EntityReference {
                                entity_id: bot_id::CODEX_BOT_ID.to_string(),
                                entity_type: PropertyEntityType::User,
                                specific_message_id: None,
                            },
                        ])),
                        options: Vec::new(),
                    },
                    EntityPropertyInfo {
                        property_definition_id: Uuid::from_u128(0x30),
                        owner: PropertyOwner::User {
                            user_id: "macro|assigner@example.com".to_owned(),
                        },
                        display_name: "Estimate".to_owned(),
                        data_type: DataType::Number,
                        is_multi_select: false,
                        is_system: false,
                        value: Some(PropertyValue::Num(3.0)),
                        options: Vec::new(),
                    },
                ])
            })
        });
    let (context, server) = server(
        vec![
            ("/internal/documents/task-1/basic", 200, task()),
            (
                "/markdown/task-1?target=external",
                200,
                json!({"data": "Reproduce the race, then add a regression test."}),
            ),
        ],
        properties,
    );
    assert_eq!(
        context.task_brief(access()).await.unwrap(),
        Some(TaskBrief {
            title: "Fix the flaky test".to_owned(),
            markdown: "Reproduce the race, then add a regression test.".to_owned(),
            status: Some("In Progress".to_owned()),
            priority: Some("High".to_owned()),
            due: Some(Utc.with_ymd_and_hms(2026, 10, 15, 17, 0, 0).unwrap()),
            assignee_ids: vec![
                "macro|assigner@example.com".to_owned(),
                bot_id::CODEX_BOT_ID.to_string(),
            ],
            project: None,
        })
    );
    server.join().unwrap();
}

#[tokio::test]
async fn missing_deleted_and_non_task_documents_do_not_load_content() {
    let mut deleted = task();
    deleted["deletedAt"] = json!("2026-09-24T12:00:00Z");
    let mut ordinary = task();
    ordinary["subType"] = Value::Null;
    for (status, metadata) in [(404, json!({})), (200, deleted), (200, ordinary)] {
        let (context, server) = server(
            vec![("/internal/documents/task-1/basic", status, metadata)],
            MockTaskProperties::new(),
        );
        assert!(context.task_brief(access()).await.unwrap().is_none());
        server.join().unwrap();
    }
}

#[tokio::test]
async fn a_response_for_a_different_document_cannot_supply_the_brief() {
    let mut metadata = task();
    metadata["documentId"] = json!("other-task");
    let (context, server) = server(
        vec![("/internal/documents/task-1/basic", 200, metadata)],
        MockTaskProperties::new(),
    );
    assert!(matches!(
        context.task_brief(access()).await,
        Err(AgentSessionError::Forbidden)
    ));
    server.join().unwrap();
}

#[tokio::test]
async fn unavailable_live_content_is_retried_instead_of_starting_without_a_description() {
    let (context, server) = server(
        vec![
            ("/internal/documents/task-1/basic", 200, task()),
            (
                "/markdown/task-1?target=external",
                503,
                json!({"error": "temporarily unavailable"}),
            ),
        ],
        MockTaskProperties::new(),
    );
    assert!(context.task_brief(access()).await.is_err());
    server.join().unwrap();
}

#[tokio::test]
async fn unavailable_properties_are_retried_instead_of_starting_without_them() {
    let mut properties = MockTaskProperties::new();
    properties.expect_task_properties().once().return_once(|_| {
        Box::pin(async { Err(PropertiesErr::Repo(anyhow::anyhow!("database unavailable"))) })
    });
    let (context, server) = server(
        vec![
            ("/internal/documents/task-1/basic", 200, task()),
            (
                "/markdown/task-1?target=external",
                200,
                json!({"data": "Reproduce the race, then add a regression test."}),
            ),
        ],
        properties,
    );
    assert!(matches!(
        context.task_brief(access()).await,
        Err(AgentSessionError::Unknown(_))
    ));
    server.join().unwrap();
}
