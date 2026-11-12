#![allow(unused)]

mod api;
mod config;
mod domain;
mod outbound;

use utoipa::OpenApi;

fn main() {
    println!(
        "{}",
        api::swagger::ApiDoc::openapi().to_pretty_json().unwrap()
    );
}
