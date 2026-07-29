use std::sync::{Arc, Mutex};

use macro_event_broker::{EventBrokerError, MacroEvent, MacroEventBroker};
use serde_json::{Value, json};

use super::*;

#[derive(Clone, Debug, PartialEq)]
struct PublishedEvent {
    topic: String,
    key: String,
    envelope: Value,
}

#[derive(Clone, Default)]
struct FakeEventBroker {
    published: Arc<Mutex<Vec<PublishedEvent>>>,
    fail_publication: bool,
}

impl FakeEventBroker {
    fn failing() -> Self {
        Self {
            fail_publication: true,
            ..Self::default()
        }
    }

    fn published(&self) -> Vec<PublishedEvent> {
        self.published.lock().unwrap().clone()
    }
}

impl MacroEventBroker for FakeEventBroker {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        self.published.lock().unwrap().push(PublishedEvent {
            topic: event.topic().to_string(),
            key: event.key().to_string(),
            envelope: serde_json::to_value(event.event())?,
        });

        let fail_publication = self.fail_publication;
        Ok(tokio::spawn(async move {
            if fail_publication {
                Err(EventBrokerError::Publish(
                    "publisher unavailable".to_string(),
                ))
            } else {
                Ok(())
            }
        }))
    }
}

#[tokio::test]
async fn publish_project_purge_events_publishes_separately_keyed_events() {
    let event_broker = FakeEventBroker::default();
    let projects = vec![
        ProjectToDelete {
            project_id: "project-one".to_string(),
            user_id: "macro|owner-one@example.com".to_string(),
        },
        ProjectToDelete {
            project_id: "project-two".to_string(),
            user_id: "macro|owner-two@example.com".to_string(),
        },
    ];

    publish_project_purge_events(&event_broker, &projects)
        .await
        .unwrap();

    let published = event_broker.published();
    assert_eq!(published.len(), projects.len());

    for (event, project) in published.iter().zip(&projects) {
        assert_eq!(event.topic, "macro.projects");
        assert_eq!(event.key, project.project_id);
        assert_eq!(event.envelope["schema_version"], json!(1));
        assert_eq!(
            event.envelope["event_type"],
            json!("project.permanently_deleted")
        );

        let metadata = &event.envelope["metadata"];
        assert_eq!(metadata["project_id"], json!(project.project_id));
        assert_eq!(metadata["owner"], json!(project.user_id));
        assert_eq!(metadata["actor_user_id"], Value::Null);
        assert_eq!(metadata["parent_project_id"], Value::Null);
        assert_eq!(metadata["purged_project_ids"], json!([project.project_id]));
        assert_eq!(metadata["purged_document_ids"], json!([]));
        assert_eq!(metadata["purged_chat_ids"], json!([]));
    }
}

#[tokio::test]
async fn publish_project_purge_events_returns_publication_failures() {
    let event_broker = FakeEventBroker::failing();
    let projects = vec![ProjectToDelete {
        project_id: "project-one".to_string(),
        user_id: "macro|owner@example.com".to_string(),
    }];

    let error = publish_project_purge_events(&event_broker, &projects)
        .await
        .expect_err("publication failure should be returned");

    assert!(format!("{error:#}").contains("publisher unavailable"));
}

#[tokio::test]
async fn publish_project_purge_events_rejects_malformed_owners() {
    let event_broker = FakeEventBroker::default();
    let projects = vec![ProjectToDelete {
        project_id: "project-one".to_string(),
        user_id: "not-a-macro-user".to_string(),
    }];

    let error = publish_project_purge_events(&event_broker, &projects)
        .await
        .expect_err("malformed owners should be returned");

    assert!(format!("{error:#}").contains("invalid owner for project project-one"));
    assert!(event_broker.published().is_empty());
}
