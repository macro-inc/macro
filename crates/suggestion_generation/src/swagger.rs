//! The generation route's OpenAPI, merged into the scheduler's spec that
//! serves it.

use utoipa::OpenApi;

/// The generation route's OpenAPI.
#[derive(OpenApi)]
#[openapi(
    paths(crate::inbound::router::start_generation, crate::inbound::router::seen),
    components(schemas(crate::domain::model::GenerationStarted)),
    tags((name = "suggestions", description = "Generations of each person's suggestions and routine suggestions")),
)]
pub struct GenerationApiDoc;
