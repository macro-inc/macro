//! Routing at ingress: the stored lane decides how a recipient is delivered to.

use super::*;
use crate::domain::models::NotificationLane;
use crate::domain::models::routing::{RecipientRoute, RoutedNotification};
use crate::domain::ports::NotificationRouter;

/// Router that answers with fixed routes and records who it was asked about.
struct FixedRouter {
    routes: Option<RecipientRoutes>,
    asked: Arc<Mutex<Vec<HashSet<MacroUserIdStr<'static>>>>>,
}

impl FixedRouter {
    fn capturing(recipient: &MacroUserIdStr<'static>) -> Self {
        Self {
            routes: Some(HashMap::from([(
                recipient.clone(),
                RecipientRoute {
                    lane: NotificationLane::Noise,
                    stack_id: Some(Uuid::nil()),
                    routing: json!({ "outcome": "captured" }),
                },
            )])),
            asked: Arc::default(),
        }
    }

    fn failing() -> Self {
        Self {
            routes: None,
            asked: Arc::default(),
        }
    }
}

impl NotificationRouter for FixedRouter {
    async fn route<T: Serialize + Send + Sync>(
        &self,
        notification: RoutedNotification<'_, T>,
    ) -> Result<RecipientRoutes, Report> {
        self.asked.lock().unwrap().push(
            notification
                .recipients
                .iter()
                .map(|recipient| recipient.clone().into_owned())
                .collect(),
        );
        self.routes.clone().ok_or_else(|| report!("router down"))
    }
}

/// Digest state machine that records whose notifications it was given.
struct RecordingStateMachine {
    ingested: Arc<Mutex<Vec<MacroUserIdStr<'static>>>>,
}

impl BulkDigestStateMachine for RecordingStateMachine {
    async fn ingest<T: Serialize + Send + Sync + 'static>(
        &self,
        notif: UserNotificationRow<Arc<T>>,
    ) -> Result<crate::domain::models::email_notification_digest::StateMachineDecisionA, Report>
    {
        self.ingested.lock().unwrap().push(notif.owner_id);
        Err(report!("not implemented"))
    }
}

fn request_to(
    recipients: [MacroUserIdStr<'static>; 2],
) -> SendNotificationRequestBuilder<'static, TestNotification> {
    SendNotificationRequestBuilder {
        notification_entity: EntityType::Channel.with_entity_str("channel"),
        secondary_notification_entity: None,
        notification: TestNotification {
            message: "Hello".to_string(),
        },
        sender_id: None,
        recipient_ids: HashSet::from(recipients),
    }
}

/// The recipients of each connection gateway message, by the lane it names.
fn realtime_recipients(published: &[serde_json::Value]) -> HashMap<String, Vec<String>> {
    published
        .iter()
        .filter_map(|message| message["content"]["ConnGateway"].as_object())
        .map(|conn| {
            let mut recipients: Vec<String> = conn["recipients"]
                .as_array()
                .unwrap()
                .iter()
                .map(|recipient| recipient.as_str().unwrap().to_string())
                .collect();
            recipients.sort();
            (
                conn["notif"]["lane"].as_str().unwrap().to_string(),
                recipients,
            )
        })
        .collect()
}

