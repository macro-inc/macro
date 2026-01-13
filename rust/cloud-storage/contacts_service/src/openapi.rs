#![allow(unused)]

mod api;
mod config;
mod graph;
mod queue;
mod user;

use utoipa::OpenApi;

fn main() {
    println!(
        "{}",
        api::swagger::ApiDoc::openapi().to_pretty_json().unwrap()
    );
}
