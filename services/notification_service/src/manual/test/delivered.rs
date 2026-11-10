//! Manual notifications sent through the real access checks and ingress land
//! in the inbox and on Home, read through their real policies and Soup's
//! candidate query.

use std::collections::HashSet;
use std::sync::Arc;

use attention_feed::domain::models::FeedViewer;
use attention_feed::outbound::notifications::ReaderFeedNotifications;
use attention_feed::outbound::soup::SoupCandidateSource;
use attention_feed::test_support::{FakeMail, FakeSignals};
use channels::domain::list_service::ChannelListServiceImpl;
use channels::outbound::pg_channels_repo::PgChannelsRepo;
use crm::domain::service::NoOpCrmService;
use email::domain::ports::ReadonlyEmailPreviewAdapter;
use email::domain::service::EmailServiceImpl;
use email::outbound::EmailPgRepo;
use foreign_entity::domain::service::ForeignEntityServiceImpl;
use foreign_entity::outbound::pg_foreign_entity_repo::PgForeignEntityRepo;
use frecency::domain::services::FrecencyQueryServiceImpl;
use frecency::outbound::postgres::FrecencyPgStorage;
use github_pull_requests::domain::service::GithubPullRequestServiceImpl;
use github_pull_requests::outbound::pg_github_pull_request_repo::PgGithubPullRequestRepo;
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
use readonly_pool::ReadOnlyPool;
use rootcause::Report;
use serde::Serialize;
use soup::domain::service::SoupImpl;
use soup::outbound::pg_soup_repo::PgSoupRepo;
use sqlx::{Pool, Postgres};
use work_feed::domain::models::{WorkFeedMode, WorkFeedQuery, WorkFeedScope};
use work_feed::domain::service::{WorkFeedService, WorkFeedServiceImpl};

use super::super::entity_access::EntityAccessLinks;
use super::super::sessions::PgSessionListing;
use super::super::{
    ACCESS_CHECKED_TYPES, ManualNotificationDraft, ManualNotificationError, ManualNotifications,
    ManualSender, shown_in_inbox_and_home,
};
use super::{OneAgent, user};

const USER_1: &str = "macro|user-1@example.com";
const LISTED_SESSION: &str = "77777777-0000-0000-0000-000000000001";
const UNLISTED_SESSION: &str = "77777777-0000-0000-0000-000000000002";
const HIDDEN_SESSION: &str = "77777777-0000-0000-0000-000000000003";

