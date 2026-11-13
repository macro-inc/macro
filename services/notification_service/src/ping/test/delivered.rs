//! Pings sent through the real access checks, feed check and
//! ingress land in the recipient's inbox and on Home, read through their real
//! services over Soup and Postgres; recipients whose inbox would not list a
//! link are skipped before anything is stored.
//!
//! Calendar events, companies and contacts are linkable too; this fixture has
//! none, so their rows are covered by the inbox's row tests.

use std::collections::HashSet;
use std::sync::Arc;

use attention_feed::domain::models::FeedViewer;
use attention_feed::inbound::viewers::EntityAccessFeedViewers;
use attention_feed::outbound::notifications::ReaderFeedNotifications;
use attention_feed::test_support::{FakeMail, FakeSignals};
use chrono::Utc;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use messages::domain::ports::NoMessageEventPublisher;
use messages::domain::service::MessageService;
use messages::outbound::pg_message_repo::PgMessageRepository;
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

use super::super::outbound::channel_messages::ChannelMessageLinks;
use super::super::outbound::entity_access::EntityAccessLinks;
use super::super::outbound::feed_visibility::FeedCandidateVisibility;
use super::super::{
    ACCESS_CHECKED_TYPES, PingDraft, PingError, PingOutcome, PingSender, Pings, SkipReason,
    shown_in_inbox,
};
use super::{FixedAllowance, OneAgent, SenderFlag, user};
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
const CHANNEL: &str = "33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CHANNEL_MESSAGE: &str = "99999999-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

/// Kinds the inbox lists that this fixture has none of; see the module docs.
const NOT_IN_FIXTURE: [EntityType; 3] = [
    EntityType::CalendarEvent,
    EntityType::CrmCompany,
    EntityType::CrmContact,
];

