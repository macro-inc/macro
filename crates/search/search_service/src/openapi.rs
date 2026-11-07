#![allow(unused)]

use search_service::SearchApiDoc;
use utoipa::OpenApi;

fn main() {
    println!("{}", SearchApiDoc::openapi().to_pretty_json().unwrap());
}
