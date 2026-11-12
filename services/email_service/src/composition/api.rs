//! Production HTTP service wiring.

use crate::api::context::{ApiContext, AuthorizationService};
use crate::calendar_refresh::ConnectionGatewayCalendarRefresh;
use crate::calendar_request_gate::RedisCalendarRequestGate;
use crate::calendar_tokens::CalendarTokenProviderAdapter;
use crate::outbound::email_api::{
    EmailServiceTokenSource, GmailApi, RateBudget, RedisGmailRequestGate,
};
use anyhow::Context;
use calendar_events::{
    domain::{
        invitations::CalendarInvitationResolver, mutations::CalendarMutationServiceImpl,
        service::CalendarService,
    },
    outbound::{google::GoogleCalendarClient, pg::PgCalendarRepository},
};
use document_storage_service_client::DocumentStorageServiceClient;
use email::{
    domain::service::EmailServiceImpl,
    inbound::axum::{
        axum_impls::GmailTokenState, get_thread_router::EmailThreadRouterState,
        previews_router::EmailRouterState,
    },
    outbound::{EmailPgRepo, GmailTokenProviderImpl},
};
use email_api_client::GmailApiClientRepository;
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use frecency::{domain::services::FrecencyQueryServiceImpl, outbound::postgres::FrecencyPgStorage};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_authorization::{
    InternalAuthConfig, MacroAuthJwtValidator, MacroAuthorizationState,
    PgUserApiKeyAuthorizationRepo, PgUserApiKeyAuthorizer,
};
use macro_event_broker::{KafkaEventPublisher, MacroEventBrokerService};
use static_file_service_client::StaticFileServiceClient;
use std::sync::Arc;
use system_properties::{PgSystemPropertiesRepository, SystemPropertiesServiceImpl};
use tokio_util::task::TaskTracker;

/// Environment-derived dependencies of the production HTTP context.
pub(crate) struct ApiDependencies {
    pub read_receipts: crate::composition::ReadReceipts,
    pub config: crate::config::Config,
    pub db: sqlx::PgPool,
    pub sqs_client: sqs_client::SQS,
    pub contacts_ingress: Arc<
        contacts::domain::service::SqsContactsIngress<
            contacts::outbound::ingress::SqsContactsQueue,
        >,
    >,
    pub s3_client: s3_client::S3,
    pub gmail_client: gmail_client::GmailClient,
    pub redis_client: crate::util::redis::RedisClient,
    pub auth_service_client: authentication_service_client::AuthServiceClient,
    pub sfs_client: StaticFileServiceClient,
    pub dss_client: DocumentStorageServiceClient,
    pub connection_gateway_client: connection_gateway_client::client::ConnectionGatewayClient,
    pub jwt_args: JwtValidationArgs,
    pub macro_event_broker: MacroEventBrokerService<KafkaEventPublisher, TaskTracker>,
}

