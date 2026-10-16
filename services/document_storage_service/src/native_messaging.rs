//! Native Meta messaging composition and durable worker drivers.

mod effects;
mod files;
mod native;
mod settings;
mod workers;

use crate::api::context::{
    AuthorizationService, DssEventBroker, EntityAccessService, NotificationIngressType,
};
use messages::outbound::connection_gateway::ConnectionGatewayMessages;
use meta_messaging::{
    domain::{meta::MetaService, models::MessagingError, ports::*},
    inbound::router::MessagingRouterState,
    outbound::{repository::PgMessagingRepository, storage::KmsCredentialCipher},
};
use std::{sync::Arc, time::Duration};

pub(crate) type State = MessagingRouterState<EntityAccessService, AuthorizationService>;

pub(crate) struct Dependencies {
    pub pool: sqlx::PgPool,
    pub access: Arc<EntityAccessService>,
    pub authorization: macro_authorization::MacroAuthorizationState<AuthorizationService>,
    pub gateway: Arc<connection_gateway_client::client::ConnectionGatewayClient>,
    pub search: Arc<sqs_client::SQS>,
    pub environment: macro_env::Environment,
    pub documents: Arc<crate::api::context::DocumentService>,
    pub broker: DssEventBroker,
    pub notifications: Arc<NotificationIngressType>,
}

pub(crate) async fn build(dependencies: Dependencies) -> anyhow::Result<State> {
    let Dependencies {
        pool,
        access,
        authorization,
        gateway,
        search,
        environment,
        documents,
        broker,
        notifications,
    } = dependencies;
    let settings = settings::Settings::load(environment)?;
    let cipher: Arc<dyn CredentialCipher> = if let Some(key) = settings.kms_key {
        Arc::new(KmsCredentialCipher::new(
            aws_sdk_kms::Client::new(&macro_aws_config::get_macro_aws_config().await),
            key,
        )?)
    } else {
        Arc::new(UnconfiguredCipher)
    };
    let repository = Arc::new(PgMessagingRepository::new(pool.clone()));
    let temporary_media: Option<Arc<dyn meta_messaging::domain::temporary_media::TemporaryMedia>> =
        if let Some(bucket) = settings.temporary_media_bucket {
            Some(Arc::new(
                meta_messaging::domain::temporary_media::TemporaryMediaService::new(
                    repository.clone(),
                    Arc::new(
                        meta_messaging::outbound::temporary_media::S3MediaCopies::new(
                            aws_sdk_s3::Client::new(
                                &macro_aws_config::get_macro_aws_config().await,
                            ),
                        ),
                    ),
                    bucket,
                )?,
            ))
        } else {
            None
        };
    let files = Arc::new(files::NativeFiles::new(
        pool.clone(),
        documents,
        access.clone(),
        temporary_media.clone(),
    )?);
    let effects = Arc::new(effects::NativeEffects {
        soup: soup_realtime::domain::service::SoupRealtimeServiceImpl::new(
            soup_realtime::outbound::entity_access::EntityAccessExpander::new((*access).clone()),
            soup_realtime::outbound::kafka_publisher::KafkaSoupRealtimePublisher::new(
                broker.clone(),
            ),
        ),
        activity: activity::domain::materializer::ActivityMaterializer::new(
            activity::outbound::pg_activity_repo::PgActivityRepo::new(pool.clone()),
            activity::domain::announcements::ActivityAnnouncements::new(
                activity::KafkaActivityRealtimePublisher::new(broker),
                crate::service::activity::EntityAccessActivityAudience::new(access.clone()),
            ),
        ),
        notifications: (*notifications).clone(),
    });
    let service = Arc::new(MetaService::new(
        repository,
        Arc::new(settings.provider),
        cipher,
        Arc::new(native::NativeChannels::new(
            pool,
            access.clone(),
            ConnectionGatewayMessages(gateway),
            (*search).clone(),
            files,
            effects,
        )),
        settings.public,
    ));
    if let Some(copies) = temporary_media {
        tokio::spawn(workers::temporary_media(copies));
    }
    spawn(service.clone());
    Ok(State {
        service,
        entity_access_service: access,
        authorization_state: authorization,
        webhooks: Arc::new(settings.webhooks),
    })
}

struct UnconfiguredCipher;
#[async_trait::async_trait]
impl CredentialCipher for UnconfiguredCipher {
    async fn encrypt(
        &self,
        _team: uuid::Uuid,
        _connection: uuid::Uuid,
        _token: &meta_messaging::domain::connection::AccessToken,
    ) -> PortResult<Vec<u8>> {
        Err(MessagingError::Invalid("Meta credential encryption is not configured").into())
    }
    async fn decrypt(
        &self,
        _team: uuid::Uuid,
        _connection: uuid::Uuid,
        _bytes: &[u8],
    ) -> PortResult<meta_messaging::domain::connection::AccessToken> {
        Err(MessagingError::Invalid("Meta credential encryption is not configured").into())
    }
}

fn spawn(service: Arc<MetaService>) {
    let history = service.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(1));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            let result: PortResult<()> = async {
                if let Some(work) = history.repository.claim_history_import().await? {
                    history.process_history_import(&work).await?;
                }
                Ok(())
            }
            .await;
            if let Err(error) = result {
                tracing::warn!(error=?error.current_context(),"Meta history worker will recover durable work");
            }
        }
    });
    tokio::spawn(workers::retention(service.clone()));
    tokio::spawn(workers::receipts(service.clone()));
    tokio::spawn(workers::sends(service.messaging.clone()));
    let recovery = service.messaging.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(1));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            if let Err(error) = recovery.recover_native().await {
                tracing::warn!(error=?error.current_context(),"Meta native delivery recovery will retry");
            }
        }
    });
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            if let Err(error) = service.maintain().await {
                tracing::warn!(error=?error.current_context(),"Meta account/native delivery maintenance will retry");
            }
        }
    });
}
