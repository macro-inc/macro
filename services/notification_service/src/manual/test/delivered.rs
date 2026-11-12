//! Manual notifications sent through the real access checks, feed check and
//! ingress land in the recipient's inbox and on Home, read through their real
//! services over Soup and Postgres; links those feeds would not list are
//! refused before anything is stored.

use std::collections::HashSet;
use std::sync::Arc;

use attention_feed::domain::models::FeedViewer;
use attention_feed::outbound::notifications::ReaderFeedNotifications;
use attention_feed::test_support::{FakeMail, FakeSignals};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use model_entity::{Entity, EntityType};
use model_notifications::NotifEvent;
use notification::domain::models::UserNotificationRow;
use notification::domain::models::email_notification_digest::{
    BulkDigestStateMachine, StateMachineDecisionA,
};
use notification::domain::models::queue_message::{QueueMessage, RawQueueMessage};
use notification::domain::ports::{
    NoopNotificationRealtimePublisher, NotificationQueue, SnsEndpointManager,
};
use notification::domain::service::{
    NotificationIngressService, NotificationReaderService, PlatformArnConfig,
};
use notification::outbound::repository::DbNotificationRepository;
use notification_inbox::domain::models::{InboxQuery, InboxScope};
use notification_inbox::domain::service::{NotificationInboxService, NotificationInboxServiceImpl};
use rootcause::Report;
use serde::Serialize;
use sqlx::{Pool, Postgres};
use work_feed::domain::models::{WorkFeedMode, WorkFeedQuery, WorkFeedScope};
use work_feed::domain::service::{WorkFeedService, WorkFeedServiceImpl};

use super::super::outbound::entity_access::EntityAccessLinks;
use super::super::outbound::feed_visibility::FeedCandidateVisibility;
use super::super::{
    ACCESS_CHECKED_TYPES, EMAIL_THREAD_LINKS, EmailThreadLinks, Feed, ManualNotificationDraft,
    ManualNotificationError, ManualNotifications, ManualSender, shown_in_inbox_and_home,
};
use super::{OneAgent, user};
use crate::wiring::{SoupCandidates, soup_candidates};

const USER_1: &str = "macro|user-1@example.com";
const USER_2: &str = "macro|user-2@example.com";
const USER_3: &str = "macro|user-3@example.com";

const DOC: &str = "11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const LINK_SHARED_DOC: &str = "11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const TRASHED_DOC: &str = "11111111-cccc-cccc-cccc-cccccccccccc";
const SNIPPET: &str = "11111111-dddd-dddd-dddd-dddddddddddd";
const SHARED_JUST_NOW: &str = "11111111-eeee-eeee-eeee-eeeeeeeeeeee";
const OWN_THREAD: &str = "44444444-0000-0000-0000-000000000001";
const TEAMMATES_THREAD: &str = "44444444-0000-0000-0000-000000000002";
const NOISE_THREAD: &str = "44444444-0000-0000-0000-000000000003";
const LISTED_SESSION: &str = "77777777-0000-0000-0000-000000000001";
const UNLISTED_SESSION: &str = "77777777-0000-0000-0000-000000000002";
const HIDDEN_SESSION: &str = "77777777-0000-0000-0000-000000000003";

/// The entity of each linkable kind that `viewer` can be notified about.
fn linkable_for(viewer: &str, entity_type: EntityType) -> Option<&'static str> {
    match entity_type {
        EntityType::Document => Some(DOC),
        EntityType::Chat => Some("22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        EntityType::Channel => Some("33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        EntityType::Project => Some("66666666-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        // Mail is listed only in its owner's inbox.
        EntityType::EmailThread if viewer == USER_1 => Some(OWN_THREAD),
        EntityType::EmailThread => Some(TEAMMATES_THREAD),
        EntityType::AgentSession => Some(LISTED_SESSION),
        _ => None,
    }
}

/// Delivery publishes nowhere; the rows the ingress writes are what count.
struct NoDelivery;

impl NotificationQueue for NoDelivery {
    async fn publish<'a, T: Serialize + Send + Sync, U: Serialize + Send + Sync>(
        &self,
        _messages: Vec<QueueMessage<'a, T, U>>,
    ) -> Result<(), Report> {
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
        Err(rootcause::report!("digest email is not part of this test"))
    }
}

struct NoSns;

impl SnsEndpointManager for NoSns {
    async fn create_platform_endpoint(
        &self,
        _platform_arn: &str,
        _token: &str,
    ) -> Result<String, Report> {
        rootcause::bail!("no SNS in this test")
    }

    async fn get_endpoint_attributes(
        &self,
        _endpoint_arn: &str,
    ) -> Result<std::collections::HashMap<String, String>, Report> {
        rootcause::bail!("no SNS in this test")
    }

    async fn set_endpoint_attributes(
        &self,
        _endpoint_arn: &str,
        _attributes: std::collections::HashMap<String, String>,
    ) -> Result<(), Report> {
        rootcause::bail!("no SNS in this test")
    }

