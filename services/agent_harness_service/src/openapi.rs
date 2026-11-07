#![allow(unused)]

mod api;
mod computer_screen;
mod config;
mod voice_gateway;

use utoipa::OpenApi;

fn main() {
    println!(
        "{}",
        api::swagger::ApiDoc::openapi().to_pretty_json().unwrap()
    );
}
