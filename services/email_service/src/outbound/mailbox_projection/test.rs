use super::*;
use crate::outbound::inbox_source::recording::{Recorded, RecordingContactLists};
use contacts::domain::models::list::InboxProvider;
use email_api_client::domain::models::{EmailApiError, RateLimitOrigin};
use email_db_client::attachments::provider::upload::new_email_media_atts;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_email::service::link::UserProvider;
use sqlx::PgPool;
use std::sync::atomic::{AtomicUsize, Ordering};

/// Graph answering every download of the mailbox with `answer`.
struct Downloads {
    answer: Result<Vec<u8>, EmailApiError>,
    count: Arc<AtomicUsize>,
}

impl Downloads {
    fn failing(error: EmailApiError) -> Self {
        Self {
            answer: Err(error),
            count: Arc::new(AtomicUsize::new(0)),
        }
    }
}

impl MailboxAttachmentAccess for Downloads {
    async fn download(
        &self,
        _: UserProvider,
        _: MailboxKey,
        _: &str,
        _: &str,
    ) -> Result<Vec<u8>, MailboxError> {
        self.count.fetch_add(1, Ordering::SeqCst);
        self.answer.clone().map_err(MailboxError::Provider)
    }
}

fn interrupted() -> EmailApiError {
    EmailApiError::Transient {
        message: "Microsoft Graph attachment download was interrupted".into(),
    }
}

const UNUSED_URL: &str = "http://127.0.0.1:9";

// The attachment step only reaches the database, the download and static file
// storage; the other adapters point at an unused local endpoint.
fn effects<A: MailboxAttachmentAccess>(
    db: PgPool,
    attachments: A,
    sfs_url: &str,
) -> impl MailboxProjectionEffects {
    let contacts = Arc::new(contacts::domain::service::SqsContactsIngress {
        queue: contacts::outbound::ingress::SqsContactsQueue::new(
            unused_sqs(),
            UNUSED_URL.to_string(),
        ),
    });
    effects_with_contacts(db, attachments, sfs_url, contacts)
}

fn unused_sqs() -> aws_sdk_sqs::Client {
    aws_sdk_sqs::Client::from_conf(
        aws_sdk_sqs::Config::builder()
            .behavior_version(aws_sdk_sqs::config::BehaviorVersion::latest())
            .region(aws_sdk_sqs::config::Region::new("us-east-1"))
            .credentials_provider(aws_sdk_sqs::config::Credentials::new(
                "test", "test", None, None, "test",
            ))
            .endpoint_url(UNUSED_URL)
            .build(),
    )
}

fn effects_with_contacts<
    A: MailboxAttachmentAccess,
    C: contacts::domain::ports::ContactsIngress + ContactListIngress + 'static,
>(
    db: PgPool,
    attachments: A,
    sfs_url: &str,
    contacts: Arc<C>,
) -> impl MailboxProjectionEffects {
    let sqs = unused_sqs();
    MailboxEffects {
        attachments,
        invitations: email::outbound::invitation_pg::InvitationPgRepository(db.clone()),
        broker: macro_event_broker::MacroEventBrokerService::new(
            macro_event_broker::KafkaEventPublisher::new("127.0.0.1:9").unwrap(),
            tokio_util::task::TaskTracker::new(),
        ),
        notification: Arc::new(notification::domain::service::SqsNotificationIngress {
            queue: notification::outbound::queue::SqsQueue::new(
                sqs.clone(),
                UNUSED_URL.to_string(),
            ),
        }),
        contacts,
        queue: sqs_client::SQS::new(sqs),
        gateway: connection_gateway_client::client::ConnectionGatewayClient::new(
            "test".to_string(),
            UNUSED_URL.to_string(),
        ),
        dss: document_storage_service_client::DocumentStorageServiceClient::new(
            "test".to_string(),
            UNUSED_URL.to_string(),
        ),
        sfs: static_file_service_client::StaticFileServiceClient::new(
            "test".to_string(),
            sfs_url.to_string(),
        ),
        properties: Arc::new(SystemPropertiesServiceImpl::new(
            PgSystemPropertiesRepository::new(db.clone()),
        )),
        notifications_enabled: false,
        db,
    }
}

const LINK_ID: Uuid = Uuid::from_u128(0xc01);
const MESSAGE_ID: Uuid = Uuid::from_u128(0xec201);
const IMAGE_ID: Uuid = Uuid::from_u128(0xc2a0201);
const VIDEO_ID: Uuid = Uuid::from_u128(0xc2a0202);

