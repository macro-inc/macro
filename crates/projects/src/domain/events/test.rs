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

mod exposure {
    use super::*;
    use macro_event_broker::exposure::{Audience, EntityType, Exposure, PublicEvent, Stage};

    const OWNER: &str = "macro|owner@example.com";

    fn user(id: &str) -> MacroUserIdStr<'static> {
        MacroUserIdStr::try_from(id.to_owned()).unwrap()
    }

    fn public(event: &ProjectTopicEvent) -> PublicEvent<'_, ProjectPublicEvent> {
        match event.exposure().unwrap() {
            Exposure::Public(public) => public,
            Exposure::Internal(reason) => panic!("expected public, got {reason}"),
        }
    }

    fn project_audience() -> Audience {
        Audience::Entity {
            entity_type: EntityType::Project,
            entity_id: PROJECT_ID.to_owned(),
        }
    }

    fn deleted() -> ProjectTopicEvent {
        ProjectTopicEvent::Deleted(ProjectDeletedMetadata {
            project_id: PROJECT_ID.to_owned(),
            owner: Owner::User(user(OWNER)),
            actor_user_id: Some(user(OWNER)),
            parent_project_id: Some("parent".to_owned()),
            deleted_project_ids: vec!["child".to_owned()],
            deleted_document_ids: vec!["doc".to_owned()],
            deleted_chat_ids: vec!["chat".to_owned()],
        })
    }

    fn permanently_deleted(owner: Owner) -> ProjectTopicEvent {
        ProjectTopicEvent::PermanentlyDeleted(ProjectPermanentlyDeletedMetadata {
            project_id: PROJECT_ID.to_owned(),
            owner,
            actor_user_id: None,
            parent_project_id: None,
            purged_project_ids: vec!["child".to_owned()],
            purged_document_ids: vec!["doc".to_owned()],
            purged_chat_ids: vec!["chat".to_owned()],
        })
    }

    #[test]
    fn entity_events_reach_the_project_audience_in_preview() {
        let events = [
            ProjectTopicEvent::Created(ProjectCreatedMetadata {
                project_id: PROJECT_ID.to_owned(),
                owner: Owner::User(user(OWNER)),
                name: "Secret plans".to_owned(),
                parent_project_id: None,
                created_at: None,
            }),
            ProjectTopicEvent::Updated(ProjectUpdatedMetadata {
                project_id: PROJECT_ID.to_owned(),
                owner: Owner::User(user(OWNER)),
                actor_user_id: None,
                name: None,
                previous_parent_id: None,
                parent_id: None,
                share_permission_updated: true,
            }),
            deleted(),
            ProjectTopicEvent::Restored(ProjectRestoredMetadata {
                project_id: PROJECT_ID.to_owned(),
                owner: Owner::User(user(OWNER)),
                actor_user_id: None,
                parent_project_id: None,
                restored_project_ids: vec!["child".to_owned()],
            }),
            ProjectTopicEvent::Uploaded(ProjectUploadedMetadata {
                root_project_id: PROJECT_ID.to_owned(),
                owner: Owner::User(user(OWNER)),
                name: "Upload".to_owned(),
                parent_project_id: None,
                project_ids: vec!["child".to_owned()],
            }),
        ];
        for event in &events {
            let public = public(event);
            let wire = serde_json::to_value(public.payload.as_ref()).unwrap();
            assert_eq!(wire["event_type"], public.name);
            assert_eq!(public.entity.entity_type.as_str(), "project");
            assert_eq!(public.entity.entity_id, PROJECT_ID);
            assert_eq!(public.audience, project_audience(), "{}", public.name);
            assert_eq!(public.stage, Stage::Preview);
        }
    }

    #[test]
    fn deleted_payload_drops_child_ids() {
        let event = deleted();
        let public = public(&event);
        assert_eq!(
            serde_json::to_value(public.payload.as_ref()).unwrap(),
            json!({
                "event_type": "project.deleted",
                "metadata": {
                    "project_id": PROJECT_ID,
                    "parent_project_id": "parent",
                    "actor_user_id": OWNER,
                },
            })
        );
    }

    #[test]
    fn updated_payload_names_what_changed_without_values() {
        let event = ProjectTopicEvent::Updated(ProjectUpdatedMetadata {
            project_id: PROJECT_ID.to_owned(),
            owner: Owner::User(user(OWNER)),
            actor_user_id: Some(user(OWNER)),
            name: Some("New name".to_owned()),
            previous_parent_id: Some("old".to_owned()),
            parent_id: Some(String::new()),
            share_permission_updated: false,
        });
        assert_eq!(
            serde_json::to_value(public(&event).payload.as_ref()).unwrap(),
            json!({
                "event_type": "project.updated",
                "metadata": {
                    "project_id": PROJECT_ID,
                    "actor_user_id": OWNER,
                    "changes": ["name", "parent"],
                },
            })
        );
    }

    #[test]
    fn created_payload_is_ids_and_time() {
        let event = ProjectTopicEvent::Created(ProjectCreatedMetadata {
            project_id: PROJECT_ID.to_owned(),
            owner: Owner::User(user(OWNER)),
            name: "Secret plans".to_owned(),
            parent_project_id: Some("parent".to_owned()),
            created_at: Some("2026-11-13T00:00:00Z".parse().unwrap()),
        });
        assert_eq!(
            serde_json::to_value(public(&event).payload.as_ref()).unwrap(),
            json!({
                "event_type": "project.created",
                "metadata": {
                    "project_id": PROJECT_ID,
                    "parent_project_id": "parent",
                    "created_at": "2026-11-13T00:00:00Z",
                },
            })
        );
    }

    #[test]
    fn permanent_delete_reaches_a_user_owner_only() {
        let event = permanently_deleted(Owner::User(user(OWNER)));
        let public = public(&event);
        assert_eq!(public.name, "project.permanently_deleted");
        assert_eq!(
            public.audience,
            Audience::Owner {
                user_id: user(OWNER)
            }
        );

        for owner in [
            Owner::Team(uuid::Uuid::nil()),
            Owner::Bot(bot_id::BotId::new_from_uuid(uuid::Uuid::nil())),
        ] {
            assert!(matches!(
                permanently_deleted(owner).exposure().unwrap(),
                Exposure::Internal(_)
            ));
        }
    }

    #[cfg(feature = "axum")]
    #[test]
    fn public_payload_has_a_schema() {
        use utoipa::ToSchema as _;
        assert_eq!(ProjectPublicEvent::name(), "ProjectPublicEvent");
    }
}
