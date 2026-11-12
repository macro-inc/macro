#![recursion_limit = "256"]
#![allow(unused)]

mod api;
mod config;
mod env;
mod model;
mod notification;
mod ping;
mod wiring;

use utoipa::OpenApi;

fn main() {
    println!(
        "{}",
        api::swagger::ApiDoc::openapi().to_pretty_json().unwrap()
    );
}