const MAILBOX: MailboxKey = MailboxKey {
    link_id: LINK_ID,
    sync_generation: 1,
    grant_generation: 1,
};

/// The fixture's media message, as the projection reads it.
fn context() -> ProjectionContext {
    let now = chrono::Utc::now();
    let message = serde_json::from_value(serde_json::json!({
        "db_id":MESSAGE_ID,"thread_db_id":Uuid::from_u128(0xc201),"link_id":LINK_ID,
        "provider_id":"claim-test-media-msg","provider_thread_id":"conversation",
        "is_read":false,"is_starred":false,"is_draft":false,"is_sent":false,"has_attachments":true,
        "to":[],"cc":[],"bcc":[],"labels":[],"attachments":[],"attachments_draft":[],
        "attachments_forwarded":[],"created_at":now,"updated_at":now
    }))
    .unwrap();
    ProjectionContext {
        link: models_email::service::link::Link {
            id: LINK_ID,
            macro_id: MacroUserIdStr::try_from("macro|claim_test@example.com".to_owned()).unwrap(),
            fusionauth_user_id: LINK_ID.to_string(),
            email_address: macro_user_id::email::EmailStr::try_from(
                "claim_test@example.com".to_owned(),
            )
            .unwrap(),
            provider: UserProvider::Outlook,
            is_sync_active: true,
            is_primary: true,
            needs_reauth: false,
            last_sync_error_at: None,
            created_at: now,
            updated_at: now,
        },
        message: Some(ProjectedMessage {
            message,
            in_inbox: true,
            in_trash: false,
            in_junk: false,
            is_present: true,
            thread_inbox_visible: true,
            is_signal: false,
            version: None,
        }),
        viewers: HashSet::new(),
    }
}

struct UploadState {
    failures: i16,
    claimed: bool,
    abandoned: bool,
}

async fn upload_state(db: &PgPool) -> UploadState {
    let row = sqlx::query!(
        r#"SELECT upload_failures,
            upload_claimed_at IS NOT NULL AS "claimed!",
            upload_abandoned_at IS NOT NULL AS "abandoned!"
        FROM email_attachments WHERE id = $1"#,
        IMAGE_ID
    )
    .fetch_one(db)
    .await
    .unwrap();
    UploadState {
        failures: row.upload_failures,
        claimed: row.claimed,
        abandoned: row.abandoned,
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../crates/email_db_client/fixtures",
        scripts("upload_claim_tests")
    )
)]
async fn an_attachment_whose_download_keeps_being_interrupted_is_abandoned(db: PgPool) {
    sqlx::query!("DELETE FROM email_attachments WHERE id = $1", VIDEO_ID)
        .execute(&db)
        .await
        .unwrap();
    let downloads = Downloads::failing(interrupted());
    let count = downloads.count.clone();
    let effects = effects(db.clone(), downloads, UNUSED_URL);
    let context = context();

    // Each failure defers the projection and leaves the attachment for its next try.
    for failures in 1..50 {
        let error = effects
            .attachments(MAILBOX, &context, false)
            .await
            .unwrap_err();
        assert!(
            matches!(
                error,
                MailboxError::Provider(EmailApiError::Transient { .. })
            ),
            "{error:?}"
        );
        let state = upload_state(&db).await;
        assert_eq!(state.failures, failures);
        assert!(!state.claimed && !state.abandoned);
    }

    // The 50th failure abandons it, so the projection completes.
    effects.attachments(MAILBOX, &context, false).await.unwrap();
    let state = upload_state(&db).await;
    assert_eq!(state.failures, 50);
    assert!(state.claimed && state.abandoned);

    // Later events for the message never download it again, and no claim takes it.
    effects.attachments(MAILBOX, &context, true).await.unwrap();
    assert_eq!(count.load(Ordering::SeqCst), 50);
    assert!(
        new_email_media_atts(&db, LINK_ID, "claim-test-media-msg")
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../crates/email_db_client/fixtures",
        scripts("upload_claim_tests")
    )
)]
async fn a_throttled_download_is_never_counted_against_the_attachment(db: PgPool) {
    sqlx::query!("DELETE FROM email_attachments WHERE id = $1", VIDEO_ID)
        .execute(&db)
        .await
        .unwrap();
    let throttled = EmailApiError::RateLimited {
        retry_after: None,
        origin: RateLimitOrigin::Local,
    };
    let effects = effects(db.clone(), Downloads::failing(throttled), UNUSED_URL);
    let context = context();

    for _ in 0..60 {
        let error = effects
            .attachments(MAILBOX, &context, false)
            .await
            .unwrap_err();
        assert!(matches!(
            error,
            MailboxError::Provider(EmailApiError::RateLimited { .. })
        ));
    }

    let state = upload_state(&db).await;
    assert_eq!(state.failures, 0);
    assert!(!state.claimed && !state.abandoned);
}

