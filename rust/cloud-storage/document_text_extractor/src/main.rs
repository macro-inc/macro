mod handler;
mod model;
mod service;
use handler::handler;
use lambda_runtime::{
    Error, LambdaEvent, run, service_fn,
    tracing::{self},
};
use macro_entrypoint::MacroEntrypoint;
use macro_env_var::env_var;
use model::IncomingEvent;
use pdfium_render::prelude::*;
use sqlx::postgres::PgPoolOptions;
use std::{rc::Rc, sync::Arc};

env_var! {
    struct Config {
        DatabaseUrl
    }
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    MacroEntrypoint::default().init();

    tracing::trace!("initiating lambda");

    let config = Config::new()?;

    tracing::trace!("initialized config");

    let db = service::db::DB::new(
        PgPoolOptions::new()
            .min_connections(1)
            .max_connections(1) // we only ever need one connection per lambda
            .connect(&config.database_url)
            .await
            .map_err(|err| {
                tracing::error!(error=?err, "unable to connect to database");
                err
            })?,
    );

    tracing::trace!("initialized db client");

    let aws_config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region("us-east-1")
        .load()
        .await;

    let s3_client = service::s3::S3::new(aws_sdk_s3::Client::new(&aws_config));
    tracing::trace!("initialized s3 client");

    // Set which pdfium binary to use
    let pdfium_binary_location = env!("PDFIUM_LIB_PATH");

    let pdfium = Pdfium::new(
        Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path(
            pdfium_binary_location,
        ))
        .map_err(|err| {
            tracing::error!(error=?err, "unable to bind to pdfium library");
            err
        })?,
    );

    tracing::trace!("initialized pdfium");

    // Shared references
    // Needed to allow them to be kept warm in the lambda
    let shared_db = Arc::new(db);
    let shared_s3_client = Arc::new(s3_client);
    let shared_pdfium = Rc::new(pdfium);

    // Incoming Event can either be an s3 event or a sqs event
    // s3 event is triggered on document upload, sqs event is a manual trigger
    let func = service_fn(move |event: LambdaEvent<IncomingEvent>| {
        let db = shared_db.clone();
        let s3_client = shared_s3_client.clone();
        let pdfium = shared_pdfium.clone();

        async move { handler(db, s3_client, pdfium, event).await }
    });

    run(func).await
}
