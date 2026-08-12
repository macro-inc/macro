use std::sync::{Arc, Mutex};

use macro_event_broker::{EventBrokerError, MacroEvent, MacroEventBroker};
use serde_json::{Value, json};
use tokio::sync::Semaphore;

use super::*;

#[derive(Clone, Debug, PartialEq)]
struct PublishedEvent {
    topic: String,
    key: String,
    envelope: Value,
}

#[derive(Clone, Default)]
enum DeliveryBehavior {
    #[default]
    Succeed,
    Fail,
    FailToJoin,
    Wait(Arc<Semaphore>),
}

#[derive(Clone, Default)]
struct FakeEventBroker {
    published: Arc<Mutex<Vec<PublishedEvent>>>,
    fail_send: bool,
    delivery_behavior: DeliveryBehavior,
}

impl FakeEventBroker {
    fn failing_send() -> Self {
        Self {
            fail_send: true,
            ..Self::default()
        }
    }

    fn failing_delivery() -> Self {
        Self {
            delivery_behavior: DeliveryBehavior::Fail,
            ..Self::default()
        }
    }

    fn failing_join() -> Self {
        Self {
            delivery_behavior: DeliveryBehavior::FailToJoin,
            ..Self::default()
        }
    }

    fn waiting_for_delivery(delivery_gate: Arc<Semaphore>) -> Self {
        Self {
            delivery_behavior: DeliveryBehavior::Wait(delivery_gate),
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
        if self.fail_send {
            return Err(EventBrokerError::Publish(
                "event enqueue rejected".to_string(),
            ));
        }

        self.published.lock().unwrap().push(PublishedEvent {
            topic: event.topic().to_string(),
            key: event.key().to_string(),
            envelope: serde_json::to_value(event.event())?,
        });

        let delivery_handle = match self.delivery_behavior.clone() {
            DeliveryBehavior::Succeed => tokio::spawn(async { Ok(()) }),
            DeliveryBehavior::Fail => tokio::spawn(async {
                Err(EventBrokerError::Publish(
                    "publisher unavailable".to_string(),
                ))
            }),
            DeliveryBehavior::FailToJoin => {
                let handle = tokio::spawn(std::future::pending::<Result<(), EventBrokerError>>());
                handle.abort();
                handle
            }
            DeliveryBehavior::Wait(delivery_gate) => tokio::spawn(async move {
                let permit = delivery_gate
                    .acquire_owned()
                    .await
                    .expect("delivery gate should remain open");
                permit.forget();
                Ok(())
            }),
        };

        Ok(delivery_handle)
    }
}

#[tokio::test]
async fn publish_document_purge_events_publishes_separately_keyed_events() {
    let event_broker = FakeEventBroker::default();
    let document_ids = vec!["document-one".to_string(), "document-two".to_string()];

    publish_document_purge_events(&event_broker, &document_ids)
        .await
        .unwrap();

    let published = event_broker.published();
    assert_eq!(published.len(), document_ids.len());

    for (event, document_id) in published.iter().zip(&document_ids) {
        assert_eq!(event.topic, "macro.documents");
        assert_eq!(event.key, *document_id);
        assert_eq!(event.envelope["schema_version"], json!(1));
        assert_eq!(event.envelope["event_type"], json!("document.purged"));
        assert_eq!(
            event.envelope["metadata"]["document_id"],
            json!(document_id)
        );
    }
}

#[tokio::test]
async fn publish_document_purge_events_returns_immediate_send_failures() {
    let event_broker = FakeEventBroker::failing_send();
    let document_ids = vec!["document-one".to_string()];

    let error = publish_document_purge_events(&event_broker, &document_ids)
        .await
        .expect_err("immediate send failure should be returned");

    assert!(format!("{error:#}").contains("event enqueue rejected"));
}

#[tokio::test]
async fn publish_document_purge_events_returns_delivery_failures() {
    let event_broker = FakeEventBroker::failing_delivery();
    let document_ids = vec!["document-one".to_string()];

    let error = publish_document_purge_events(&event_broker, &document_ids)
        .await
        .expect_err("delivery failure should be returned");

    assert!(format!("{error:#}").contains("publisher unavailable"));
}

#[tokio::test]
async fn publish_document_purge_events_returns_delivery_join_failures() {
    let event_broker = FakeEventBroker::failing_join();
    let document_ids = vec!["document-one".to_string()];

    let error = publish_document_purge_events(&event_broker, &document_ids)
        .await
        .expect_err("delivery join failure should be returned");

    assert!(
        format!("{error:#}").contains("document purge event publication task failed"),
        "unexpected error: {error:#}"
    );
}

#[tokio::test]
async fn publish_document_purge_events_waits_for_every_delivery() {
    let delivery_gate = Arc::new(Semaphore::new(0));
    let event_broker = FakeEventBroker::waiting_for_delivery(delivery_gate.clone());
    let document_ids = vec!["document-one".to_string(), "document-two".to_string()];

    let publication_task = tokio::spawn({
        let event_broker = event_broker.clone();
        let document_ids = document_ids.clone();
        async move { publish_document_purge_events(&event_broker, &document_ids).await }
    });

    while event_broker.published().len() < document_ids.len() {
        tokio::task::yield_now().await;
    }

    assert!(!publication_task.is_finished());

    delivery_gate.add_permits(1);
    tokio::task::yield_now().await;
    assert!(!publication_task.is_finished());

    delivery_gate.add_permits(1);
    publication_task.await.unwrap().unwrap();
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
    let event_broker = FakeEventBroker::failing_delivery();
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

#[tokio::test]
async fn publish_chat_purge_events_publishes_separately_keyed_events() {
    let event_broker = FakeEventBroker::default();
    let chat_ids = vec!["chat-one".to_string(), "chat-two".to_string()];

    publish_chat_purge_events(&event_broker, &chat_ids)
        .await
        .unwrap();

    let published = event_broker.published();
    assert_eq!(published.len(), chat_ids.len());

    for (event, chat_id) in published.iter().zip(&chat_ids) {
        assert_eq!(event.topic, "macro.chats");
        assert_eq!(event.key, *chat_id);
        assert_eq!(event.envelope["schema_version"], json!(1));
        assert_eq!(
            event.envelope["event_type"],
            json!("chat.permanently_deleted")
        );

        let metadata = &event.envelope["metadata"];
        assert_eq!(metadata["chat_id"], json!(chat_id));
        assert_eq!(metadata["actor_user_id"], Value::Null);
        assert_eq!(metadata["project_id"], Value::Null);
    }
}

#[tokio::test]
async fn publish_chat_purge_events_returns_immediate_send_failures() {
    let event_broker = FakeEventBroker::failing_send();
    let chat_ids = vec!["chat-one".to_string()];

    let error = publish_chat_purge_events(&event_broker, &chat_ids)
        .await
        .expect_err("immediate send failure should be returned");

    assert!(format!("{error:#}").contains("event enqueue rejected"));
}

#[tokio::test]
async fn publish_chat_purge_events_returns_delivery_failures() {
    let event_broker = FakeEventBroker::failing_delivery();
    let chat_ids = vec!["chat-one".to_string()];

    let error = publish_chat_purge_events(&event_broker, &chat_ids)
        .await
        .expect_err("delivery failure should be returned");

    assert!(format!("{error:#}").contains("publisher unavailable"));
}

#[tokio::test]
async fn publish_chat_purge_events_returns_delivery_join_failures() {
    let event_broker = FakeEventBroker::failing_join();
    let chat_ids = vec!["chat-one".to_string()];

    let error = publish_chat_purge_events(&event_broker, &chat_ids)
        .await
        .expect_err("delivery join failure should be returned");

    assert!(
        format!("{error:#}").contains("chat purge event publication task failed"),
        "unexpected error: {error:#}"
    );
}

#[tokio::test]
async fn publish_chat_purge_events_waits_for_every_delivery() {
    let delivery_gate = Arc::new(Semaphore::new(0));
    let event_broker = FakeEventBroker::waiting_for_delivery(delivery_gate.clone());
    let chat_ids = vec!["chat-one".to_string(), "chat-two".to_string()];

    let publication_task = tokio::spawn({
        let event_broker = event_broker.clone();
        let chat_ids = chat_ids.clone();
        async move { publish_chat_purge_events(&event_broker, &chat_ids).await }
    });

    while event_broker.published().len() < chat_ids.len() {
        tokio::task::yield_now().await;
    }

    assert!(!publication_task.is_finished());

    delivery_gate.add_permits(chat_ids.len());
    publication_task.await.unwrap().unwrap();
}
