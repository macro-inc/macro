#![allow(unused)]

mod api;
mod backfill_completion_service;
mod backfill_init_service;
mod calendar_ingest;
mod calendar_outbox;
mod config;
mod convert;
mod pubsub;
mod util;
mod utils;

use utoipa::OpenApi;

fn main() {
    println!(
        "{}",
        api::swagger::ApiDoc::openapi().to_pretty_json().unwrap()
    );
}