    async fn delete_endpoint(&self, _endpoint_arn: &str) -> Result<(), Report> {
        rootcause::bail!("no SNS in this test")
    }
}

fn sender() -> ManualSender {
    ManualSender {
        user: user(USER_1),
        opaque_id: "fa-user-1".to_string(),
        agent_id: None,
    }
}

fn draft(recipient: Option<&str>, link: Entity<'static>) -> ManualNotificationDraft {
    ManualNotificationDraft {
        recipient: recipient.map(user),
        title: format!("{} finished", link.entity_type),
        body: None,
        link,
    }
}

type Notifications = ManualNotifications<
    EntityAccessLinks<
        entity_access::domain::service::EntityAccessServiceImpl<
            entity_access::outbound::PgAccessRepository,
        >,
    >,
    FeedCandidateVisibility<SoupCandidates>,
    OneAgent,
    NotificationIngressService<DbNotificationRepository<Pool<Postgres>>, NoDelivery, NoDigest>,
>;

/// The service as `main.rs` wires it, with a database ingress in place of SQS.
fn notifications(pool: &Pool<Postgres>) -> Notifications {
    ManualNotifications {
        access: EntityAccessLinks(
            entity_access::domain::service::EntityAccessServiceImpl::new(
                entity_access::outbound::PgAccessRepository::new(pool.clone()),
            ),
        ),
        feeds: FeedCandidateVisibility(soup_candidates(pool.clone())),
        agents: OneAgent,
        ingress: NotificationIngressService::new(
            DbNotificationRepository::new(pool.clone()),
            NoDelivery,
            NoDigest,
        ),
    }
}

/// The entities with a manual notification in `viewer`'s inbox and on their
/// Home, read through the real services.
async fn listed_manual(
    pool: &Pool<Postgres>,
    viewer: &str,
) -> (HashSet<Entity<'static>>, HashSet<Entity<'static>>) {
    let reader = Arc::new(NotificationReaderService {
        repository: DbNotificationRepository::new(pool.clone()),
        queue: NoDelivery,
        sns_endpoint: NoSns,
        platform_config: PlatformArnConfig {
            apns_platform_arn: String::new(),
            fcm_platform_arn: String::new(),
            apns_voip_platform_arn: String::new(),
        },
        realtime: NoopNotificationRealtimePublisher,
    });
    let viewer = FeedViewer {
        user: user(viewer),
        team: None,
    };
    let manual = |notification: &&Arc<UserNotificationRow<NotifEvent>>| {
        matches!(notification.notification_metadata, NotifEvent::Manual(_))
    };

    let inbox = NotificationInboxServiceImpl::new(
        soup_candidates(pool.clone()),
        ReaderFeedNotifications::new(reader.clone()),
        FakeMail::default(),
        FakeSignals::default(),
    )
    .page(
        viewer.clone(),
        InboxQuery {
            scope: InboxScope::default(),
            limit: 50,
            after: None,
        },
    )
    .await
    .unwrap()
    .entries
    .into_iter()
    .filter(|entry| {
        entry
            .rows
            .iter()
            .any(|row| row.all_notifications().any(|n| manual(&n)))
    })
    .map(|entry| entry.group.entity().clone())
    .collect();

    let home = WorkFeedServiceImpl::new(
        soup_candidates(pool.clone()),
        ReaderFeedNotifications::new(reader),
        FakeMail::default(),
        FakeSignals::default(),
    )
    .page(
        viewer,
        WorkFeedQuery {
            scope: WorkFeedScope {
                mode: WorkFeedMode::Work,
                types: Vec::new(),
                include_snippets: false,
            },
            state: None,
            limit: 50,
            after: None,
        },
    )
    .await
    .unwrap()
    .entries
    .into_iter()
    .filter(|entry| entry.item.notifications.iter().any(|n| manual(&n)))
    .map(|entry| entry.item.key.entity().clone())
    .collect();

    (inbox, home)
}

