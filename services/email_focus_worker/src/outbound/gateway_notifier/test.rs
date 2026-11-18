use std::collections::BTreeSet;

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};
use tokio::{sync::mpsc, time::Instant};
use wiremock::{Mock, MockServer, ResponseTemplate, matchers};

use super::*;

/// Records each push and when it went out.
struct FakeDelivery {
    pushes: mpsc::UnboundedSender<(Uuid, Instant)>,
}

impl FocusDelivery for FakeDelivery {
    async fn deliver(&self, _owner: &MacroUserIdStr<'static>, link_id: Uuid) {
        self.pushes.send((link_id, Instant::now())).unwrap();
    }
}

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@acme.example").unwrap()
}

fn notifier() -> (
    CoalescingNotifier<FakeDelivery>,
    mpsc::UnboundedReceiver<(Uuid, Instant)>,
    TaskTracker,
    CancellationToken,
) {
    let (pushes, pushed) = mpsc::unbounded_channel();
    let tracker = TaskTracker::new();
    let shutdown = CancellationToken::new();
    let notifier =
        CoalescingNotifier::new(FakeDelivery { pushes }, tracker.clone(), shutdown.clone());
    (notifier, pushed, tracker, shutdown)
}

#[tokio::test(start_paused = true)]
async fn one_classification_pushes_at_once_and_repeats_for_the_replica() {
    let (notifier, mut pushed, tracker, _shutdown) = notifier();
    let link_id = Uuid::now_v7();
    let start = Instant::now();

    notifier.focus_changed(&owner(), link_id);

    assert_eq!(pushed.recv().await.unwrap(), (link_id, start));
    assert_eq!(
        pushed.recv().await.unwrap(),
        (link_id, start + NOTIFY_WINDOW)
    );

    // The window closes one quiet window later and there is nothing more to say.
    tracker.close();
    tracker.wait().await;
    assert_eq!(start.elapsed(), NOTIFY_WINDOW * 2);
    assert!(pushed.try_recv().is_err());
}

#[tokio::test(start_paused = true)]
async fn a_burst_in_one_inbox_collapses_into_few_pushes() {
    let (notifier, mut pushed, tracker, _shutdown) = notifier();
    let link_id = Uuid::now_v7();
    let start = Instant::now();

    for _ in 0..20 {
        notifier.focus_changed(&owner(), link_id);
    }

    // At once, then the rest together, then the repeat for the replica.
    assert_eq!(pushed.recv().await.unwrap().1, start);
    assert_eq!(pushed.recv().await.unwrap().1, start + NOTIFY_WINDOW);
    assert_eq!(pushed.recv().await.unwrap().1, start + NOTIFY_WINDOW * 2);
    tracker.close();
    tracker.wait().await;
    assert!(pushed.try_recv().is_err());
}

#[tokio::test(start_paused = true)]
async fn a_classification_after_the_window_closes_pushes_at_once_again() {
    let (notifier, mut pushed, _tracker, _shutdown) = notifier();
    let link_id = Uuid::now_v7();

    notifier.focus_changed(&owner(), link_id);
    pushed.recv().await.unwrap();
    pushed.recv().await.unwrap();
    tokio::time::sleep(NOTIFY_WINDOW * 2).await;

    let later = Instant::now();
    notifier.focus_changed(&owner(), link_id);
    assert_eq!(pushed.recv().await.unwrap().1, later);
}

#[tokio::test(start_paused = true)]
async fn inboxes_do_not_share_a_window() {
    let (notifier, mut pushed, _tracker, _shutdown) = notifier();
    let (first, second) = (Uuid::now_v7(), Uuid::now_v7());
    let start = Instant::now();

    notifier.focus_changed(&owner(), first);
    notifier.focus_changed(&owner(), second);

    let pushes = [pushed.recv().await.unwrap(), pushed.recv().await.unwrap()];
    assert_eq!(pushes[0].1, start);
    assert_eq!(pushes[1].1, start);
    assert_eq!(
        BTreeSet::from([pushes[0].0, pushes[1].0]),
        BTreeSet::from([first, second])
    );
}

#[tokio::test(start_paused = true)]
async fn shutdown_ends_an_open_window_without_waiting_for_it() {
    let (notifier, mut pushed, tracker, shutdown) = notifier();
    let start = Instant::now();

    notifier.focus_changed(&owner(), Uuid::now_v7());
    pushed.recv().await.unwrap();

    shutdown.cancel();
    tracker.close();
    tracker.wait().await;
    assert_eq!(start.elapsed(), Duration::ZERO);
}

/// Link f02 in the Focus fixtures: held by `other@elsewhere.example`, delegated
/// to `owner@acme.example`.
const DELEGATED_LINK: Uuid = uuid::uuid!("00000000-0000-0000-0000-000000000f02");

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../crates/email/fixtures",
        scripts("email_focus", "email_focus_linked")
    )
)]
async fn a_push_reaches_the_owner_and_delegates_as_one_refresh_email(pool: Pool<Postgres>) {
    let gateway = MockServer::start().await;
    Mock::given(matchers::method("POST"))
        .and(matchers::path("/message/batch_send"))
        .and(matchers::header("x-internal-auth-key", "test-key"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "receipts": [{"user_id": "macro|other@elsewhere.example", "delivery_count": 2, "active": true}],
        })))
        .expect(1)
        .mount(&gateway)
        .await;
    let delivery = GatewayDelivery::new(
        ConnectionGatewayClient::new("test-key".to_owned(), gateway.uri()),
        pool,
    );

    let holder = MacroUserIdStr::try_from_email("other@elsewhere.example").unwrap();
    delivery.deliver(&holder, DELEGATED_LINK).await;

    let requests = gateway.received_requests().await.unwrap();
    let body: serde_json::Value = serde_json::from_slice(&requests[0].body).unwrap();
    assert_eq!(body["message_type"], "refresh_email");
    assert_eq!(body["message"]["event"], "focus_updated");
    assert_eq!(body["message"]["link_id"], DELEGATED_LINK.to_string());
    let readers = body["entities"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entity| entity["entity_id"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(
        readers,
        ["macro|other@elsewhere.example", "macro|owner@acme.example"]
    );
}
