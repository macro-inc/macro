use super::*;
use crate::domain::{
    models::{
        email_notification_digest::{BulkDigestStateMachine, StateMachineDecisionA},
        queue_message::{QueueMessage, RawQueueMessage},
    },
    ports::NotificationQueue,
    service::{NotificationIngress, NotificationIngressService},
};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};

struct FailFirstQueue {
    attempts: AtomicUsize,
    published: Mutex<Vec<serde_json::Value>>,
}

impl NotificationQueue for Arc<FailFirstQueue> {
    async fn publish<'a, T: Serialize + Send + Sync, U: Serialize + Send + Sync>(
        &self,
        messages: Vec<QueueMessage<'a, T, U>>,
    ) -> Result<(), Report> {
        if self.attempts.fetch_add(1, Ordering::SeqCst) == 0 {
            return Err(rootcause::report!("delivery queue is unavailable"));
        }
        self.published.lock().unwrap().extend(
            messages
                .into_iter()
                .map(|message| serde_json::to_value(message).unwrap()),
        );
        Ok(())
    }

    async fn receive_messages(&self) -> Result<Vec<RawQueueMessage>, Report> {
        Ok(Vec::new())
    }

    async fn delete_message(&self, _receipt_handle: &str) -> Result<(), Report> {
        Ok(())
    }
}

struct NoDigest;
impl BulkDigestStateMachine for NoDigest {
    async fn ingest<T: Serialize + Send + Sync + 'static>(
        &self,
        _notification: UserNotificationRow<Arc<T>>,
    ) -> Result<StateMachineDecisionA, Report> {
        Err(rootcause::report!(
            "digest delivery is not used in this test"
        ))
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn failed_publication_retries_original_recipients_without_resetting_state(
    pool: Pool<Postgres>,
) {
    let queue = Arc::new(FailFirstQueue {
        attempts: AtomicUsize::new(0),
        published: Mutex::new(Vec::new()),
    });
    let service = NotificationIngressService::new(
        DbNotificationRepository::new(pool.clone()),
        queue.clone(),
        NoDigest,
    );
    let id = Uuid::now_v7();
    let recipient = test_user("recipient@test.com");
    let unseen_recipient = test_user("unseen@test.com");
    let builder = SendNotificationRequestBuilder {
        notification_entity: EntityType::Document.with_entity_str("doc-1"),
        secondary_notification_entity: None,
        notification: TestNotification {
            message: "hello".to_owned(),
        },
        sender_id: None,
        recipient_ids: HashSet::from([recipient.clone(), unseen_recipient.clone()]),
    };
    assert!(
        service
            .send_notification(builder.clone().into_request_with_id(id).with_conn_gateway())
            .await
            .is_err()
    );
    let rows = pool
        .mark_notifications_seen(&recipient, &[id])
        .await
        .unwrap();
    assert_eq!(rows.len(), 1);
    let viewed_at = rows[0].viewed_at;
    assert_eq!(rows[0].state, NotificationState::Seen);

    let mut retry = builder.clone();
    retry.recipient_ids.insert(test_user("unexpected@test.com"));
    let result = service
        .send_notification(retry.into_request_with_id(id).with_conn_gateway())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        result.notified_recipients,
        HashSet::from([unseen_recipient.clone()])
    );
    assert_eq!(queue.published.lock().unwrap().len(), 1);

    let duplicate = service
        .send_notification(builder.into_request_with_id(id).with_conn_gateway())
        .await
        .unwrap()
        .unwrap();
    assert!(duplicate.notified_recipients.is_empty());
    assert_eq!(queue.attempts.load(Ordering::SeqCst), 2);
    let stored = sqlx::query!(r#"SELECT user_id, state AS "state: NotificationState", seen_at::timestamptz AS viewed_at FROM user_notification WHERE notification_id = $1 ORDER BY user_id"#, id).fetch_all(&pool).await.unwrap();
    assert_eq!(stored.len(), 2);
    assert_eq!(stored[0].user_id, recipient.as_ref());
    assert_eq!(stored[0].state, NotificationState::Seen);
    assert_eq!(stored[0].viewed_at, viewed_at);
    assert_eq!(stored[1].user_id, unseen_recipient.as_ref());
    assert_eq!(stored[1].state, NotificationState::Unseen);
}