#[tokio::test]
async fn a_captured_recipient_gets_the_live_row_and_nothing_else() {
    let captured = test_user_id("captured@example.com");
    let natural = test_user_id("natural@example.com");
    let queue = Arc::new(MockQueue::new());
    let repo = MockRepository::new()
        .with_device_endpoint(captured.clone(), DeviceEndpoint::Ios("captured-ios".into()))
        .with_device_endpoint(
            captured.clone(),
            DeviceEndpoint::Android("captured-android".into()),
        )
        .with_device_endpoint(natural.clone(), DeviceEndpoint::Ios("natural-ios".into()));
    let ingested = Arc::new(Mutex::new(Vec::new()));
    let service = NotificationIngressService::new(
        repo,
        queue.clone(),
        RecordingStateMachine {
            ingested: ingested.clone(),
        },
    )
    .with_router(FixedRouter::capturing(&captured));

    let result = service
        .send_notification(
            request_to([captured.clone(), natural.clone()])
                .into_request()
                .with_conn_gateway()
                .with_apns()
                .with_email(),
        )
        .await
        .unwrap()
        .unwrap();

    // Both recipients have a row.
    assert_eq!(
        result.notified_recipients,
        HashSet::from([captured.clone(), natural.clone()])
    );

    let published = queue.get_published();
    assert_eq!(
        realtime_recipients(&published),
        HashMap::from([
            ("signal".to_string(), vec![natural.to_string()]),
            ("noise".to_string(), vec![captured.to_string()]),
        ])
    );

    let pushes: Vec<&serde_json::Value> = published
        .iter()
        .filter(|message| message["content"]["Ios"].is_object())
        .collect();
    assert_eq!(pushes.len(), 1);
    let pushed_to = pushes[0]["content"]["Ios"]["ios_device_endpoints"]
        .as_object()
        .unwrap();
    assert_eq!(pushed_to.keys().collect::<Vec<_>>(), vec![natural.as_ref()]);

    let emailed: Vec<&str> = published
        .iter()
        .filter_map(|message| message["content"]["Email"]["to"].as_str())
        .collect();
    assert_eq!(emailed, vec![natural.as_ref()]);

    assert_eq!(*ingested.lock().unwrap(), vec![natural]);
}

#[tokio::test]
async fn a_notification_everyone_captured_is_never_pushed() {
    let first = test_user_id("first@example.com");
    let second = test_user_id("second@example.com");
    let queue = Arc::new(MockQueue::new());
    let repo = MockRepository::new()
        .with_device_endpoint(first.clone(), DeviceEndpoint::Ios("first-ios".into()))
        .with_device_endpoint(second.clone(), DeviceEndpoint::Android("second".into()));
    let mut router = FixedRouter::capturing(&first);
    let route = router.routes.as_ref().unwrap()[&first].clone();
    router
        .routes
        .as_mut()
        .unwrap()
        .insert(second.clone(), route);
    let service =
        NotificationIngressService::new(repo, queue.clone(), MockStateMachine).with_router(router);

    service
        .send_notification(
            request_to([first.clone(), second.clone()])
                .into_request()
                .with_conn_gateway()
                .with_apns(),
        )
        .await
        .unwrap();

    let published = queue.get_published();
    assert_eq!(published.len(), 1);
    let mut both = vec![first.to_string(), second.to_string()];
    both.sort();
    assert_eq!(
        realtime_recipients(&published),
        HashMap::from([("noise".to_string(), both)])
    );
}

#[tokio::test]
async fn a_failed_router_delivers_to_everyone_as_signal() {
    let first = test_user_id("first@example.com");
    let second = test_user_id("second@example.com");
    let queue = Arc::new(MockQueue::new());
    let service =
        NotificationIngressService::new(MockRepository::new(), queue.clone(), MockStateMachine)
            .with_router(FixedRouter::failing());

    service
        .send_notification(
            request_to([first.clone(), second.clone()])
                .into_request()
                .with_conn_gateway(),
        )
        .await
        .unwrap();

    let mut both = vec![first.to_string(), second.to_string()];
    both.sort();
    assert_eq!(
        realtime_recipients(&queue.get_published()),
        HashMap::from([("signal".to_string(), both)])
    );
}

#[tokio::test]
async fn the_router_is_asked_about_recipients_left_after_filtering() {
    let muted = test_user_id("muted@example.com");
    let recipient = test_user_id("recipient@example.com");
    let router = FixedRouter::capturing(&recipient);
    let asked = router.asked.clone();
    let service = NotificationIngressService::new(
        MockRepository::new().with_muted_user(muted.clone()),
        MockQueue::new(),
        MockStateMachine,
    )
    .with_router(router);

    service
        .send_notification(request_to([muted, recipient.clone()]).into_request())
        .await
        .unwrap();

    assert_eq!(*asked.lock().unwrap(), vec![HashSet::from([recipient])]);
}
