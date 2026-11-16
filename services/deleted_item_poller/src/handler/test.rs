use std::sync::{Arc, Mutex};

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_event_broker::{EventBrokerError, MacroEvent, MacroEventBroker};
use serde_json::{Value, json};
use sqlx::{Pool, Postgres};
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
    FailKey(&'static str),
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

    fn failing_delivery_for(key: &'static str) -> Self {
        Self {
            delivery_behavior: DeliveryBehavior::FailKey(key),
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
            DeliveryBehavior::FailKey(key) if key == event.key() => tokio::spawn(async {
                Err(EventBrokerError::Publish(
                    "publisher unavailable".to_string(),
                ))
            }),
            DeliveryBehavior::FailKey(_) => tokio::spawn(async { Ok(()) }),
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
    let mut run = DocumentPurgeRun::default();

    let delivered =
        publish_document_purge_events(&event_broker, document_ids.clone(), &mut run).await;

    assert_eq!(delivered, document_ids);
    assert_eq!(run.events_published, 2);
    assert_eq!(run.events_failed, 0);

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
async fn publish_document_purge_events_reports_immediate_send_failures() {
    let event_broker = FakeEventBroker::failing_send();
    let mut run = DocumentPurgeRun::default();

    let delivered =
        publish_document_purge_events(&event_broker, vec!["document-one".to_string()], &mut run)
            .await;

    assert!(delivered.is_empty());
    assert_eq!(run.events_failed, 1);
    let error = run.first_failure.expect("the failure should be kept");
    assert!(format!("{error:#}").contains("event enqueue rejected"));
}

#[tokio::test]
async fn publish_document_purge_events_reports_delivery_failures() {
    let event_broker = FakeEventBroker::failing_delivery();
    let mut run = DocumentPurgeRun::default();

    let delivered =
        publish_document_purge_events(&event_broker, vec!["document-one".to_string()], &mut run)
            .await;

    assert!(delivered.is_empty());
    assert_eq!(run.events_failed, 1);
    let error = run.first_failure.expect("the failure should be kept");
    assert!(format!("{error:#}").contains("publisher unavailable"));
}

#[tokio::test]
async fn publish_document_purge_events_reports_delivery_join_failures() {
    let event_broker = FakeEventBroker::failing_join();
    let mut run = DocumentPurgeRun::default();

    let delivered =
        publish_document_purge_events(&event_broker, vec!["document-one".to_string()], &mut run)
            .await;

    assert!(delivered.is_empty());
    let error = run.first_failure.expect("the failure should be kept");
    assert!(
        format!("{error:#}").contains("document purge event publication task failed"),
        "unexpected error: {error:#}"
    );
}

#[tokio::test]
async fn publish_document_purge_events_returns_only_delivered_documents() {
    let event_broker = FakeEventBroker::failing_delivery_for("document-two");
    let document_ids = vec![
        "document-one".to_string(),
        "document-two".to_string(),
        "document-three".to_string(),
    ];
    let mut run = DocumentPurgeRun::default();

    let delivered = publish_document_purge_events(&event_broker, document_ids, &mut run).await;

    assert_eq!(
        delivered,
        vec!["document-one".to_string(), "document-three".to_string()]
    );
    assert_eq!(run.events_published, 2);
    assert_eq!(run.events_failed, 1);
}

#[tokio::test]
async fn publish_document_purge_events_waits_for_every_delivery() {
    let delivery_gate = Arc::new(Semaphore::new(0));
    let event_broker = FakeEventBroker::waiting_for_delivery(delivery_gate.clone());
    let document_ids = vec!["document-one".to_string(), "document-two".to_string()];

    let publication_task = tokio::spawn({
        let event_broker = event_broker.clone();
        let document_ids = document_ids.clone();
        async move {
            let mut run = DocumentPurgeRun::default();
            publish_document_purge_events(&event_broker, document_ids, &mut run).await
        }
    });

    while event_broker.published().len() < document_ids.len() {
        tokio::task::yield_now().await;
    }

    assert!(!publication_task.is_finished());

    delivery_gate.add_permits(1);
    tokio::task::yield_now().await;
    assert!(!publication_task.is_finished());

    delivery_gate.add_permits(1);
    assert_eq!(publication_task.await.unwrap(), document_ids);
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
    let projects = vec![
        ProjectToDelete {
            project_id: "project-one".to_string(),
            user_id: "not-a-macro-user".to_string(),
        },
        ProjectToDelete {
            project_id: "project-two".to_string(),
            user_id: "macro|owner@example.com".to_string(),
        },
    ];

    let error = publish_project_purge_events(&event_broker, &projects)
        .await
        .expect_err("malformed owners should fail the whole batch");

    assert!(format!("{error:#}").contains("invalid owner for project project-one"));
    assert!(event_broker.published().is_empty());
}

#[tokio::test]
async fn publish_project_purge_events_accepts_bot_owners() {
    let event_broker = FakeEventBroker::default();
    let projects = vec![ProjectToDelete {
        project_id: "project-bot".to_string(),
        user_id: "bot|00000000-0000-0000-0000-00000000a1a1".to_string(),
    }];

    publish_project_purge_events(&event_broker, &projects)
        .await
        .unwrap();

    let published = event_broker.published();
    assert_eq!(published.len(), 1);
    assert_eq!(
        published[0].envelope["metadata"]["owner"],
        json!("bot|00000000-0000-0000-0000-00000000a1a1")
    );
}

#[tokio::test]
async fn publish_project_purge_events_accepts_team_owners() {
    let event_broker = FakeEventBroker::default();
    let projects = vec![ProjectToDelete {
        project_id: "project-team".to_string(),
        user_id: "01234567-89ab-cdef-0123-456789abcdef".to_string(),
    }];

    publish_project_purge_events(&event_broker, &projects)
        .await
        .unwrap();

    let published = event_broker.published();
    assert_eq!(published.len(), 1);
    assert_eq!(
        published[0].envelope["metadata"]["owner"],
        json!("01234567-89ab-cdef-0123-456789abcdef")
    );
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

#[derive(Clone, Debug)]
struct DeleteBatchSend {
    document_ids: Vec<String>,
    /// Purge events the broker had published when this batch was sent.
    events_published_before: usize,
    sent: bool,
}

/// Records every document delete batch, and fails the batches that hold
/// `failing_document`.
#[derive(Clone, Default)]
struct FakeDeleteQueue {
    sends: Arc<Mutex<Vec<DeleteBatchSend>>>,
    published: Arc<Mutex<Vec<PublishedEvent>>>,
    failing_document: Option<&'static str>,
}

impl FakeDeleteQueue {
    fn watching(event_broker: &FakeEventBroker) -> Self {
        Self {
            published: event_broker.published.clone(),
            ..Self::default()
        }
    }

    fn failing_batches_with(event_broker: &FakeEventBroker, document_id: &'static str) -> Self {
        Self {
            failing_document: Some(document_id),
            ..Self::watching(event_broker)
        }
    }

    fn sends(&self) -> Vec<DeleteBatchSend> {
        self.sends.lock().unwrap().clone()
    }

    /// The documents of every batch that was sent, sorted.
    fn enqueued(&self) -> Vec<String> {
        let mut document_ids = self
            .sends()
            .into_iter()
            .filter(|send| send.sent)
            .flat_map(|send| send.document_ids)
            .collect::<Vec<_>>();
        document_ids.sort();
        document_ids
    }
}

impl DocumentDeleteQueue for FakeDeleteQueue {
    async fn enqueue(&self, document_ids: Vec<String>) -> anyhow::Result<()> {
        let sent = !self
            .failing_document
            .is_some_and(|failing| document_ids.iter().any(|id| id == failing));
        let events_published_before = self.published.lock().unwrap().len();
        self.sends.lock().unwrap().push(DeleteBatchSend {
            document_ids,
            events_published_before,
            sent,
        });

        if !sent {
            anyhow::bail!("delete queue unavailable");
        }
        Ok(())
    }
}

/// Do what the storage service's delete worker does with every queued
/// document: remove it from the table.
async fn drain_delete_queue(
    pool: &Pool<Postgres>,
    delete_queue: &FakeDeleteQueue,
) -> anyhow::Result<()> {
    let document_ids = delete_queue.enqueued();
    sqlx::query!(
        r#"DELETE FROM "Document" WHERE id = ANY($1)"#,
        &document_ids
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "test/fixtures", scripts("expired_documents"))
)]
async fn purge_stops_at_the_cap_and_leaves_the_rest_for_the_next_run(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let cutoff = "2026-02-01T00:00:00".parse()?;
    let limits = DocumentPurgeLimits {
        run_cap: 20,
        page_size: 10,
    };
    let deadline = SystemTime::now() + Duration::from_secs(600);
    let event_broker = FakeEventBroker::default();
    let delete_queue = FakeDeleteQueue::watching(&event_broker);

    let first = purge_expired_documents(
        &pool,
        &event_broker,
        &delete_queue,
        cutoff,
        limits,
        deadline,
    )
    .await?;

    let oldest_twenty = (1..=20)
        .map(|n| format!("expired-{n:02}"))
        .collect::<Vec<_>>();
    assert_eq!(delete_queue.enqueued(), oldest_twenty);
    assert_eq!(event_broker.published().len(), 20);
    assert_eq!(first.selected, 20);
    assert_eq!(first.enqueued, 20);
    assert!(first.cap_reached);
    assert_eq!(first.oldest_remaining, Some("2026-01-01T07:00:00".parse()?));

    drain_delete_queue(&pool, &delete_queue).await?;
    let second = purge_expired_documents(
        &pool,
        &event_broker,
        &delete_queue,
        cutoff,
        limits,
        deadline,
    )
    .await?;

    let every_expired = (1..=25)
        .map(|n| format!("expired-{n:02}"))
        .collect::<Vec<_>>();
    assert_eq!(delete_queue.enqueued(), every_expired);
    assert_eq!(second.enqueued, 5);
    assert!(!second.cap_reached);
    assert_eq!(second.oldest_remaining, None);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "test/fixtures", scripts("expired_documents"))
)]
async fn purge_handles_a_page_at_a_time_in_sqs_sized_batches(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let limits = DocumentPurgeLimits {
        run_cap: 100,
        page_size: 15,
    };
    let event_broker = FakeEventBroker::default();
    let delete_queue = FakeDeleteQueue::watching(&event_broker);

    let run = purge_expired_documents(
        &pool,
        &event_broker,
        &delete_queue,
        "2026-02-01T00:00:00".parse()?,
        limits,
        SystemTime::now() + Duration::from_secs(600),
    )
    .await?;

    let sends = delete_queue.sends();
    assert_eq!(sends.len(), 3);
    assert!(sends.iter().all(|send| send.document_ids.len() <= 10));
    // The second page's events wait until the first page's deletes are queued.
    assert_eq!(sends[0].events_published_before, 15);
    assert_eq!(sends[1].events_published_before, 15);
    assert_eq!(sends[2].events_published_before, 25);
    assert_eq!(run.pages, 2);
    assert_eq!(run.delete_batches_sent, 3);
    assert_eq!(run.enqueued, 25);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "test/fixtures", scripts("expired_documents"))
)]
async fn failed_delete_batch_is_retried_next_run(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let cutoff = "2026-02-01T00:00:00".parse()?;
    let limits = DocumentPurgeLimits {
        run_cap: 100,
        page_size: 10,
    };
    let deadline = SystemTime::now() + Duration::from_secs(600);
    let event_broker = FakeEventBroker::default();
    let failing_queue = FakeDeleteQueue::failing_batches_with(&event_broker, "expired-05");

    let error = purge_expired_documents(
        &pool,
        &event_broker,
        &failing_queue,
        cutoff,
        limits,
        deadline,
    )
    .await
    .expect_err("a failed delete batch should fail the run");

    assert!(
        format!("{error:#}").contains("1 document delete batches failed"),
        "unexpected error: {error:#}"
    );
    let later_fifteen = (11..=25)
        .map(|n| format!("expired-{n:02}"))
        .collect::<Vec<_>>();
    assert_eq!(failing_queue.enqueued(), later_fifteen);

    drain_delete_queue(&pool, &failing_queue).await?;
    let retry_broker = FakeEventBroker::default();
    let healthy_queue = FakeDeleteQueue::watching(&retry_broker);
    let retry = purge_expired_documents(
        &pool,
        &retry_broker,
        &healthy_queue,
        cutoff,
        limits,
        deadline,
    )
    .await?;

    let failed_batch = (1..=10)
        .map(|n| format!("expired-{n:02}"))
        .collect::<Vec<_>>();
    assert_eq!(healthy_queue.enqueued(), failed_batch);
    // The failed batch's purge events go out again before it is queued.
    assert_eq!(retry_broker.published().len(), 10);
    assert_eq!(retry.enqueued, 10);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "test/fixtures", scripts("expired_documents"))
)]
async fn document_whose_purge_event_failed_waits_for_the_next_run(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let cutoff = "2026-02-01T00:00:00".parse()?;
    let limits = DocumentPurgeLimits {
        run_cap: 100,
        page_size: 10,
    };
    let deadline = SystemTime::now() + Duration::from_secs(600);
    let failing_broker = FakeEventBroker::failing_delivery_for("expired-05");
    let delete_queue = FakeDeleteQueue::watching(&failing_broker);

    let error = purge_expired_documents(
        &pool,
        &failing_broker,
        &delete_queue,
        cutoff,
        limits,
        deadline,
    )
    .await
    .expect_err("a failed purge event should fail the run");

    assert!(
        format!("{error:#}").contains("1 document purge events"),
        "unexpected error: {error:#}"
    );
    let enqueued = delete_queue.enqueued();
    assert_eq!(enqueued.len(), 24);
    assert!(!enqueued.contains(&"expired-05".to_string()));

    drain_delete_queue(&pool, &delete_queue).await?;
    let retry_broker = FakeEventBroker::default();
    let retry_queue = FakeDeleteQueue::watching(&retry_broker);
    purge_expired_documents(&pool, &retry_broker, &retry_queue, cutoff, limits, deadline).await?;

    assert_eq!(retry_queue.enqueued(), vec!["expired-05".to_string()]);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "test/fixtures", scripts("expired_documents"))
)]
async fn purge_starts_no_page_near_the_lambda_deadline(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let event_broker = FakeEventBroker::default();
    let delete_queue = FakeDeleteQueue::watching(&event_broker);

    let run = purge_expired_documents(
        &pool,
        &event_broker,
        &delete_queue,
        "2026-02-01T00:00:00".parse()?,
        DocumentPurgeLimits {
            run_cap: 100,
            page_size: 10,
        },
        SystemTime::now() + Duration::from_secs(10),
    )
    .await?;

    assert_eq!(run.selected, 0);
    assert!(run.deadline_reached);
    assert!(!run.cap_reached);
    assert_eq!(run.oldest_remaining, Some("2026-01-01T00:00:00".parse()?));
    assert!(event_broker.published().is_empty());
    assert!(delete_queue.sends().is_empty());

    Ok(())
}