/// A pass whose claim goes stale while it downloads: another pass takes the
/// attachment over and abandons it before this download fails.
struct OvertakenDownload<E> {
    db: PgPool,
    next_pass: E,
}

impl<E: MailboxProjectionEffects> MailboxAttachmentAccess for OvertakenDownload<E> {
    async fn download(
        &self,
        _: UserProvider,
        _: MailboxKey,
        _: &str,
        _: &str,
    ) -> Result<Vec<u8>, MailboxError> {
        sqlx::query!(
            "UPDATE email_attachments SET upload_claimed_at = now() - interval '4 minutes'
            WHERE id = $1",
            IMAGE_ID
        )
        .execute(&self.db)
        .await
        .unwrap();
        self.next_pass
            .attachments(MAILBOX, &context(), false)
            .await
            .unwrap();
        Err(MailboxError::Provider(interrupted()))
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../crates/email_db_client/fixtures",
        scripts("upload_claim_tests")
    )
)]
async fn a_pass_that_lost_its_claim_leaves_the_next_pass_abandonment_alone(db: PgPool) {
    sqlx::query!("DELETE FROM email_attachments WHERE id = $1", VIDEO_ID)
        .execute(&db)
        .await
        .unwrap();
    sqlx::query!(
        "UPDATE email_attachments SET upload_failures = 2 WHERE id = $1",
        IMAGE_ID
    )
    .execute(&db)
    .await
    .unwrap();
    // The next pass's third refusal abandons the attachment; this pass's
    // interrupted download would only count toward 50.
    let next_pass = effects(
        db.clone(),
        Downloads::failing(EmailApiError::NotFound),
        UNUSED_URL,
    );
    let this_pass = effects(
        db.clone(),
        OvertakenDownload {
            db: db.clone(),
            next_pass,
        },
        UNUSED_URL,
    );

    let error = this_pass
        .attachments(MAILBOX, &context(), false)
        .await
        .unwrap_err();

    assert!(
        matches!(
            error,
            MailboxError::Provider(EmailApiError::Transient { .. })
        ),
        "{error:?}"
    );
    let state = upload_state(&db).await;
    assert_eq!(state.failures, 3);
    assert!(state.claimed && state.abandoned);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../crates/email_db_client/fixtures",
        scripts("upload_claim_tests")
    )
)]
async fn a_lock_timeout_storing_the_file_mapping_is_not_counted(db: PgPool) {
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    sqlx::query!("DELETE FROM email_attachments WHERE id = $1", VIDEO_ID)
        .execute(&db)
        .await
        .unwrap();
    let storage = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path("/internal/file"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "upload_url": format!("{}/upload", storage.uri()),
            "file_location": format!("{}/file/stored", storage.uri()),
            "id": Uuid::from_u128(0x5f5).to_string(),
        })))
        .mount(&storage)
        .await;
    Mock::given(method("PUT"))
        .and(path("/upload"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&storage)
        .await;
    let impatient = sqlx::postgres::PgPoolOptions::new()
        .connect_with(
            (*db.connect_options())
                .clone()
                .options([("lock_timeout", "200ms")]),
        )
        .await
        .unwrap();
    let downloads = Downloads {
        answer: Ok(b"image".to_vec()),
        count: Arc::new(AtomicUsize::new(0)),
    };
    let effects = effects(impatient, downloads, &storage.uri());
    // Inserts into the file mapping wait behind this lock; reads and the
    // attachment's own row do not.
    let mut lock = db.begin().await.unwrap();
    sqlx::query!("LOCK TABLE email_attachments_sfs IN SHARE MODE")
        .execute(&mut *lock)
        .await
        .unwrap();

    let error = effects
        .attachments(MAILBOX, &context(), false)
        .await
        .unwrap_err();
    lock.rollback().await.unwrap();

    assert!(error.is_lock_timeout(), "{error:?}");
    let state = upload_state(&db).await;
    assert_eq!(state.failures, 0);
    assert!(!state.claimed && !state.abandoned);
}

/// Everything the worker logs, as its formatter writes it.
#[derive(Clone, Default)]
struct Logs(Arc<std::sync::Mutex<Vec<u8>>>);