/// The entity of each linkable kind that `viewer` can be notified about.
fn linkable_for(viewer: &str, entity_type: EntityType) -> Option<&'static str> {
    match entity_type {
        EntityType::Document => Some(DOC),
        EntityType::Chat => Some("22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        EntityType::Channel => Some(CHANNEL),
        EntityType::Project => Some("66666666-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        EntityType::Initiative => Some("88888888-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
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

fn sender() -> PingSender {
    PingSender {
        user: user(USER_1),
        opaque_id: "fa-user-1".to_string(),
        agent_id: None,
    }
}

fn draft(recipient: Option<&str>, link: Entity<'static>) -> PingDraft {
    PingDraft {
        recipients: recipient.map(user).into_iter().collect(),
        title: format!("{} finished", link.entity_type),
        body: None,
        link,
    }
}

type Access = entity_access::domain::service::EntityAccessServiceImpl<
    entity_access::outbound::PgAccessRepository,
>;

type Notifications = Pings<
    SenderFlag,
    EntityAccessLinks<Access>,
    FeedCandidateVisibility<SoupCandidates, EntityAccessFeedViewers<Access>>,
    ChannelMessageLinks<Access, MessageService<PgMessageRepository, NoMessageEventPublisher>>,
    OneAgent,
    FixedAllowance,
    NotificationIngressService<DbNotificationRepository<Pool<Postgres>>, NoDelivery, NoDigest>,
>;

/// The service as `main.rs` wires it, with a database ingress in place of SQS.
fn notifications(pool: &Pool<Postgres>) -> Notifications {
    let access = entity_access::domain::service::EntityAccessServiceImpl::new(
        entity_access::outbound::PgAccessRepository::new(pool.clone()),
    );
    Pings {
        flags: SenderFlag::On,
        access: EntityAccessLinks(access.clone()),
        feeds: FeedCandidateVisibility {
            source: soup_candidates(pool.clone()),
            viewers: EntityAccessFeedViewers(Arc::new(access.clone())),
        },
        messages: ChannelMessageLinks {
            access,
            messages: MessageService::new(
                PgMessageRepository::new(pool.clone()),
                NoMessageEventPublisher,
            ),
        },
        agents: OneAgent,
        allowance: FixedAllowance::of(1000),
        ingress: NotificationIngressService::new(
            DbNotificationRepository::new(pool.clone()),
            NoDelivery,
            NoDigest,
        ),
    }
}

/// The entities with a ping in `viewer`'s inbox and on their
/// Home, read through the real services.
async fn listed_pings(
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
    let ping = |notification: &&Arc<UserNotificationRow<NotifEvent>>| {
        matches!(notification.notification_metadata, NotifEvent::Ping(_))
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
            .any(|row| row.all_notifications().any(|n| ping(&n)))
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
    .filter(|entry| entry.item.notifications.iter().any(|n| ping(&n)))
    .map(|entry| entry.item.key.entity().clone())
    .collect();

    (inbox, home)
}

async fn stored(pool: &Pool<Postgres>) -> i64 {
    sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM notification WHERE notification_event_type = 'ping'"#
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Sends a notification about one entity of every linkable kind to
/// `recipient` (`None`: to oneself), refusing the kinds the inbox never
/// lists, and returns the links that were sent.
async fn send_every_kind(
    notifications: &Notifications,
    recipient: Option<&str>,
) -> HashSet<Entity<'static>> {
    let viewer = recipient.unwrap_or(USER_1);
    let mut sent = HashSet::new();
    for entity_type in ACCESS_CHECKED_TYPES {
        if NOT_IN_FIXTURE.contains(&entity_type) {
            assert!(shown_in_inbox(entity_type), "{entity_type}");
            continue;
        }
        let id = linkable_for(viewer, entity_type)
            .map(str::to_string)
            .unwrap_or_else(|| uuid::Uuid::now_v7().to_string());
        let link = entity_type.with_entity_string(id);
        let result = notifications
            .send(sender(), draft(recipient, link.clone()), Utc::now())
            .await;
        if shown_in_inbox(entity_type) {
            assert!(
                linkable_for(viewer, entity_type).is_some(),
                "give the fixture a {entity_type} {viewer} can be notified about"
            );
            let outcome =
                result.unwrap_or_else(|error| panic!("{entity_type} to {viewer}: {error:?}"));
            assert_eq!(
                outcome.notified,
                [user(viewer)],
                "{entity_type} to {viewer}: {outcome:?}"
            );
            sent.insert(link);
        } else {
            assert!(
                matches!(result, Err(PingError::NotShownInInbox(refused)) if refused == entity_type),
                "{entity_type}: {result:?}"
            );
        }
    }
    sent
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("ping_links"))
)]
async fn every_linkable_kind_reaches_a_recipients_inbox_and_home(pool: Pool<Postgres>) {
    let notifications = notifications(&pool);
    let sent = send_every_kind(&notifications, Some(USER_2)).await;
    assert_eq!(sent.len(), 7);

    let (inbox, home) = listed_pings(&pool, USER_2).await;
    assert_eq!(inbox, sent, "the recipient's inbox groups with a ping");
    assert_eq!(home, sent, "the recipient's Home items with a ping");
    let (sender_inbox, sender_home) = listed_pings(&pool, USER_1).await;
    assert!(
        sender_inbox.is_empty() && sender_home.is_empty(),
        "the sender is not notified"
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("ping_links"))
)]
async fn every_linkable_kind_reaches_the_senders_own_inbox_and_home(pool: Pool<Postgres>) {
    let notifications = notifications(&pool);
    let sent = send_every_kind(&notifications, None).await;
    assert_eq!(sent.len(), 7);

    let (inbox, home) = listed_pings(&pool, USER_1).await;
    assert_eq!(inbox, sent);
    assert_eq!(home, sent);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("ping_links"))
)]
async fn recipients_whose_inbox_would_not_list_the_link_are_skipped(pool: Pool<Postgres>) {
    let notifications = notifications(&pool);
    let document = |id: &str| EntityType::Document.with_entity_string(id.to_string());
    let thread = |id: &str| EntityType::EmailThread.with_entity_string(id.to_string());
    let session = |id: &str| EntityType::AgentSession.with_entity_string(id.to_string());

    // (case, recipient, link, listed)
    let cases = [
        (
            "a recipient who sees it only through its public link",
            Some(USER_3),
            document(LINK_SHARED_DOC),
            false,
        ),
        (
            "a document in the trash",
            None,
            document(TRASHED_DOC),
            false,
        ),
        // Home leaves snippets out, but the inbox lists them.
        ("a snippet", None, document(SNIPPET), true),
        (
            "mail shared with the sender",
            None,
            thread(TEAMMATES_THREAD),
            false,
        ),
        ("mail that is not Signal", None, thread(NOISE_THREAD), false),
        (
            "the sender's own Signal inbox mail",
            None,
            thread(OWN_THREAD),
            true,
        ),
        (
            "an unlisted session",
            None,
            session(UNLISTED_SESSION),
            false,
        ),
        ("a hidden session", None, session(HIDDEN_SESSION), false),
    ];
    let mut accepted = 0;
    for (case, recipient, link, listed) in cases {
        let viewer = user(recipient.unwrap_or(USER_1));
        let outcome = notifications
            .send(sender(), draft(recipient, link), Utc::now())
            .await
            .unwrap_or_else(|error| panic!("{case}: {error:?}"));
        if listed {
            assert_eq!(outcome.notified, [viewer], "{case}: {outcome:?}");
            accepted += 1;
        } else {
            assert!(outcome.notified.is_empty(), "{case}: {outcome:?}");
            assert!(
                matches!(&outcome.skipped[..], [skipped] if skipped.user_id == viewer && skipped.reason == SkipReason::NotListed),
                "{case}: {outcome:?}"
            );
        }
    }
    assert_eq!(
        stored(&pool).await,
        accepted,
        "skipped notifications are never stored"
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("ping_links"))
)]
async fn a_link_shared_just_before_sending_is_accepted(pool: Pool<Postgres>) {
    let notifications = notifications(&pool);
    let link = EntityType::Document.with_entity_string(SHARED_JUST_NOW.to_string());

    let before = notifications
        .send(sender(), draft(Some(USER_3), link.clone()), Utc::now())
        .await
        .unwrap();
    assert!(
        matches!(&before.skipped[..], [skipped] if skipped.reason == SkipReason::NoAccess),
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

    let after = notifications
        .send(
            sender(),
            PingDraft {
                title: "Shared now".to_string(),
                ..draft(Some(USER_3), link.clone())
            },
            Utc::now(),
        )
        .await
        .unwrap();
    assert_eq!(after.notified, [user(USER_3)]);
    let (inbox, home) = listed_pings(&pool, USER_3).await;
    assert_eq!(inbox, HashSet::from([link.clone()]));
    assert_eq!(home, HashSet::from([link]));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("ping_links"))
)]
async fn a_channel_message_is_filed_under_its_channel(pool: Pool<Postgres>) {
    let notifications = notifications(&pool);
    let message = EntityType::ChannelMessage.with_entity_string(CHANNEL_MESSAGE.to_string());

    let outcome = notifications
        .send(sender(), draft(Some(USER_2), message), Utc::now())
        .await
        .unwrap();

    assert_eq!(
        outcome,
        PingOutcome {
            notified: vec![user(USER_2)],
            skipped: Vec::new(),
        }
    );
    let (inbox, _home) = listed_pings(&pool, USER_2).await;
    assert_eq!(
        inbox,
        HashSet::from([EntityType::Channel.with_entity_string(CHANNEL.to_string())])
    );
}

