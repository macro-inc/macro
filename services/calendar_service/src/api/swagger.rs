use utoipa::OpenApi;

/// OpenAPI document for the calendar service.
#[derive(OpenApi)]
#[openapi(paths(crate::health::health_handler))]
pub struct ApiDoc;