impl std::io::Write for Logs {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl Logs {
    fn capture(&self) -> tracing::subscriber::DefaultGuard {
        let writer = self.clone();
        let guard = tracing::subscriber::set_default(
            tracing_subscriber::fmt()
                .with_max_level(tracing::Level::TRACE)
                .with_ansi(false)
                .with_span_events(tracing_subscriber::fmt::format::FmtSpan::CLOSE)
                .with_writer(move || writer.clone())
                .finish(),
        );
        // A callsite another test thread registered first can keep a cached
        // "never" interest; recompute it for this subscriber.
        tracing::callsite::rebuild_interest_cache();
        guard
    }

    fn text(&self) -> String {
        String::from_utf8(self.0.lock().unwrap().clone()).unwrap()
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../crates/email_db_client/fixtures",
        scripts("upload_claim_tests")
    )
)]
async fn a_failed_upload_logs_no_part_of_its_presigned_url(db: PgPool) {
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    sqlx::query!("DELETE FROM email_attachments WHERE id = $1", VIDEO_ID)
        .execute(&db)
        .await
        .unwrap();
    // The upload URL carries its credentials, and nothing listens on it.
    let storage = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path("/internal/file"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "upload_url": "http://127.0.0.1:9/upload?X-Amz-Credential=access-key-id&X-Amz-Security-Token=session-token-value&X-Amz-Signature=signature-value",
            "file_location": format!("{}/file/stored", storage.uri()),
            "id": Uuid::from_u128(0x5f5).to_string(),
        })))
        .mount(&storage)
        .await;
    let downloads = Downloads {
        answer: Ok(b"image".to_vec()),
        count: Arc::new(AtomicUsize::new(0)),
    };
    let effects = effects(db.clone(), downloads, &storage.uri());
    let logs = Logs::default();
    let capture = logs.capture();

    let error = effects
        .attachments(MAILBOX, &context(), false)
        .await
        .unwrap_err();
    drop(capture);

    assert!(
        matches!(
            error,
            MailboxError::Effect(EffectFailure::AttachmentUpload { .. })
        ),
        "{error:?}"
    );
    let logged = logs.text();
    assert!(
        logged.contains("mailbox projection effect deferred"),
        "{logged}"
    );
    for secret in [
        "X-Amz",
        "access-key-id",
        "session-token-value",
        "signature-value",
    ] {
        assert!(!logged.contains(secret), "{secret} in {logged}");
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../crates/email_db_client/fixtures",
        scripts("upload_claim_tests")
    )
)]
async fn a_failed_download_names_its_attachment_on_the_projection(db: PgPool) {
    use tracing::Instrument;

    sqlx::query!("DELETE FROM email_attachments WHERE id = $1", VIDEO_ID)
        .execute(&db)
        .await
        .unwrap();
    let effects = effects(db.clone(), Downloads::failing(interrupted()), UNUSED_URL);
    let logs = Logs::default();
    let capture = logs.capture();
    let projection = tracing::info_span!(
        "outlook.sync.project",
        outlook.attachment_id = tracing::field::Empty
    );

    effects
        .attachments(MAILBOX, &context(), false)
        .instrument(projection)
        .await
        .unwrap_err();
    drop(capture);

    let logged = logs.text();
    assert!(
        logged.contains(&format!("outlook.attachment_id={IMAGE_ID}")),
        "{logged}"
    );
}

/// A download that fails while another transaction holds the attachment's
/// row, so recording the failure waits past its lock timeout.
struct LockedRowDownload {
    db: PgPool,
    lock: tokio::sync::Mutex<Option<sqlx::Transaction<'static, sqlx::Postgres>>>,
}

impl MailboxAttachmentAccess for LockedRowDownload {
    async fn download(
        &self,
        _: UserProvider,
        _: MailboxKey,
        _: &str,
        _: &str,
    ) -> Result<Vec<u8>, MailboxError> {
        let mut lock = self.db.begin().await.unwrap();
        sqlx::query!(
            "SELECT id FROM email_attachments WHERE id = $1 FOR UPDATE",
            IMAGE_ID
        )
        .fetch_one(&mut *lock)
        .await
        .unwrap();
        *self.lock.lock().await = Some(lock);
        Err(MailboxError::Provider(interrupted()))
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../crates/email_db_client/fixtures",
        scripts("upload_claim_tests")
    )
)]
async fn a_failure_that_cannot_be_recorded_still_names_its_attachment(db: PgPool) {
    use tracing::Instrument;

    sqlx::query!("DELETE FROM email_attachments WHERE id = $1", VIDEO_ID)
        .execute(&db)
        .await
        .unwrap();
    let impatient = sqlx::postgres::PgPoolOptions::new()
        .connect_with(
            (*db.connect_options())
                .clone()
                .options([("lock_timeout", "200ms")]),
        )
        .await
        .unwrap();
    let downloads = LockedRowDownload {
        db: db.clone(),
        lock: tokio::sync::Mutex::new(None),
    };
    let effects = effects(impatient, downloads, UNUSED_URL);
    let logs = Logs::default();
    let capture = logs.capture();
    let projection = tracing::info_span!(
        "outlook.sync.project",
        outlook.attachment_id = tracing::field::Empty
    );

    let error = effects
        .attachments(MAILBOX, &context(), false)
        .instrument(projection)
        .await
        .unwrap_err();
    drop(capture);

    assert!(error.is_lock_timeout(), "{error:?}");
    let logged = logs.text();
    assert!(
        logged.contains(&format!("outlook.attachment_id={IMAGE_ID}")),
        "{logged}"
    );
}

