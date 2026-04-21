#![allow(unused)]

use scheduled_action::swagger::ApiDoc;
use utoipa::OpenApi;

fn main() {
    println!("{}", ApiDoc::openapi().to_pretty_json().unwrap());
}