/// Wires the services for the production listener.
pub(crate) async fn api_context(deps: ApiDependencies) -> anyhow::Result<ApiContext> {
    let ApiDependencies {
        read_receipts,
        config,
        db,
        sqs_client,
        contacts_ingress,
        s3_client,
        gmail_client,
        redis_client,
        auth_service_client,
        sfs_client,
        dss_client,
        connection_gateway_client,
        jwt_args,
        macro_event_broker,
    } = deps;
    let gmail_api_repository = GmailApiClientRepository::new(gmail_client.clone());

    let system_properties_service = Arc::new(SystemPropertiesServiceImpl::new(
        PgSystemPropertiesRepository::new(db.clone()),
    ));

    let authorization_state = MacroAuthorizationState::new(Arc::new(AuthorizationService::new(
        MacroAuthJwtValidator::new(jwt_args.clone()),
        InternalAuthConfig {
            api_key: config.internal_api_key.to_string(),
            default_user_id: Some("macro|INTERNAL@macro.com".to_string()),
        },
        macro_authorization::NoBotAuthorizer,
        PgUserApiKeyAuthorizer::new(PgUserApiKeyAuthorizationRepo::new(db.clone())),
    )));

    let sqs_client = Arc::new(sqs_client);
    let gmail_client = Arc::new(gmail_client);
    // HTTP API only reads CRM rows — populate runs in the pubsub
    // worker. The no-op resolver makes the unused branch explicit and
    // keeps reqwest/scraper out of this binary.
    let crm_service = crm::domain::service::CrmServiceImpl::new(
        crm::outbound::companies_repo::CompaniesRepositoryImpl::new(db.clone()),
        crm::outbound::no_op_resolver::NoOpCompanyMetadataResolver,
    );
    let email_service = EmailRouterState::new(
        EmailServiceImpl::new(
            EmailPgRepo::new(db.clone()),
            FrecencyQueryServiceImpl::new(FrecencyPgStorage::new(db.clone())),
            (*sqs_client).clone(),
            crm_service,
            entity_access_management::domain::service::EntityAccessManagementServiceImpl::new(
                entity_access_management::outbound::PgRepository::new(db.clone()),
            ),
            config.sent_undo_delay_secs,
        )
        // Lets `from` name a verified send-as alias of the selected inbox.
        .with_sender_provider(email::outbound::GmailSenderProvider::new(
            gmail_client.as_ref().clone(),
            email::outbound::GmailTokenProviderImpl::lazy(
                redis_client.inner.clone(),
                Arc::new(auth_service_client.clone()),
            ),
        ))
        .with_macro_event_broker(macro_event_broker.clone()),
    );
    let entity_access_service = Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
        db.clone(),
    )));
    let email_thread_state = EmailThreadRouterState {
        service: email_service.service(),
        access_service: entity_access_service.clone(),
        authorization_state: authorization_state.clone(),
    };
    let auth_service_client = Arc::new(auth_service_client);
    let redis_conn = redis_client
        .inner
        .get_multiplexed_async_connection()
        .await
        .context("failed to get multiplexed redis connection for gmail token provider")?;
    let email_api = GmailApi::new(
        gmail_api_repository,
        EmailServiceTokenSource::new(
            db.clone(),
            redis_conn.clone(),
            auth_service_client.as_ref().clone(),
            sqs_client.as_ref().clone(),
        ),
        RedisGmailRequestGate::new(
            redis_client.inner.get_connection_manager().await.context(
                "failed to get reconnecting redis connection for the gmail request gate",
            )?,
            RateBudget::Live,
        ),
    );
    let redis_client = Arc::new(redis_client);
    let gmail_token_state = GmailTokenState::new(GmailTokenProviderImpl::new(
        redis_conn.clone(),
        auth_service_client.clone(),
    ));
    let calendar_service = Arc::new(CalendarService::new(PgCalendarRepository::new(db.clone())));
    let calendar_mutation_service = Arc::new(
        CalendarMutationServiceImpl::new(
            PgCalendarRepository::new(db.clone()),
            calendar_events::domain::providers::CalendarProviders {
                outlook: email_api_client::OutlookApiClientRepository::with_gate(Arc::new(
                    email_api_client::outbound::microsoft_gate::RedisMicrosoftRequestGate(
                        redis_conn.clone(),
                    ),
                ))?
                .with_rejected_token_refresh(Arc::new(
                    CalendarTokenProviderAdapter::new(
                        redis_conn.clone(),
                        auth_service_client.clone(),
                    ),
                )),
                google: GoogleCalendarClient::with_gate(
                    reqwest::Client::builder()
                        .timeout(std::time::Duration::from_secs(30))
                        .build()
                        .context("failed to build the google calendar mutation http client")?,
                    RedisCalendarRequestGate::new((*redis_client).clone()),
                ),
            },
            CalendarTokenProviderAdapter::new(redis_conn.clone(), auth_service_client.clone()),
            macro_event_broker.clone(),
            ConnectionGatewayCalendarRefresh::new(connection_gateway_client.clone(), db.clone()),
        )
        .with_outlook_writes_enabled(config.outlook_writes_enabled),
    );
    let outlook_api: crate::api::context::OutlookApi =
        email_api_client::domain::service::mailbox::MailboxApiService::new(
            email_api_client::OutlookApiClientRepository::with_gate(Arc::new(
                crate::outbound::email_api::RedisMicrosoftRequestGate(redis_conn.clone()),
            ))?,
            crate::api::context::MicrosoftTokens::new(
                email::outbound::mailbox_pg::PgMailboxSync::new(db.clone()),
                crate::outbound::email_api::MicrosoftCredentialsClient(
                    auth_service_client.as_ref().clone(),
                ),
            ),
            email_api_client::domain::ports::AlwaysAllowRateLimiter,
        );
    let transfer_bytes = Arc::new(
        email::domain::mailbox::drafts::content::DraftContentService {
            repository: EmailPgRepo::new(db.clone()),
            bytes: crate::outbound::mailbox_drafts::MailboxDraftContent {
                provider: crate::outbound::attachment_access::ProviderAttachmentBytes {
                    s3: s3_client.clone(),
                    bucket: config.attachment_bucket.to_string(),
                    gmail: email_api.clone(),
                    outlook: crate::outbound::email_api::ProviderMailboxGateway(
                        outlook_api.clone(),
                    ),
                },
                s3: s3_client.clone(),
                bucket: config.attachment_bucket.to_string(),
            },
            access: entity_access_service.as_ref().clone(),
        },
    );
    Ok(ApiContext {
        message_labels: Arc::new(email::domain::message_labels::MessageLabelService {
            repository: crate::outbound::message_labels::PgMessageLabels(db.clone()),
            enqueuer: sqs_client.as_ref().clone(),
            broker: macro_event_broker.clone(),
        }),
        message_reads: Arc::new(email::domain::message_reads::MessageReadService {
            repository: crate::outbound::message_reads::PgMessageReads(db.clone()),
        }),
        draft_transfers: Arc::new(email::domain::draft_transfer::DraftTransferService {
            repository: EmailPgRepo::new(db.clone()),
            bytes: transfer_bytes,
            storage: crate::outbound::draft_attachment_storage::DraftAttachmentS3 {
                s3: s3_client.clone(),
                bucket: config.attachment_bucket.to_string(),
            },
        }),
        inbox_lifecycle: Arc::new(crate::composition::inbox_lifecycle(
            email_api_client::OutlookApiClientRepository::with_gate(Arc::new(
                crate::outbound::email_api::RedisMicrosoftRequestGate(redis_conn.clone()),
            ))?,
            db.clone(),
            auth_service_client.as_ref().clone(),
            sqs_client.as_ref().clone(),
            connection_gateway_client.clone(),
        )),
        mailbox_settings: Arc::new(
            email::domain::mailbox::settings::MailboxSettingsService::new(
                email::outbound::mailbox_pg::PgMailboxSync::new(db.clone()),
                crate::outbound::mailbox_settings::ProviderMailboxSettings {
                    gmail: email_api.clone(),
                    outlook: outlook_api.clone(),
                },
            ),
        ),
        mailbox_notifications: Arc::new(
            email::domain::mailbox::watches::MailboxWatchNotifications(
                email::outbound::mailbox_pg::PgMailboxSync::new(db.clone()),
            ),
        ),
        inbox_catalog: Arc::new(email::domain::mailbox::catalog::InboxCatalogService(
            crate::outbound::inbox_catalog::PgInboxCatalog(db.clone()),
        )),
        inbox_health: Arc::new(crate::composition::inbox_health(
            db.clone(),
            email_api.clone(),
            auth_service_client.as_ref().clone(),
            redis_client.as_ref().clone(),
            sqs_client.as_ref().clone(),
            macro_event_broker.clone(),
            contacts_ingress,
        )),
        recent_inbox: Arc::new(email::domain::recent_inbox::RecentInboxService::new(
            crate::outbound::recent_inbox::PgRecentInboxes(db.clone()),
            crate::outbound::recent_inbox::ProviderRecentInbox {
                gmail: email_api.clone(),
                outlook: outlook_api.clone(),
            },
        )),
        message_sources: Arc::new(email::domain::message_source::MessageSourceService {
            repository: EmailPgRepo::new(db.clone()),
            provider: crate::outbound::message_source::ProviderMessageSource {
                gmail: email_api.clone(),
                outlook: outlook_api.clone(),
            },
            access: entity_access_service.as_ref().clone(),
        }),
        attachment_reads: Arc::new(email::domain::attachment_access::AttachmentReadService {
            repository: EmailPgRepo::new(db.clone()),
            provider: crate::outbound::attachment_access::ProviderAttachmentBytes {
                s3: s3_client.clone(),
                bucket: config.attachment_bucket.to_string(),
                gmail: email_api.clone(),
                outlook: crate::outbound::email_api::ProviderMailboxGateway(outlook_api),
            },
            files: crate::outbound::attachment_access::MailAttachmentFiles {
                db: db.clone(),
                s3: s3_client.clone(),
                bucket: config.attachment_bucket.to_string(),
                distribution_url: config.email_service_cloudfront_distribution_url.to_string(),
                public_key_id: config
                    .email_service_cloudfront_signer_public_key_id
                    .to_string(),
                private_key: config
                    .email_service_cloudfront_signer_private_key
                    .as_ref()
                    .to_owned(),
                url_ttl_seconds: config.email_service_presigned_url_ttl_secs,
                dss: dss_client.clone(),
                sfs: sfs_client.clone(),
                properties: system_properties_service.clone(),
            },
            access: entity_access_service.as_ref().clone(),
        }),
        event_forward_sender: Arc::new(
            email::domain::service::attachments::StagedAttachmentSender::new(
                email_service.service(),
                EmailPgRepo::new(db.clone()),
                crate::outbound::draft_attachment_storage::DraftAttachmentS3 {
                    s3: s3_client.clone(),
                    bucket: config.attachment_bucket.to_string(),
                },
            ),
        ),
        draft_attachments: Arc::new(email::domain::draft_attachments::DraftAttachmentService {
            repository: email::outbound::EmailPgRepo::new(db.clone()),
            storage: crate::outbound::draft_attachment_storage::DraftAttachmentS3 {
                s3: s3_client.clone(),
                bucket: config.attachment_bucket.to_string(),
            },
            access: entity_access_service.as_ref().clone(),
        }),
        mailbox_initializer: Arc::new(
            email::domain::mailbox::initialization::MailboxInitializationService::new(
                crate::outbound::mailbox_init::PgMailboxInitialization(db.clone()),
                crate::outbound::mailbox_init::MicrosoftGrantSource(
                    auth_service_client.as_ref().clone(),
                ),
            )
            .with_connections_enabled(config.outlook_connections_enabled),
        ),
        read_receipts,
        invitation_snapshots: email::outbound::invitation_pg::InvitationPgRepository(db.clone()),
        // calendar_service's sync kill switch rejects RSVP writes itself.
        invitation_resolver: Arc::new(CalendarInvitationResolver::new(PgCalendarRepository::new(
            db.clone(),
        ))),
        db,
        internal_api_key: config.internal_api_key.clone(),
        config: Arc::new(config),
        auth_service_client,
        redis_client,
        sqs_client,
        sfs_client: Arc::new(sfs_client),
        gmail_client: gmail_client.clone(),
        email_api,
        s3_client: Arc::new(s3_client),
        dss_client: Arc::new(dss_client),
        system_properties_service,
        authorization_state: authorization_state.clone(),
        jwt_args,
        email_service,
        entity_access_service,
        email_thread_state,
        gmail_token_state,
        macro_event_broker: Arc::new(macro_event_broker),
        calendar_service,
        calendar_mutation_service,
    })
}
