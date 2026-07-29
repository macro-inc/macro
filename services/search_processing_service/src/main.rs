#![recursion_limit = "256"]
use std::sync::Arc;
#[cfg(feature = "processing")]
use std::time::Duration;

#[cfg(feature = "processing")]
use crate::inbound::kafka_consumer::run_event_consumer;
use crate::{
    api::context::{ApiContext, AuthorizationService},
    config::DatabaseUrlReadonly,
    domain::{jobs::BackfillJobs, service::BackfillOrchestrator},
    outbound::{publisher::SqsSearchEventPublisher, source::PgBackfillSource},
    process::{context::SearchProcessingContext, worker::run_search_processing_workers},
};
use anyhow::Context;
use config::{Config, Environment};
use lexical_client::LexicalClient;
use macro_authorization::{InternalAuthConfig, MacroAuthorizationState, NoopMacroAuthJwtValidator};
use macro_entrypoint::MacroEntrypoint;
use opensearch_client::OpensearchClient;
#[cfg(feature = "pdf")]
use rust_embed::RustEmbed;
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;
#[cfg(feature = "processing")]
use tokio_retry::{Retry, strategy::FixedInterval};
use tokio_util::sync::CancellationToken;

mod api;
mod config;
mod domain;
#[cfg(feature = "processing")]
#[allow(dead_code)] // Wired into service startup with the Kafka configuration.
mod inbound;
mod outbound;
mod parsers;
mod process;

/// Concrete [`BackfillOrchestrator`] wired to the production Postgres source
/// and the SQS publisher. Lives in the wiring module so the domain stays
/// agnostic of which adapters back it.
pub type BackfillServiceImpl = BackfillOrchestrator<PgBackfillSource, SqsSearchEventPublisher>;

/// Resolve a read-replica macrodb URL and
/// connect a small pool. Returns `None` when the replica URL is missing,
/// blank. Failures
/// are intentionally warning-level rather than fatal: the readonly pool is a
/// contention optimisation, not a correctness requirement (e.g. local laptop
/// dev cannot reach the VPC-gated read replica).
async fn resolve_readonly_pool(read_only_db_url: DatabaseUrlReadonly) -> Option<PgPool> {
    if let Some(url) = read_only_db_url.value() {
        match PgPoolOptions::new()
            .min_connections(1)
            .max_connections(10)
            .connect(url)
            .await
        {
            Ok(pool) => Some(pool),
            Err(e) => {
                tracing::warn!(error=?e, "could not connect to readonly macrodb; backfills will use primary");
                None
            }
        }
    } else {
        None
    }
}

#[cfg(feature = "pdf")]
#[allow(dead_code)]
#[derive(RustEmbed)]
#[folder = "pdfium-lib/linux/"]
struct PdfiumLib;

#[cfg(feature = "processing")]
const CONSUMER_RESTART_DELAY: Duration = Duration::from_secs(5);

