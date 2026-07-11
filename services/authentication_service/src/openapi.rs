#![allow(unused)]

mod api;
mod config;
mod generate_password;
mod rate_limit_config;
mod service;

use utoipa::OpenApi;

fn main() {
    println!(
        "{}",
        api::swagger::ApiDoc::openapi().to_pretty_json().unwrap()
    );
}