/// The fixture entity of each kind a manual notification can link to.
fn fixture_entity(entity_type: EntityType) -> Option<&'static str> {
    match entity_type {
        EntityType::Document => Some("11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        EntityType::Chat => Some("22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        EntityType::Channel => Some("33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        EntityType::Project => Some("66666666-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        EntityType::EmailThread => Some("44444444-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
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
        agent_id: None,
    }
}

fn draft(link: Entity<'static>) -> ManualNotificationDraft {
    ManualNotificationDraft {
        recipient: None,
        title: format!("{} finished", link.entity_type),
        body: None,
        link,
    }
}

fn viewer() -> FeedViewer {
    FeedViewer {
        user: user(USER_1),
        team: None,
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("manual_links"))
)]
async fn every_linkable_kind_reaches_the_inbox_and_home_and_the_rest_are_refused(
    pool: Pool<Postgres>,
) {
    let notifications = ManualNotifications {
        access: EntityAccessLinks(
            entity_access::domain::service::EntityAccessServiceImpl::new(
                entity_access::outbound::PgAccessRepository::new(pool.clone()),
            ),
        ),
        sessions: PgSessionListing(pool.clone()),
        agents: OneAgent,
        ingress: NotificationIngressService::new(
            DbNotificationRepository::new(pool.clone()),
            NoDelivery,
            NoDigest,
        ),
    };

    let mut sent = Vec::new();
    for entity_type in ACCESS_CHECKED_TYPES {
        let result = match fixture_entity(entity_type) {
            Some(id) => {
                notifications
                    .send(
                        sender(),
                        draft(entity_type.with_entity_string(id.to_string())),
                    )
                    .await
            }
            None => {
                notifications
                    .send(
                        sender(),
                        draft(entity_type.with_entity_string(uuid::Uuid::now_v7().to_string())),
                    )
                    .await
            }
        };
        if shown_in_inbox_and_home(entity_type) {
            let id = fixture_entity(entity_type)
                .unwrap_or_else(|| panic!("give the fixture a {entity_type} to link to"));
            result.unwrap_or_else(|error| panic!("{entity_type}: {error:?}"));
            sent.push(entity_type.with_entity_string(id.to_string()));
        } else {
            assert!(
                matches!(result, Err(ManualNotificationError::NotShownInInbox(refused)) if refused == entity_type),
                "{entity_type}: {result:?}"
            );
        }
    }
    assert_eq!(
        sent.iter().map(|link| link.entity_type).collect::<Vec<_>>(),
        vec![
            EntityType::Document,
            EntityType::Chat,
            EntityType::Channel,
            EntityType::Project,
            EntityType::EmailThread,
            EntityType::AgentSession,
        ]
    );

    for session in [UNLISTED_SESSION, HIDDEN_SESSION] {
        let refused = notifications
            .send(
                sender(),
                draft(EntityType::AgentSession.with_entity_string(session.to_string())),
            )
            .await;
        assert!(
            matches!(refused, Err(ManualNotificationError::UnlistedAgentSession)),
            "{session}: {refused:?}"
        );
    }

    let stored: Vec<(String, String)> = sqlx::query_as(
        "SELECT event_item_type, event_item_id FROM notification WHERE notification_event_type = 'manual' ORDER BY event_item_type",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        stored.len(),
        sent.len(),
        "only the accepted links were stored"
    );

    let frecency_storage = FrecencyPgStorage::new(pool.clone());
    let frecency = FrecencyQueryServiceImpl::new(frecency_storage.clone());
    let email = EmailServiceImpl::new(
        EmailPgRepo::new(pool.clone()),
        frecency.clone(),
        email::domain::ports::NoOpEnqueuer,
        NoOpCrmService,
        entity_access_management::domain::service::EntityAccessManagementServiceImpl::new(
            entity_access_management::outbound::PgRepository::new(pool.clone()),
        ),
        0,
    );
    let soup = Arc::new(SoupImpl::new(
        PgSoupRepo::new(ReadOnlyPool(pool.clone())),
        frecency,
        ReadonlyEmailPreviewAdapter(email.clone()),
        ChannelListServiceImpl::new(
            PgChannelsRepo::new(pool.clone()),
            PgChannelsRepo::new(pool.clone()),
            frecency_storage,
        ),
        call::domain::service::CallRecordQueryServiceImpl::new(
            call::outbound::pg_call_repo::PgCallRepo::new(pool.clone()),
        ),
        NoOpCrmService,
        GithubPullRequestServiceImpl::new(
            ForeignEntityServiceImpl::new(PgForeignEntityRepo::new(pool.clone())),
            PgGithubPullRequestRepo::new(pool.clone()),
        ),
    ));
    let email = Arc::new(email);
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

    let inbox = NotificationInboxServiceImpl::new(
        SoupCandidateSource::new(soup.clone(), email.clone()),
        ReaderFeedNotifications::new(reader.clone()),
        FakeMail::default(),
        FakeSignals::default(),
    )
    .page(
        viewer(),
        InboxQuery {
            scope: InboxScope::default(),
            limit: 50,
            after: None,
        },
    )
    .await
    .unwrap();
    let in_inbox: HashSet<Entity<'static>> = inbox
        .entries
        .iter()
        .filter(|entry| {
            entry.rows.iter().any(|row| {
                row.all_notifications().any(|notification| {
                    matches!(notification.notification_metadata, NotifEvent::Manual(_))
                })
            })
        })
        .map(|entry| entry.group.entity().clone())
        .collect();

    let home = WorkFeedServiceImpl::new(
        SoupCandidateSource::new(soup, email),
        ReaderFeedNotifications::new(reader),
        FakeMail::default(),
        FakeSignals::default(),
    )
    .page(
        viewer(),
        WorkFeedQuery {
            scope: WorkFeedScope {
                mode: WorkFeedMode::Attention,
                types: Vec::new(),
                include_snippets: false,
            },
            state: None,
            limit: 50,
            after: None,
        },
    )
    .await
    .unwrap();
    let on_home: HashSet<Entity<'static>> = home
        .entries
        .iter()
        .filter(|entry| {
            entry.item.notifications.iter().any(|notification| {
                matches!(notification.notification_metadata, NotifEvent::Manual(_))
            })
        })
        .map(|entry| entry.item.key.entity().clone())
        .collect();

    let sent: HashSet<Entity<'static>> = sent.into_iter().collect();
    assert_eq!(in_inbox, sent, "inbox groups with a manual notification");
    assert_eq!(
        on_home, sent,
        "Home attention items with a manual notification"
    );
}
