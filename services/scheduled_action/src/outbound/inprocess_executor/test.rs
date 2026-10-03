use crate::domain::execution::ExecutionHandle;
use crate::domain::models::{
    ActionExecutionRecord, ExecutionResource, ExecutionResourceType, ExecutionResult,
    InProgressExecution, ScheduledActionUpdate,
};
use chrono::Utc;
use serde_json::{Value, json};

#[test]
fn resource_encoding_is_closed_and_result_is_versioned() {
    for (resource_type, encoded_type) in [
        (ExecutionResourceType::Chat, "chat"),
        (ExecutionResourceType::Agent, "agent"),
    ] {
        let resource = ExecutionResource {
            resource_type,
            id: "transcript".into(),
        };
        let value =
            serde_json::to_value(ExecutionResult::new(Some(resource.clone()), None)).unwrap();
        assert_eq!(value["version"], 1);
        assert_eq!(
            value["resource"],
            json!({"type": encoded_type, "id": "transcript"})
        );
        assert_eq!(
            serde_json::from_value::<ExecutionResult>(value)
                .unwrap()
                .resource,
            Some(resource)
        );
    }
    assert!(
        serde_json::from_value::<ExecutionResource>(json!({"type":"other", "id":"id"})).is_err()
    );
}

fn history(result: Value) -> ActionExecutionRecord {
    ActionExecutionRecord {
        id: None,
        action_id: macro_uuid::generate_uuid_v7(),
        resource_id: Some("transcript".into()),
        start_time: Utc::now(),
        end_time: Utc::now(),
        is_success: true,
        result,
        created_at: Utc::now(),
    }
}

#[test]
fn legacy_history_and_responses_remain_readable() {
    for result in [Value::Null, json!("legacy failure")] {
        let resource = history(result).execution_resource().unwrap().unwrap();
        assert_eq!(resource.resource_type, ExecutionResourceType::Chat);
        assert_eq!(resource.id, "transcript");
    }
    let response: InProgressExecution = serde_json::from_value(json!({
        "action_id":macro_uuid::generate_uuid_v7(), "chat_id":"transcript"
    }))
    .unwrap();
    assert!(response.resource.is_none());
    assert_eq!(response.chat_id.as_deref(), Some("transcript"));
    let update: ScheduledActionUpdate = serde_json::from_value(json!({
        "type":"started", "owner":"macro|runner@macro.com",
        "action_id":macro_uuid::generate_uuid_v7(), "chat_id":"transcript"
    }))
    .unwrap();
    assert!(matches!(
        update,
        ScheduledActionUpdate::Started { resource: None, .. }
    ));
}

#[test]
fn typed_history_never_falls_back_to_chat_for_unknown_metadata() {
    let resource = ExecutionResource {
        resource_type: ExecutionResourceType::Agent,
        id: "transcript".into(),
    };
    let result = serde_json::to_value(ExecutionResult::new(Some(resource.clone()), None)).unwrap();
    assert_eq!(
        history(result.clone()).execution_resource().unwrap(),
        Some(resource)
    );
    let mut unknown_version = result.clone();
    unknown_version["version"] = json!(2);
    assert!(history(unknown_version).execution_resource().is_err());
    let mut unknown_type = result.clone();
    unknown_type["resource"]["type"] = json!("other");
    assert!(history(unknown_type).execution_resource().is_err());
    let mut wrong_id = result;
    wrong_id["resource"]["id"] = json!("different");
    assert!(history(wrong_id).execution_resource().is_err());
    assert!(history(json!({})).execution_resource().is_err());
}

#[test]
fn handles_allocate_distinct_ids_before_preparation() {
    let first = ExecutionHandle::default();
    let second = ExecutionHandle::default();
    assert_ne!(first.session_id, first.action_id);
    assert_ne!(first.session_id, second.session_id);
    assert_ne!(first.action_id, second.action_id);
    assert!(first.resource.is_none());
}
