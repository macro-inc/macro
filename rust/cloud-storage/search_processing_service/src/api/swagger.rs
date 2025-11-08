use utoipa::OpenApi;

use crate::api::health;
use model::response::EmptyResponse;

#[derive(OpenApi)]
#[openapi(
        info(
                terms_of_service = "https://macro.com/terms",
        ),
        paths(
                /// /health
                health::health_handler,
        ),
        components(
            schemas(
                        EmptyResponse,
                ),
        ),
        tags(
            (name = "search processing service", description = "Macro Search Processing Service")
        )
    )]
pub struct ApiDoc;
