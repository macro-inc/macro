#![recursion_limit = "256"]
use std::sync::Arc;

use crate::{
    api::context::ApiContext,
    domain::service::BackfillOrchestrator,
    outbound::{publisher::SqsSearchEventPublisher, source::PgBackfillSource},
    process::{context::SearchProcessingContext, worker::run_search_processing_workers},
};
use anyhow::Context;
use config::{Config, Environment};
use lexical_client::LexicalClient;
use macro_entrypoint::MacroEntrypoint;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use opensearch_client::OpensearchClient;
use rust_embed::RustEmbed;
use secretsmanager_client::{LocalOrRemoteSecret, OptionalLocalOrRemoteSecret, SecretManager};
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;

mod api;
mod config;
mod domain;
mod outbound;
mod parsers;
mod process;

/// Concrete [`BackfillOrchestrator`] wired to the production Postgres source
/// and the SQS publisher. Lives in the wiring module so the domain stays
/// agnostic of which adapters back it.
pub type BackfillServiceImpl = BackfillOrchestrator<PgBackfillSource, SqsSearchEventPublisher>;

/// Resolve a read-replica macrodb URL via [`OptionalLocalOrRemoteSecret`] and
/// connect a small pool. Returns `None` when the replica URL is missing,
/// blank, fails to fetch from Secrets Manager, or is unreachable. Failures
/// are intentionally warning-level rather than fatal: the readonly pool is a
/// contention optimisation, not a correctness requirement (e.g. local laptop
/// dev cannot reach the VPC-gated read replica).
async fn resolve_readonly_pool(
    raw: Option<String>,
    secrets: &secretsmanager_client::SecretsManager,
) -> Option<PgPool> {
    let raw = raw.filter(|s| !s.is_empty());
    let resolved = match OptionalLocalOrRemoteSecret::new_from_secret_manager(raw, secrets).await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(error=?e, "unable to fetch readonly db secret; backfills will use primary");
            return None;
        }
    };
    let url = resolved.as_str()?;
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
}

#[allow(dead_code)]
#[derive(RustEmbed)]
#[folder = "pdfium-lib/linux/"]
struct PdfiumLib;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    // Parse our configuration from the environment.
    let config = Config::from_env().context("expected to be able to generate config")?;
    tracing::trace!("initialized config");

    let aws_config = macro_aws_config::get_macro_aws_config().await;

    let sqs_client = sqs_client::SQS::new(aws_sdk_sqs::Client::new(&aws_config))
        .search_event_queue(&config.search_event_queue);

    let s3_client = s3_client::S3::new(macro_aws_config::s3_client().await);

    let secretsmanager_client = secretsmanager_client::SecretsManager::new(
        aws_sdk_secretsmanager::Client::new(&aws_config),
    );

    let database_url = match config.environment {
        Environment::Local => config.database_url.clone(),
        _ => secretsmanager_client
            .get_secret_value(&config.database_url)
            .await
            .context("unable to get secret")?
            .to_string(),
    };

    let opensearch_password = match config.environment {
        Environment::Local => config.opensearch_password.clone(),
        _ => secretsmanager_client
            .get_secret_value(&config.opensearch_password)
            .await
            .context("unable to get secret")?
            .to_string(),
    };

    let (min_connections, max_connections): (u32, u32) = match config.environment {
        Environment::Production => (5, 50),
        Environment::Develop => (1, 25),
        Environment::Local => (1, 10),
    };

    let db = PgPoolOptions::new()
        .min_connections(min_connections)
        .max_connections(max_connections)
        .connect(&database_url)
        .await
        .context("could not connect to db")?;

    tracing::trace!(
        min_connections,
        max_connections,
        "initialized db connection"
    );

    let opensearch_client = OpensearchClient::new(
        config.opensearch_url.clone(),
        config.opensearch_username.clone(),
        opensearch_password,
    )
    .context("unable to create opensearch client")?;

    if let Err(e) = opensearch_client.health().await {
        tracing::error!(error=?e, "error connecting to opensearch");
        return Err(e);
    }

    let internal_auth_key = LocalOrRemoteSecret::Local(InternalApiSecretKey::new()?);

    // Backfills run against the read-replica when available so they don't
    // contend with writes on the primary. Queue workers always read from the
    // primary because replica lag would cause them to miss rows they are
    // meant to index.
    let backfill_db =
        match resolve_readonly_pool(config.database_url_readonly.clone(), &secretsmanager_client)
            .await
        {
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
        PgBackfillSource::new(backfill_db, config.backfill_page_sizes),
        SqsSearchEventPublisher::new(sqs_client.clone()),
    ));

    #[cfg(feature = "processing")]
    {
        use std::sync::Arc;

        // Ensures that pdfium binary exists so we can kill the container early on failure
        if !std::fs::exists("./pdfium-lib/linux/libpdfium.so").expect("able to find file") {
            anyhow::bail!("libpdfium.so is missing");
        } else {
            tracing::trace!("libpdfium is present");
        }

        let sync_service_auth_key = match config.environment {
            Environment::Local => config.sync_service_auth_key.clone(),
            _ => secretsmanager_client
                .get_secret_value(&config.sync_service_auth_key)
                .await
                .context("unable to get secret")?
                .to_string(),
        };

        let lexical_client = LexicalClient::new(
            sync_service_auth_key.clone(),
            config.lexical_service_url.clone(),
        );

        let worker = sqs_worker::SQSWorker::new(
            aws_sdk_sqs::Client::new(&aws_config),
            config.search_event_queue.clone(),
            config.queue_max_messages,
            config.queue_wait_time_seconds,
        );
        let ctx = SearchProcessingContext {
            db: db.clone(),
            worker: Arc::new(worker.clone()),
            document_storage_bucket: config.document_storage_bucket.clone(),
            s3_client: Arc::new(s3_client),
            opensearch_client: Arc::new(opensearch_client.clone()),
            lexical_client: Arc::new(lexical_client),
        };
        run_search_processing_workers(ctx, config.worker_count);
    }

    api::setup_and_serve(ApiContext {
        db,
        sqs_client,
        opensearch_client: Arc::new(opensearch_client),
        internal_auth_key,
        config: Arc::new(config),
        backfill_service,
    })
    .await?;
    Ok(())
}
