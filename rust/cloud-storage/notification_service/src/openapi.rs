#![allow(unused)]

mod api;
mod config;
mod env;
mod model;
mod notification;
mod templates;

use utoipa::OpenApi;

fn main() {
    println!(
        "{}",
        api::swagger::ApiDoc::openapi().to_pretty_json().unwrap()
    );
}
