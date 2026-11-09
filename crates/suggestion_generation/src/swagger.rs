//! The generation route's OpenAPI, merged into the scheduler's spec that
//! serves it.

use utoipa::OpenApi;

/// The generation route's OpenAPI.
#[derive(OpenApi)]
#[openapi(
    paths(crate::inbound::router::start_generation),
    components(schemas(crate::domain::model::GenerationStarted)),
    tags((name = "suggestions", description = "Generations of each person's ideas and routine suggestions")),
)]
pub struct GenerationApiDoc;
