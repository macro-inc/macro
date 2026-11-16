//! Export the standalone appearance contract for frontend schema generation.
use model_entity::{AppearanceColor, AppearanceIcon, EntityAppearance};
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(components(schemas(EntityAppearance, AppearanceIcon, AppearanceColor)))]
struct AppearanceApi;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("{}", AppearanceApi::openapi().to_pretty_json()?);
    Ok(())
}
