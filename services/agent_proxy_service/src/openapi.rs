//! Prints the agent proxy service's OpenAPI document as JSON.

use agent_proxy::swagger::ApiDoc;
use utoipa::OpenApi;

fn main() {
    println!("{}", ApiDoc::openapi().to_pretty_json().unwrap());
}
