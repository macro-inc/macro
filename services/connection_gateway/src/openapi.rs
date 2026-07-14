#![allow(unused)]

mod api;
mod config;
mod constants;
mod context;
mod model;
mod service;

use utoipa::OpenApi;

fn main() {
    println!(
        "{}",
        api::swagger::ApiDoc::openapi().to_pretty_json().unwrap()
    );
}