#[cfg(feature = "processing")]
async fn supervise_event_consumer(
    brokers: String,
    db: PgPool,
    opensearch_client: OpensearchClient,
    shutdown_token: CancellationToken,
) {
    let _ = Retry::start(FixedInterval::new(CONSUMER_RESTART_DELAY), || {
        let consumer_brokers = brokers.clone();
        let consumer_db = db.clone();
        let consumer_opensearch_client = opensearch_client.clone();
        let consumer_shutdown_token = shutdown_token.clone();

        async move {
            if consumer_shutdown_token.is_cancelled() {
                return Ok(());
            }

            let task_shutdown_token = consumer_shutdown_token.clone();
            let consumer_result = tokio::spawn(async move {
                run_event_consumer(
                    &consumer_brokers,
                    consumer_db,
                    consumer_opensearch_client,
                    task_shutdown_token.cancelled_owned(),
                )
                .await
            })
            .await;

            if consumer_shutdown_token.is_cancelled() {
                tracing::info!("search processing event consumer stopped after shutdown");
                return Ok(());
            }

            match consumer_result {
                Ok(Ok(())) => {
                    tracing::error!("search processing event consumer exited unexpectedly");
                }
                Ok(Err(error)) => {
                    tracing::error!(error = ?error, "search processing event consumer failed");
                }
                Err(error) if error.is_panic() => {
                    tracing::error!(error = ?error, "search processing event consumer panicked");
                }
                Err(error) => {
                    tracing::error!(error = ?error, "search processing event consumer task was cancelled");
                }
            }

            tracing::warn!(
                restart_delay_seconds = CONSUMER_RESTART_DELAY.as_secs(),
                "search processing event consumer stopped; waiting before restart"
            );
            Err(())
        }
    })
    .await;

    tracing::info!("search processing event consumer supervisor stopped");
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    // Parse our configuration from the environment.
    let config = Config::from_env().context("expected to be able to generate config")?;
    tracing::trace!("initialized config");

    let authorization_state = MacroAuthorizationState::new(Arc::new(AuthorizationService::new(
        NoopMacroAuthJwtValidator, // we only have internal calls in this service.
        InternalAuthConfig {
            api_key: config.internal_api_key.to_string(),
            default_user_id: None,
        },
        macro_authorization::NoBotAuthorizer,
    )));

    let aws_config = macro_aws_config::get_macro_aws_config().await;
    let search_event_queue = macro_queues::SearchEventQueue::new();
    let sqs_client = sqs_client::SQS::new(aws_sdk_sqs::Client::new(&aws_config))
        .search_event_queue(&search_event_queue);

    let s3_client = s3_client::S3::new(macro_aws_config::s3_client().await);

    let (min_connections, max_connections): (u32, u32) = match config.environment {
        Environment::Production => (5, 50),
        Environment::Develop => (1, 25),
        Environment::Local => (1, 10),
    };

    let db = PgPoolOptions::new()
        .min_connections(min_connections)
        .max_connections(max_connections)
        .connect(config.database_url.as_ref())
        .await
        .context("could not connect to db")?;

    tracing::trace!(
        min_connections,
        max_connections,
        "initialized db connection"
    );

    let opensearch_client = OpensearchClient::new(
        config.opensearch_url.to_string(),
        config.opensearch_username.to_string(),
        config.opensearch_password.as_ref().to_string(),
    )
    .context("unable to create opensearch client")?;

    if let Err(e) = opensearch_client.health().await {
        tracing::error!(error=?e, "error connecting to opensearch");
        return Err(e);
    }

    // Backfills run against the read-replica when available so they don't
    // contend with writes on the primary. Queue workers always read from the
    // primary because replica lag would cause them to miss rows they are
    // meant to index.
    let backfill_db = match resolve_readonly_pool(config.database_url_readonly.clone()).await {
        Some(pool) => {
            tracing::info!("using read-replica pool for backfill reads");
            pool
        }
        None => {
            tracing::info!("backfills will read from the primary pool");
            db.clone()
        }
    };

    let sqs_client = Arc::new(sqs_client);

    let backfill_service = Arc::new(BackfillOrchestrator::new(
        PgBackfillSource::new(backfill_db, config.backfill_page_sizes()?),
        SqsSearchEventPublisher::new(sqs_client.clone()),
    ));

    let shutdown_token = CancellationToken::new();

    #[cfg(feature = "processing")]
    let consumer_supervisor = {
        use std::sync::Arc;

        // Ensures that pdfium binary exists so we can kill the container early on failure
        #[cfg(feature = "pdf")]
        if !std::fs::exists("./pdfium-lib/linux/libpdfium.so").expect("able to find file") {
            anyhow::bail!("libpdfium.so is missing");
        } else {
            tracing::trace!("libpdfium is present");
        }

        let lexical_client = LexicalClient::new(
            config.internal_api_key.to_string(),
            config.lexical_service_url.clone(),
        );

        let worker = sqs_worker::SQSWorker::new(
            aws_sdk_sqs::Client::new(&aws_config),
            search_event_queue.to_string(),
            config.queue_max_messages,
            config.queue_wait_time_seconds,
        );
        let ctx = SearchProcessingContext {
            db: db.clone(),
            worker: Arc::new(worker.clone()),
            document_storage_bucket: config.document_storage_bucket.to_string(),
            s3_client: Arc::new(s3_client),
            opensearch_client: Arc::new(opensearch_client.clone()),
            lexical_client: Arc::new(lexical_client),
        };
        run_search_processing_workers(ctx, config.worker_count);

        tokio::spawn(supervise_event_consumer(
            config.kafka_brokers.as_ref().to_owned(),
            db.clone(),
            opensearch_client.clone(),
            shutdown_token.clone(),
        ))
    };

    let dynamodb_client = aws_sdk_dynamodb::Client::new(&aws_config);
    let backfill_jobs = BackfillJobs::new(
        dynamodb_client,
        config.backfill_jobs_table.to_string(),
        std::time::Duration::from_secs(config.backfill_job_ttl_seconds()?),
    );
    if matches!(config.environment, Environment::Local) {
        backfill_jobs
            .ensure_table()
            .await
            .context("failed to ensure backfill jobs table exists")?;
    }

    let api_result = api::setup_and_serve(
        ApiContext {
            db,
            authorization_state,
            sqs_client,
            opensearch_client: Arc::new(opensearch_client),
            config: Arc::new(config),
            backfill_service,
            backfill_jobs,
        },
        shutdown_token.clone(),
    )
    .await;

    shutdown_token.cancel();
    #[cfg(feature = "processing")]
    consumer_supervisor
        .await
        .context("search processing event consumer supervisor failed")?;

    api_result
}
