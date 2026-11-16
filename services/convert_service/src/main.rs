#![recursion_limit = "256"]
use crate::api::context::{ApiContext, AuthorizationService};
use anyhow::Context;
use config::{Config, Environment};
use disk::{DiskGuard, MIN_FREE_BYTES, MIN_FREE_INODES};
use macro_authorization::{
    InternalAuthConfig, MacroAuthorizationState, NoopMacroAuthJwtValidator,
    PgUserApiKeyAuthorizationRepo, PgUserApiKeyAuthorizer,
};
use macro_entrypoint::MacroEntrypoint;
use process::{
    child::{ChildExit, run_confined, set_child_env},
    convert::Converter,
    runner::run_worker,
};
use scratch::Scratch;
use sqlx::postgres::PgPoolOptions;
use std::{ffi::OsStr, sync::Arc, time::Duration};

mod api;
mod config;
mod disk;
mod model;
mod process;
mod scratch;
mod utils;

/// How long LibreOfficeKit may take to load at startup.
const LOK_SMOKE_TEST_TIMEOUT: Duration = Duration::from_secs(120);

/// Smoke-tests LibreOfficeKit by initializing it in a child process, the way
/// a conversion does. Fails fast at startup if the LOK shared libraries cannot
/// be loaded, and fills the caches conversions share before the first job.
fn smoke_test_lok(lok_path: &str, scratch: &Scratch) -> anyhow::Result<()> {
    tracing::info!("running LOK smoke test");

    let folder = scratch.create_job()?;
    let exit = run_confined(
        folder.path(),
        scratch.cache(),
        LOK_SMOKE_TEST_TIMEOUT,
        || {
            set_child_env(c"SAL_LOG", OsStr::new(""))?;
            rs_libreoffice_bindings::Office::new(lok_path)
                .map(drop)
                .map_err(|e| anyhow::anyhow!(e))
        },
    )?;

    if exit != ChildExit::Succeeded {
        anyhow::bail!("LOK smoke test failed: {exit:?}");
    }

    tracing::info!("LOK smoke test passed");
    Ok(())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let env = Environment::new_or_prod();
    MacroEntrypoint::new(env).init();

    // Parse our configuration from the environment.
    let config = Config::from_env().context("expected to be able to generate config")?;

    let scratch = Arc::new(Scratch::reset(&Scratch::default_root())?);
    let disk = DiskGuard::new(scratch.root(), MIN_FREE_BYTES, MIN_FREE_INODES);

    smoke_test_lok(&config.lok_path, &scratch)?;

    // As many at once as when conversions ran on the async workers, one per CPU.
    let max_conversions = std::thread::available_parallelism()
        .context("unable to count the CPUs")?
        .get();
    let converter = Arc::new(Converter::new(scratch, max_conversions));

    let aws_config = macro_aws_config::get_macro_aws_config().await;

    let db = PgPoolOptions::new()
        .min_connections(1)
        .max_connections(5)
        .connect(&config.database_url)
        .await
        .context("could not connect to db")?;

    let authorization_state = MacroAuthorizationState::new(Arc::new(AuthorizationService::new(
        NoopMacroAuthJwtValidator, // we only have internal calls in this service.
        InternalAuthConfig {
            api_key: config.internal_api_key.to_string(),
            default_user_id: None,
        },
        macro_authorization::NoBotAuthorizer,
        PgUserApiKeyAuthorizer::new(PgUserApiKeyAuthorizationRepo::new(db.clone())),
    )));

    tracing::trace!("initialized config");

    let queue_aws_config = macro_aws_config::get_macro_aws_config().await;

    let s3_client = s3_client::S3::new(macro_aws_config::s3_client().await);
    tracing::trace!("initialized s3 client");

    let convert_queue = macro_queues::ConvertQueue::new();
    let sqs_client = sqs_client::SQS::new(aws_sdk_sqs::Client::new(&queue_aws_config))
        .convert_queue(&convert_queue);
    tracing::trace!("initialized sqs client");

    if !cfg!(feature = "disable_worker") {
        let sqs_client = aws_sdk_sqs::Client::new(&queue_aws_config);
        let sqs_worker = sqs_worker::SQSWorker::new(
            sqs_client,
            convert_queue.to_string(),
            config.queue_max_messages,
            config.queue_wait_time_seconds,
        );
        let s3_client = s3_client.clone();
        let lambda_client = lambda_client::Lambda::new(aws_sdk_lambda::Client::new(&aws_config));

        let converter = converter.clone();
        let disk = disk.clone();

        tokio::spawn(async move {
            run_worker(sqs_worker, s3_client, lambda_client, converter, disk).await
        });
    }

    api::setup_and_serve(ApiContext {
        db,
        s3_client,
        authorization_state,
        sqs_client: Arc::new(sqs_client),
        config: Arc::new(config),
        converter,
        disk,
    })
    .await?;
    Ok(())
}
