#![allow(unused)]

mod api;
mod config;
/// Only the route modules the API document names, not the control plane.
mod computers {
    pub(crate) mod claude;
    pub(crate) mod harnessd;
}

use utoipa::OpenApi;

fn main() {
    println!(
        "{}",
        api::swagger::ApiDoc::openapi().to_pretty_json().unwrap()
    );
}
