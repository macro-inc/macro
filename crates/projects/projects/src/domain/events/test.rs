use super::*;
use serde_json::json;

const PROJECT_ID: &str = "11111111-1111-1111-1111-111111111111";

#[test]
fn lifecycle_events_round_trip_all_owner_kinds_with_v1_strings() {
    assert_eq!(<ProjectTopicEvent as TopicEvent>::SCHEMA_VERSION, 1);
    for principal in [
        "macro|owner@example.com",
        "bot|00000000-0000-0000-0000-000000000001",
        "01998a30-1a2b-7c3d-9e4f-5a6b7c8d9e0f",
    ] {
        for (event_type, metadata) in [
            (
                "project.created",
                json!({
                    "project_id": PROJECT_ID,
                    "owner": principal,
                    "name": "project",
                    "parent_project_id": null,
                    "created_at": null,
                }),
            ),
            (
                "project.updated",
                json!({
                    "project_id": PROJECT_ID,
                    "owner": principal,
                    "actor_user_id": null,
                    "name": null,
                    "previous_parent_id": null,
                    "parent_id": null,
                    "share_permission_updated": false,
                }),
            ),
            (
                "project.deleted",
                json!({
                    "project_id": PROJECT_ID,
                    "owner": principal,
                    "actor_user_id": null,
                    "parent_project_id": null,
                    "deleted_project_ids": [PROJECT_ID],
                    "deleted_document_ids": [],
                    "deleted_chat_ids": [],
                }),
            ),
        ] {
            let payload = json!({
                "event_id": "00000000-0000-0000-0000-000000000001",
                "schema_version": 1,
                "event_type": event_type,
                "metadata": metadata,
            });
            let decoded =
                ProjectMacroEvent::decode(PROJECT_ID, &serde_json::to_vec(&payload).unwrap())
                    .expect("v1 owner strings decode through the broker");
            let owner = match &decoded.event().event {
                ProjectTopicEvent::Created(metadata) => &metadata.owner,
                ProjectTopicEvent::Updated(metadata) => &metadata.owner,
                ProjectTopicEvent::Deleted(metadata) => &metadata.owner,
                other => panic!("unexpected event {other:?}"),
            };
            assert_eq!(owner, &Owner::from_principal_str(principal).unwrap());
            assert_eq!(serde_json::to_value(decoded.event()).unwrap(), payload);
        }
    }
}
