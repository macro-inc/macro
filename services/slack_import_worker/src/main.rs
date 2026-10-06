#![deny(missing_docs)]
// Independent heartbeat/select futures wrap the composed importer and SDK streams.
#![recursion_limit = "256"]
//! Independent Slack archive queue worker and durable recovery composition root.

mod config;

use chrono::{DateTime, Utc};
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use import::outbound::pg_import_repo::PgImportRepo;
use macro_entrypoint::{MacroEntrypoint, shutdown_signal};
use macro_queues::{NotificationIngressQueue, SlackImportDlq, SlackImportQueue};
use macro_service_urls::SearchProcessingServiceUrl;
use notification::{domain::service::SqsNotificationIngress, outbound::queue::SqsQueue};
use slack_import_worker::composition::{
    authorizer::WorkerAuthorizer, channel_sink::ChannelImportSink,
    join_announcer::WorkerJoinAnnouncer, reference_reconciliation::WorkerReferenceReconciler,
};
use slack_integration::{
    domain::{
        importer::{ConversationImporter, ImporterConfig},
        maintenance::ImportMaintenance,
        models::{ImportError, ImportLimits},
        ports::Clock,
    },
    inbound::worker,
    outbound::{
        import_ledger::CanonicalImportLedger, pg_slack_import_repo::PgSlackImportRepo,
        s3_storage::S3ImportStorage, search_backfill::HttpSearchBackfill,
        sqs_queue::SqsImportQueue,
    },
};
use sqlx::postgres::PgPoolOptions;
use teams::{
    domain::join_announcement::JoinAnnouncementServiceImpl,
    outbound::join_announcement_repo::JoinAnnouncementRepositoryImpl,
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> DateTime<Utc> {
        Utc::now()
    }
}

#[tokio::main]
async fn main() -> Result<(), rootcause::Report> {
    let entrypoint = MacroEntrypoint::default().init();
    let result = run().await;
    entrypoint.shutdown();
    result
}

async fn run() -> Result<(), rootcause::Report> {
    let config = macro_config::ConfigLoader::load::<config::Config>()?;
    let worker_config = config.worker()?;
    let limits = ImportLimits::default();
    let pool = PgPoolOptions::new()
        // Leave capacity for lease heartbeats while imports hold transactions.
        .max_connections(12)
        .acquire_timeout(std::time::Duration::from_secs(20))
        .connect(config.database_url.as_ref())
        .await
        .map_err(|_| ImportError::Retryable)?;
    let repo = PgSlackImportRepo::new(pool.clone(), limits);
    let authorizer = WorkerAuthorizer::new(
        pool.clone(),
        EntityAccessServiceImpl::new(PgAccessRepository::new(pool.clone())),
    );
    let sink = ChannelImportSink::new(pool.clone(), authorizer.clone(), limits)?;
    let storage = S3ImportStorage::new(
        macro_aws_config::s3_client().await,
        config.upload_staging_bucket,
        limits,
    )?;
    let sqs = aws_sdk_sqs::Client::new(&macro_aws_config::get_macro_aws_config().await);
    let queue = SqsImportQueue::new(
        sqs.clone(),
        &SlackImportQueue::new(),
        &SlackImportDlq::new(),
    )
    .await
    .map_err(|error| *error.current_context())?;
    let announcer = WorkerJoinAnnouncer::new(
        JoinAnnouncementServiceImpl::new(
            JoinAnnouncementRepositoryImpl::new(pool.clone()),
            SqsNotificationIngress {
                queue: SqsQueue::new(sqs, NotificationIngressQueue::new().to_string()),
            },
        ),
        config.slack_import_join_email_enabled,
    );
    let search = HttpSearchBackfill::new(
        SearchProcessingServiceUrl::new()?.as_ref(),
        &config.internal_api_key,
    )?;
    let importer = ConversationImporter::new(
        repo.clone(),
        storage,
        CanonicalImportLedger::new(PgImportRepo::new(pool.clone())),
        sink.clone(),
        sink,
        authorizer,
        announcer,
        ImporterConfig { limits },
    )?;
    let maintenance = ImportMaintenance::new(
        repo,
        queue.clone(),
        search,
        SystemClock,
        WorkerReferenceReconciler::new(pool, limits),
    );
    let stop = CancellationToken::new();
    let signal = async {
        shutdown_signal().await;
        stop.cancel();
    };
    let owner = Uuid::now_v7().try_into()?;
    tokio::join!(
        worker::run(
            &importer,
            &maintenance,
            &queue,
            owner,
            worker_config,
            stop.clone()
        ),
        signal
    );
    Ok(())
}