#[cfg(feature = "connection_gateway")]
#[tokio::test]
async fn durable_refresh_retries_a_refused_gateway_handoff() {
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let gateway = MockServer::start().await;
    let client = connection_gateway_client::client::ConnectionGatewayClient::new(
        "test".to_owned(),
        gateway.uri(),
    );
    Mock::given(method("POST"))
        .respond_with(
            ResponseTemplate::new(503).set_body_json(serde_json::json!({"error": "unavailable"})),
        )
        .mount(&gateway)
        .await;
    assert!(matches!(
        refresh_email_durable(
            &client,
            "viewer",
            RefreshEmailEvent::Backfill {
                link_id: Uuid::from_u128(1),
                status: models_email::api::refresh::BackfillStatus::Complete,
            }
        )
        .await,
        Err(MailboxError::Effect(EffectFailure::Downstream))
    ));
    gateway.reset().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"receipts": []})))
        .expect(1)
        .mount(&gateway)
        .await;
    refresh_email_durable(
        &client,
        "viewer",
        RefreshEmailEvent::Backfill {
            link_id: Uuid::from_u128(1),
            status: models_email::api::refresh::BackfillStatus::Complete,
        },
    )
    .await
    .unwrap();
}

fn correspondence(provider: UserProvider) -> CorrespondenceProjection {
    CorrespondenceProjection {
        link_id: LINK_ID,
        owner: MacroUserIdStr::try_from("macro|claim_test@example.com".to_owned()).unwrap(),
        provider,
        is_sent: false,
        // CRM contacts go to the backfill queue, which these tests leave out.
        contacts: Vec::new(),
        connections: vec![MacroUserIdStr::try_from_email("friend@example.com").unwrap()],
    }
}

/// A pool that is never connected: the contacts effect touches no database.
fn unconnected_pool() -> PgPool {
    PgPool::connect_lazy("postgres://unused@127.0.0.1:9/unused").unwrap()
}

#[tokio::test]
async fn correspondents_are_connected_and_join_the_owners_list_for_the_inbox_provider() {
    for (provider, list) in [
        (UserProvider::Outlook, InboxProvider::Outlook),
        (UserProvider::Gmail, InboxProvider::Gmail),
        (UserProvider::Imap, InboxProvider::Imap),
    ] {
        let lists = Arc::new(RecordingContactLists::default());
        let effects = effects_with_contacts(
            unconnected_pool(),
            Downloads::failing(interrupted()),
            UNUSED_URL,
            lists.clone(),
        );

        effects.contacts(correspondence(provider)).await.unwrap();

        let correspondence = correspondence(provider);
        let connections = correspondence
            .connections
            .iter()
            .map(|contact| ContactConnection::new(correspondence.owner.clone(), contact.clone()))
            .collect();
        assert_eq!(
            lists.calls(),
            [
                Recorded::Connections(connections),
                Recorded::InboxContacts(
                    InboxSource {
                        owner: correspondence.owner,
                        link_id: LINK_ID,
                        provider: list,
                    },
                    correspondence.connections,
                ),
            ]
        );
    }
}

#[tokio::test]
async fn a_failed_contacts_publish_defers_the_projection() {
    let effects = effects_with_contacts(
        unconnected_pool(),
        Downloads::failing(interrupted()),
        UNUSED_URL,
        Arc::new(RecordingContactLists::failing()),
    );

    let error = effects
        .contacts(correspondence(UserProvider::Outlook))
        .await
        .unwrap_err();

    assert!(matches!(
        error,
        MailboxError::Effect(EffectFailure::Downstream)
    ));
}
