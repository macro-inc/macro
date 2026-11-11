#![allow(unused)]

mod api;
mod config;
mod voice_gateway;
/// Only the route modules the API document names, not the control plane.
mod computers {
    pub(crate) mod claude;
    pub(crate) mod control;
}

use utoipa::OpenApi;

fn main() {
    println!(
        "{}",
        api::swagger::ApiDoc::openapi().to_pretty_json().unwrap()
    );
}
