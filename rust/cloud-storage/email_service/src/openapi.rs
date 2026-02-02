#![allow(unused)]

mod api;
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
