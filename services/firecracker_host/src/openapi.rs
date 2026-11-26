//! `firecracker_host_openapi`: print the agent's OpenAPI document.

use firecracker_host::inbound::swagger::ApiDoc;
use utoipa::OpenApi;

fn main() -> Result<(), serde_json::Error> {
    println!("{}", ApiDoc::openapi().to_pretty_json()?);
    Ok(())
}
