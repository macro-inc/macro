use agent_harness_service::cognition::ApiDoc;
use utoipa::OpenApi;

fn main() {
    println!("{}", ApiDoc::openapi().to_pretty_json().unwrap());
}
