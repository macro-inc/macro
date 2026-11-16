//! The generation routes' OpenAPI, merged into the scheduler's spec that
//! serves them.

use utoipa::OpenApi;

/// The generation routes' OpenAPI.
#[derive(OpenApi)]
#[openapi(
    paths(
        crate::inbound::router::start_generation,
        crate::inbound::router::seen,
        crate::inbound::router::overview,
        crate::inbound::router::regenerate,
    ),
    components(schemas(
        crate::domain::model::GenerationStarted,
        crate::domain::model::RegenerationRunning,
        crate::domain::model::RegenerationRefusal,
        crate::domain::model::RegenerationCooldown,
        crate::domain::generation::GenerationOverview,
        crate::domain::generation::GenerationState,
        crate::domain::generation::GenerationStatus,
        suggestions::domain::model::GenerationTrigger,
    )),
    tags((name = "suggestions", description = "Generations of each person's suggestions and routine suggestions")),
)]
pub struct GenerationApiDoc;