async fn stored(pool: &Pool<Postgres>) -> i64 {
    sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM notification WHERE notification_event_type = 'manual'"#
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Sends a notification about one entity of every linkable kind to
/// `recipient` (`None`: to oneself), refusing the kinds the feeds never
/// list, and returns the links that were sent.
async fn send_every_kind(
    notifications: &Notifications,
    recipient: Option<&str>,
) -> HashSet<Entity<'static>> {
    let viewer = recipient.unwrap_or(USER_1);
    let mut sent = HashSet::new();
    for entity_type in ACCESS_CHECKED_TYPES {
        let id = linkable_for(viewer, entity_type)
            .map(str::to_string)
            .unwrap_or_else(|| uuid::Uuid::now_v7().to_string());
        let link = entity_type.with_entity_string(id);
        let result = notifications
            .send(sender(), draft(recipient, link.clone()))
            .await;
        if shown_in_inbox_and_home(entity_type) {
            assert!(
                linkable_for(viewer, entity_type).is_some(),
                "give the fixture a {entity_type} {viewer} can be notified about"
            );
            result.unwrap_or_else(|error| panic!("{entity_type} to {viewer}: {error:?}"));
            sent.insert(link);
        } else {
            assert!(
                matches!(result, Err(ManualNotificationError::NotShownInInbox(refused)) if refused == entity_type),
                "{entity_type}: {result:?}"
            );
        }
    }
    sent
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("manual_links"))
)]
async fn every_linkable_kind_reaches_a_recipients_inbox_and_home(pool: Pool<Postgres>) {
    let notifications = notifications(&pool);
    let sent = send_every_kind(&notifications, Some(USER_2)).await;
    assert_eq!(sent.len(), 6);

    let (inbox, home) = listed_manual(&pool, USER_2).await;
    assert_eq!(
        inbox, sent,
        "the recipient's inbox groups with a manual notification"
    );
    assert_eq!(
        home, sent,
        "the recipient's Home items with a manual notification"
    );
    let (sender_inbox, sender_home) = listed_manual(&pool, USER_1).await;
    assert!(
        sender_inbox.is_empty() && sender_home.is_empty(),
        "the sender is not notified"
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("manual_links"))
)]
async fn every_linkable_kind_reaches_the_senders_own_inbox_and_home(pool: Pool<Postgres>) {
    let notifications = notifications(&pool);
    let sent = send_every_kind(&notifications, None).await;
    assert_eq!(sent.len(), 6);

    let (inbox, home) = listed_manual(&pool, USER_1).await;
    assert_eq!(inbox, sent);
    assert_eq!(home, sent);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("manual_links"))
)]
async fn links_the_recipients_feeds_would_not_list_are_refused(pool: Pool<Postgres>) {
    let notifications = notifications(&pool);
    let document = |id: &str| EntityType::Document.with_entity_string(id.to_string());
    let thread = |id: &str| EntityType::EmailThread.with_entity_string(id.to_string());
    let session = |id: &str| EntityType::AgentSession.with_entity_string(id.to_string());

    let mail_refused = EMAIL_THREAD_LINKS == EmailThreadLinks::FeedChecked;
    let cases = [
        (
            "a recipient who sees it only through its public link",
            Some(USER_3),
            document(LINK_SHARED_DOC),
            Some(Feed::Inbox),
        ),
        (
            "a document in the trash",
            None,
            document(TRASHED_DOC),
            Some(Feed::Inbox),
        ),
        (
            "a snippet, which Home leaves out",
            None,
            document(SNIPPET),
            Some(Feed::Home),
        ),
        (
            "mail shared with the sender",
            None,
            thread(TEAMMATES_THREAD),
            mail_refused.then_some(Feed::Inbox),
        ),
        (
            "mail that is not Signal",
            None,
            thread(NOISE_THREAD),
            mail_refused.then_some(Feed::Inbox),
        ),
        (
            "the sender's own Signal inbox mail",
            None,
            thread(OWN_THREAD),
            None,
        ),
        (
            "an unlisted session",
            None,
            session(UNLISTED_SESSION),
            Some(Feed::Inbox),
        ),
        (
            "a hidden session",
            None,
            session(HIDDEN_SESSION),
            Some(Feed::Inbox),
        ),
    ];
    let mut accepted = 0;
    for (case, recipient, link, refused_by) in cases {
        let result = notifications.send(sender(), draft(recipient, link)).await;
        match refused_by {
            Some(feed) => assert!(
                matches!(result, Err(ManualNotificationError::NotListedForRecipient(refused)) if refused == feed),
                "{case}: {result:?}"
            ),
            None => {
                result.unwrap_or_else(|error| panic!("{case}: {error:?}"));
                accepted += 1;
            }
        }
    }
    assert_eq!(
        stored(&pool).await,
        accepted,
        "refused notifications are never stored"
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("manual_links"))
)]
async fn a_link_shared_just_before_sending_is_accepted(pool: Pool<Postgres>) {
    let notifications = notifications(&pool);
    let link = EntityType::Document.with_entity_string(SHARED_JUST_NOW.to_string());

    let before = notifications
        .send(sender(), draft(Some(USER_3), link.clone()))
        .await;
    assert!(
        matches!(before, Err(ManualNotificationError::RecipientCannotSeeLink)),
        "{before:?}"
    );

    sqlx::query!(
        "INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES ($1, 'document', $2, 'user', 'view')",
        uuid::Uuid::parse_str(SHARED_JUST_NOW).unwrap(),
        USER_3,
    )
    .execute(&pool)
    .await
    .unwrap();

    notifications
        .send(sender(), draft(Some(USER_3), link.clone()))
        .await
        .unwrap();
    let (inbox, home) = listed_manual(&pool, USER_3).await;
    assert_eq!(inbox, HashSet::from([link.clone()]));
    assert_eq!(home, HashSet::from([link]));
}
