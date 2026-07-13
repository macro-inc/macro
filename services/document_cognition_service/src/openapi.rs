#![recursion_limit = "256"]
#![allow(unused)]

mod api;
mod config;
mod core;
mod model;
mod service;

pub use config::Config;

use utoipa::OpenApi;

fn main() {
    println!(
        "{}",
        api::swagger::ApiDoc::openapi().to_pretty_json().unwrap()
    );
}
