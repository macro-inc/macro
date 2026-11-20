use super::*;
use email_api_client::domain::models::{EmailApiError, RateLimitOrigin};
use email_db_client::attachments::provider::upload::new_email_media_atts;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_email::service::link::UserProvider;
use sqlx::PgPool;
use std::sync::atomic::{AtomicUsize, Ordering};

/// Graph answering every download of the mailbox with `error`.
struct FailingDownloads {
    error: EmailApiError,
    downloads: Arc<AtomicUsize>,
}

impl MailboxAttachmentAccess for FailingDownloads {
    async fn download(&self, _: MailboxKey, _: &str, _: &str) -> Result<Vec<u8>, MailboxError> {
        self.downloads.fetch_add(1, Ordering::SeqCst);
        Err(MailboxError::Provider(self.error.clone()))
    }
}

// The attachment step only reaches the database and the download; the other
// adapters point at an unused local endpoint.
fn effects(
    db: PgPool,
    error: EmailApiError,
    downloads: Arc<AtomicUsize>,
) -> impl MailboxProjectionEffects {
    let unused_url = "http://127.0.0.1:9";
    let sqs = aws_sdk_sqs::Client::from_conf(
        aws_sdk_sqs::Config::builder()
            .behavior_version(aws_sdk_sqs::config::BehaviorVersion::latest())
            .region(aws_sdk_sqs::config::Region::new("us-east-1"))
            .credentials_provider(aws_sdk_sqs::config::Credentials::new(
                "test", "test", None, None, "test",
            ))
            .endpoint_url(unused_url)
            .build(),
    );
    MailboxEffects {
        attachments: FailingDownloads { error, downloads },
        invitations: email::outbound::invitation_pg::InvitationPgRepository(db.clone()),
        broker: macro_event_broker::MacroEventBrokerService::new(
            macro_event_broker::KafkaEventPublisher::new("127.0.0.1:9").unwrap(),
            tokio_util::task::TaskTracker::new(),
        ),
        notification: Arc::new(notification::domain::service::SqsNotificationIngress {
            queue: notification::outbound::queue::SqsQueue::new(
                sqs.clone(),
                unused_url.to_string(),
            ),
        }),
        contacts: Arc::new(contacts::domain::service::SqsContactsIngress {
            queue: contacts::outbound::ingress::SqsContactsQueue::new(
                sqs.clone(),
                unused_url.to_string(),
            ),
        }),
        queue: sqs_client::SQS::new(sqs),
        gateway: connection_gateway_client::client::ConnectionGatewayClient::new(
            "test".to_string(),
            unused_url.to_string(),
        ),
        dss: document_storage_service_client::DocumentStorageServiceClient::new(
            "test".to_string(),
            unused_url.to_string(),
        ),
        sfs: static_file_service_client::StaticFileServiceClient::new(
            "test".to_string(),
            unused_url.to_string(),
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
    let downloads = Arc::new(AtomicUsize::new(0));
    let interrupted = EmailApiError::Transient {
        message: "Microsoft Graph attachment download was interrupted".into(),
    };
    let effects = effects(db.clone(), interrupted, downloads.clone());
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
    assert_eq!(downloads.load(Ordering::SeqCst), 50);
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
    let effects = effects(db.clone(), throttled, Arc::new(AtomicUsize::new(0)));
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
