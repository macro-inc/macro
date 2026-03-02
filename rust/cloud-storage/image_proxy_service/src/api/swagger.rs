use model::response::{EmptyResponse, ErrorResponse};
use utoipa::OpenApi;

use super::health;
use super::proxy::{self, ProxyParams};

#[derive(OpenApi)]
#[openapi(
    info(
        terms_of_service = "https://macro.com/terms",
    ),
    paths(
        health::health_handler,
        proxy::proxy_request_handler,
    ),
    components(
        schemas(
            EmptyResponse,
            ErrorResponse,
            ProxyParams,
        ),
    ),
    tags(
        (name = "macro image proxy service", description = "Image Proxy Service")
    )
)]
pub struct ApiDoc;
