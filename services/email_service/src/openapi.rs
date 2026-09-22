#![recursion_limit = "256"]
#![allow(unused)]
mod invitation_extraction;

mod api;
mod backfill_completion_service;
mod backfill_init_service;
mod calendar_outbox;
mod config;
mod outbound;
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
