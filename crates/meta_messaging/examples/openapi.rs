//! Export provider-specific API contracts for the frontend generator.
use utoipa::OpenApi;
fn main() {
    println!(
        "{}",
        meta_messaging::inbound::router::MessagingApiDoc::openapi()
            .to_pretty_json()
            .expect("OpenAPI serialization")
    );
}