/// Not a pass/fail test: prints what each recipient's checks cost, one at a
/// time and all at once, for inboxes of growing size. Run it in release
/// against a local MacroDB:
/// `cargo test --release -p notification_service --bin notification_service
/// benchmark_recipient_checks -- --ignored --nocapture`.
/// `AGENTS.md` records the last numbers.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("ping_links"))
)]
#[ignore = "a benchmark; run by hand"]
async fn benchmark_recipient_checks(pool: Pool<Postgres>) {
    use crate::ping::{FeedVisibility, LinkAccess};

    const ROUNDS: u32 = 100;
    let notifications = notifications(&pool);
    let link = EntityType::Document.with_entity_string(DOC.to_string());
    let viewer = user(USER_2);
    for pending in [0_i64, 1_000, 10_000, 50_000] {
        let have = sqlx::query_scalar!(
            r#"SELECT count(*) AS "count!" FROM user_notification WHERE user_id = $1"#,
            USER_2
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query!(
            "WITH n AS (
                INSERT INTO notification (id, notification_event_type, event_item_id, event_item_type, service_sender)
                SELECT gen_random_uuid(), 'document_mention', gen_random_uuid()::text, 'document', 'benchmark'
                FROM generate_series(1, $1::bigint)
                RETURNING id, event_item_id
            )
            INSERT INTO user_notification (user_id, notification_id, state, event_item_type, event_item_id, notification_event_type)
            SELECT $2, id, 'unseen', 'document', event_item_id, 'document_mention' FROM n",
            pending - have,
            USER_2,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query!("ANALYZE").execute(&pool).await.unwrap();
        for _ in 0..5 {
            notifications.feeds.admits(&viewer, &link).await.unwrap();
        }

        let started = std::time::Instant::now();
        for _ in 0..ROUNDS {
            assert!(notifications.access.can_view(&viewer, &link).await.unwrap());
        }
        let access = started.elapsed() / ROUNDS;
        let started = std::time::Instant::now();
        for _ in 0..ROUNDS {
            assert!(notifications.feeds.admits(&viewer, &link).await.unwrap());
        }
        let feed = started.elapsed() / ROUNDS;
        let started = std::time::Instant::now();
        let results = futures::future::join_all(
            (0..ROUNDS).map(|_| notifications.feeds.admits(&viewer, &link)),
        )
        .await;
        let all_at_once = started.elapsed();
        assert!(
            results.into_iter().all(|listed| listed.unwrap()),
            "every concurrent check succeeds and lists the link"
        );
        println!(
            "{pending} pending: access check {access:?} each, inbox check {feed:?} each, {ROUNDS} inbox checks at once {all_at_once:?}"
        );
    }
}
