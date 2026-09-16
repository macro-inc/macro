use super::*;

#[test]
fn initiative_id_round_trips_uuid_strings() {
    let id = InitiativeId::generate();
    let parsed = InitiativeId::from_str(&id.to_string()).expect("uuid string");
    assert_eq!(parsed, id);
    assert_eq!(InitiativeId::from_uuid(id.as_uuid()), id);
}

#[test]
fn wire_types_serialize_camel_case() {
    let json = serde_json::to_value(AssignTasksResponse {
        results: vec![AssignTasksResult {
            task_id: "task-1".to_string(),
            status: AssignTaskStatus::NotATask,
        }],
    })
    .expect("json");
    assert_eq!(
        json,
        serde_json::json!({
            "results": [{ "taskId": "task-1", "status": "notATask" }]
        })
    );

    let skipped = serde_json::to_value(AssignTaskStatus::SkippedNoPermission).expect("json");
    assert_eq!(skipped, serde_json::json!("skippedNoPermission"));
}

#[test]
fn create_request_deserializes_camel_case() {
    let request: CreateInitiativeRequest = serde_json::from_value(serde_json::json!({
        "name": "Launch",
        "memberIds": ["macro|a@macro.com"],
        "shareWithTeam": true
    }))
    .expect("request");
    assert_eq!(request.name, "Launch");
    assert_eq!(
        request.member_ids.as_deref(),
        Some(["macro|a@macro.com".to_string()].as_slice())
    );
    assert_eq!(request.share_with_team, Some(true));
}

#[test]
fn task_assignment_exposes_task_id() {
    assert_eq!(
        TaskAssignment::Candidate {
            task_id: "t1".into()
        }
        .task_id(),
        "t1"
    );
    assert_eq!(
        TaskAssignment::NotFound {
            task_id: "t2".into()
        }
        .task_id(),
        "t2"
    );
    assert_eq!(
        TaskAssignment::SkippedNoPermission {
            task_id: "t3".into()
        }
        .task_id(),
        "t3"
    );
}
