#![allow(unused)]

mod api;
mod config;
mod constants;
mod notification;
mod service;
mod utils;

use utoipa::OpenApi;

fn main() {
    println!(
        "{}",
        api::swagger::ApiDoc::openapi().to_pretty_json().unwrap()
    );
}
