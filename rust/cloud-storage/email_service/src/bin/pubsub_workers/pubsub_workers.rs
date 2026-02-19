use anyhow::Context;
use document_storage_service_client::DocumentStorageServiceClient;
use email_service::config::{Config, EmailServiceCloudfrontSignerPrivateKey};
use macro_entrypoint::MacroEntrypoint;
use macro_env::Environment;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use notification::domain::service::NotificationIngressService;
use notification::outbound::{queue::SqsNotificationQueue, repository::DbNotificationRepository};
use secretsmanager_client::SecretManager;
use sqlx::postgres::PgPoolOptions;
use static_file_service_client::StaticFileServiceClient;
use std::sync::Arc;
use system_properties::{PgSystemPropertiesRepository, SystemPropertiesServiceImpl};

#[tokio::main]
#[tracing::instrument(err)]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();
    let env = Environment::new_or_prod();

    let aws_config = macro_aws_config::get_macro_aws_config().await;

    let s3_client = s3_client::S3::new(macro_aws_config::s3_client().await);

    let secretsmanager_client = secretsmanager_client::SecretsManager::new(
        aws_sdk_secretsmanager::Client::new(&aws_config),
    );

    let cloudfront_signer_private_key = secretsmanager_client
        .get_maybe_secret_value(env, EmailServiceCloudfrontSignerPrivateKey::new()?)
        .await?;

    // Parse our configuration from the environment.
    let config = Config::from_env(cloudfront_signer_private_key)
        .context("expected to be able to generate config")?;

    let auth_service_secret_key = match config.environment {
        Environment::Local => config.auth_service_secret_key.clone(),
        _ => secretsmanager_client
            .get_secret_value(config.auth_service_secret_key.clone())
            .await
            .context("unable to get secret")?
            .to_string(),
    };

    let (min_connections, max_connections): (u32, u32) = match config.environment {
        Environment::Production => (3, 15),
        Environment::Develop => (1, 10),
        Environment::Local => (1, 10),
    };

    let (min_connections_backfill, max_connections_backfill): (u32, u32) = match config.environment
    {
        Environment::Production => (3, 25),
        Environment::Develop => (1, 30),
        Environment::Local => (1, 50),
    };

    // all non-backfill workers share a connection pool
    let db = PgPoolOptions::new()
        .min_connections(min_connections)
        .max_connections(max_connections)
        .connect(&config.macro_db_url)
        .await
        .context("could not connect to db")?;

    let db_backfill = PgPoolOptions::new()
        .min_connections(min_connections_backfill)
        .max_connections(max_connections_backfill)
        .connect(&config.macro_db_url)
        .await
        .context("could not connect to backfill db")?;

    let gmail_queue_aws_config = macro_aws_config::get_macro_aws_config().await;

    let sqs_client = sqs_client::SQS::new(aws_sdk_sqs::Client::new(&gmail_queue_aws_config))
        .gmail_inbox_sync_queue(&config.gmail_inbox_sync_queue)
        .gmail_inbox_sync_retry_queue(&config.gmail_inbox_sync_retry_queue)
        .search_event_queue(&config.search_event_queue)
        .email_backfill_queue(&config.backfill_queue)
        .email_scheduled_queue(&config.email_scheduled_queue)
        .sfs_uploader_queue(&config.sfs_uploader_queue)
        .sfs_delete_queue(&config.sfs_delete_queue)
        .contacts_queue(&config.contacts_queue)
        .email_link_manager_queue(&config.link_manager_queue);

    let notification_ingress_service = Arc::new(NotificationIngressService::new(
        DbNotificationRepository::new(db.clone()),
        SqsNotificationQueue::new(
            aws_sdk_sqs::Client::new(&aws_config),
            config.notification_queue.clone(),
        ),
    ));

    let link_manager_worker = sqs_worker::SQSWorker::new(
        aws_sdk_sqs::Client::new(&gmail_queue_aws_config),
        config.link_manager_queue.clone(),
        config.queue_max_messages,
        config.queue_wait_time_seconds,
    );

    let scheduled_worker = sqs_worker::SQSWorker::new(
        aws_sdk_sqs::Client::new(&gmail_queue_aws_config),
        config.email_scheduled_queue.clone(),
        config.queue_max_messages,
        config.queue_wait_time_seconds,
    );

    let sfs_uploader_workers = (0..config.sfs_uploader_workers)
        .map(|_| {
            sqs_worker::SQSWorker::new(
                aws_sdk_sqs::Client::new(&gmail_queue_aws_config),
                config.sfs_uploader_queue.clone(),
                config.queue_max_messages,
                config.queue_wait_time_seconds,
            )
        })
        .collect::<Vec<_>>();

    let sfs_delete_worker = sqs_worker::SQSWorker::new(
        aws_sdk_sqs::Client::new(&gmail_queue_aws_config),
        config.sfs_delete_queue.clone(),
        config.queue_max_messages,
        config.queue_wait_time_seconds,
    );

    let backfill_workers = (0..config.backfill_queue_workers)
        .map(|_| {
            sqs_worker::SQSWorker::new(
                aws_sdk_sqs::Client::new(&gmail_queue_aws_config),
                config.backfill_queue.clone(),
                config.backfill_queue_max_messages,
                config.queue_wait_time_seconds,
            )
        })
        .collect::<Vec<_>>();

    let inbox_sync_workers = (0..config.inbox_sync_queue_workers)
        .map(|_| {
            sqs_worker::SQSWorker::new(
                aws_sdk_sqs::Client::new(&gmail_queue_aws_config),
                config.gmail_inbox_sync_queue.clone(),
                config.inbox_sync_queue_max_messages,
                config.queue_wait_time_seconds,
            )
        })
        .collect::<Vec<_>>();

    let inbox_sync_retry_workers = (0..config.inbox_sync_retry_queue_workers)
        .map(|_| {
            sqs_worker::SQSWorker::new(
                aws_sdk_sqs::Client::new(&gmail_queue_aws_config),
                config.gmail_inbox_sync_retry_queue.clone(),
                config.inbox_sync_retry_queue_max_messages,
                config.queue_wait_time_seconds,
            )
        })
        .collect::<Vec<_>>();

    let auth_service_client = authentication_service_client::AuthServiceClient::new(
        auth_service_secret_key,
        config.auth_service_url.clone(),
    );

    let gmail_client = gmail_client::GmailClient::new(config.gmail_gcp_queue.clone());

    let redis_inner_client = redis::Client::open(config.redis_uri.as_str())
        .inspect(|client| {
            client
                .get_connection()
                .map(|_| tracing::info!("initialized redis connection"))
                .inspect_err(|e| {
                    tracing::error!(error=?e, "failed to connect to redis");
                })
                .ok();
        })
        .context("failed to connect to redis")?;

    let redis_client = email_service::util::redis::RedisClient::new(
        redis_inner_client,
        config.redis_rate_limit_reqs,
        config.redis_rate_limit_reqs_backfill,
        config.redis_rate_limit_window_secs,
    );

    let internal_auth_key = InternalApiSecretKey::new()?;

    let sfs_client = StaticFileServiceClient::new(
        internal_auth_key.as_ref().to_string(),
        config.static_file_service_url.clone(),
    );

    let dss_client = DocumentStorageServiceClient::new(
        internal_auth_key.as_ref().to_string(),
        config.document_storage_service_url.clone(),
    );

    let connection_gateway_client = connection_gateway_client::client::ConnectionGatewayClient::new(
        internal_auth_key.as_ref().to_string(),
        config.connection_gateway_url.clone(),
    );

    let system_properties_service = Arc::new(SystemPropertiesServiceImpl::new(
        PgSystemPropertiesRepository::new(db.clone()),
    ));

    // process user inbox updates from gmail inbox_sync queue, triggered by update pubsub messages from Google
    for worker in inbox_sync_workers {
        let db_inbox_sync = db.clone();
        let sqs_client_inbox_sync = sqs_client.clone();
        let gmail_client_inbox_sync = gmail_client.clone();
        let auth_service_client_inbox_sync = auth_service_client.clone();
        let redis_client_inbox_sync = redis_client.clone();
        let notification_ingress_service_inbox_sync = notification_ingress_service.clone();
        let sfs_client_inbox_sync = sfs_client.clone();
        let connection_gateway_client_inbox_sync = connection_gateway_client.clone();
        let dss_client_inbox_sync = dss_client.clone();
        let system_properties_service_inbox_sync = system_properties_service.clone();
        tokio::spawn(async move {
            email_service::pubsub::inbox_sync::worker::run_worker(
                db_inbox_sync,
                worker,
                sqs_client_inbox_sync,
                gmail_client_inbox_sync,
                auth_service_client_inbox_sync,
                redis_client_inbox_sync,
                notification_ingress_service_inbox_sync,
                sfs_client_inbox_sync,
                connection_gateway_client_inbox_sync,
                dss_client_inbox_sync,
                system_properties_service_inbox_sync,
                config.notifications_enabled,
                false,
            )
            .await;
        });
    }
    tracing::info!(
        num_workers = config.inbox_sync_queue_workers,
        "inbox_sync workers started"
    );

    // separate queue for retries to avoid backups for large inbox updates that hit gmail api rate limit
    for worker in inbox_sync_retry_workers {
        let db_inbox_sync = db.clone();
        let sqs_client_inbox_sync = sqs_client.clone();
        let gmail_client_inbox_sync = gmail_client.clone();
        let auth_service_client_inbox_sync = auth_service_client.clone();
        let redis_client_inbox_sync = redis_client.clone();
        let notification_ingress_service_inbox_sync = notification_ingress_service.clone();
        let sfs_client_inbox_sync = sfs_client.clone();
        let connection_gateway_client_inbox_sync = connection_gateway_client.clone();
        let dss_client_inbox_sync = dss_client.clone();
        let system_properties_service_inbox_sync = system_properties_service.clone();
        tokio::spawn(async move {
            email_service::pubsub::inbox_sync::worker::run_worker(
                db_inbox_sync,
                worker,
                sqs_client_inbox_sync,
                gmail_client_inbox_sync,
                auth_service_client_inbox_sync,
                redis_client_inbox_sync,
                notification_ingress_service_inbox_sync,
                sfs_client_inbox_sync,
                connection_gateway_client_inbox_sync,
                dss_client_inbox_sync,
                system_properties_service_inbox_sync,
                config.notifications_enabled,
                true,
            )
            .await;
        });
    }
    tracing::info!(
        num_workers = config.inbox_sync_queue_workers,
        "inbox_sync retry workers started"
    );

    // backfill user emails upon signup
    for worker in backfill_workers {
        let db_backfill = db_backfill.clone();
        let sqs_client_backfill = sqs_client.clone();
        let gmail_client_backfill = gmail_client.clone();
        let auth_service_client_backfill = auth_service_client.clone();
        let redis_client_backfill = redis_client.clone();
        let notification_ingress_service_backfill = notification_ingress_service.clone();
        let sfs_client_backfill = sfs_client.clone();
        let connection_gateway_client_backfill = connection_gateway_client.clone();
        let dss_client_backfill = dss_client.clone();
        let system_properties_service_backfill = system_properties_service.clone();
        tokio::spawn(async move {
            email_service::pubsub::backfill::worker::run_worker(
                db_backfill,
                worker,
                sqs_client_backfill,
                gmail_client_backfill,
                auth_service_client_backfill,
                redis_client_backfill,
                notification_ingress_service_backfill,
                sfs_client_backfill,
                connection_gateway_client_backfill,
                dss_client_backfill,
                system_properties_service_backfill,
                config.notifications_enabled,
            )
            .await;
        });
    }
    tracing::info!(
        num_workers = config.backfill_queue_workers,
        "backfill workers started"
    );

    let db_link_manager = db.clone();
    let gmail_client_link_manager = gmail_client.clone();
    let auth_service_client_link_manager = auth_service_client.clone();
    let redis_client_link_manager = redis_client.clone();
    let sqs_client_link_manager = sqs_client.clone();
    // daily link_manager operations for user contacts and inbox subscriptions
    tokio::spawn(async move {
        email_service::pubsub::link_manager::worker::run_worker(
            link_manager_worker,
            db_link_manager,
            gmail_client_link_manager,
            auth_service_client_link_manager,
            redis_client_link_manager,
            sqs_client_link_manager,
        )
        .await;
    });

    let db_scheduled = db.clone();
    let gmail_client_scheduled = gmail_client.clone();
    let auth_service_client_scheduled = auth_service_client.clone();
    let redis_client_scheduled = redis_client.clone();
    let s3_client_scheduled = s3_client.clone();
    let attachment_bucket_scheduled = config.attachment_bucket.clone();
    // send scheduled emails
    tokio::spawn(async move {
        email_service::pubsub::scheduled::worker::run_worker(
            scheduled_worker,
            db_scheduled,
            gmail_client_scheduled,
            auth_service_client_scheduled,
            redis_client_scheduled,
            s3_client_scheduled,
            attachment_bucket_scheduled,
        )
        .await;
    });

    if cfg!(feature = "sfs_map") {
        for worker in sfs_uploader_workers {
            let db_sfs_uploader = db.clone();
            let sfs_client_sfs_uploader = sfs_client.clone();
            // upload user contact images to sfs from contact sync
            tokio::spawn(async move {
                email_service::pubsub::sfs_uploader::worker::run_worker(
                    worker,
                    db_sfs_uploader,
                    sfs_client_sfs_uploader,
                )
                .await;
            });
        }
        tracing::info!(
            num_workers = config.sfs_uploader_workers,
            "sfs uploader workers started"
        );
    }

    if cfg!(feature = "sfs_delete") {
        let db_sfs_delete = db.clone();
        let sfs_client_sfs_delete = sfs_client.clone();
        // delete orphaned sfs attachments
        tokio::spawn(async move {
            email_service::pubsub::sfs_deleter::worker::run_worker(
                sfs_delete_worker,
                db_sfs_delete,
                sfs_client_sfs_delete,
            )
            .await;
        });
        tracing::info!("sfs delete worker started");
    }

    tracing::info!("All workers started successfully");

    // Wait for shutdown signal (SIGTERM from ECS or SIGINT from Ctrl+C)
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            tracing::info!("Received SIGINT (Ctrl+C)");
        }
        _ = async {
            let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("failed to install SIGTERM handler");
            term.recv().await
        } => {
            tracing::info!("Received SIGTERM");
        }
    }

    tracing::info!("Shutdown signal received, exiting gracefully...");

    Ok(())
}
