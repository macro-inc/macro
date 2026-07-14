use utoipa::{
    Modify, OpenApi,
    openapi::security::{ApiKey, ApiKeyValue, SecurityScheme},
};

use crate::api::{backfill, convert, health};
use model::{
    convert::ConvertRequest,
    response::{EmptyResponse, ErrorResponse},
};

struct SecurityAddon;

impl Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        if let Some(components) = openapi.components.as_mut() {
            components.add_security_scheme(
                "internal-api-key",
                SecurityScheme::ApiKey(ApiKey::Header(ApiKeyValue::new("x-internal-auth-key"))),
            )
        }
    }
}

#[derive(OpenApi)]
#[openapi(
        modifiers(&SecurityAddon),
        info(
                terms_of_service = "https://macro.com/terms",
        ),
        paths(
                /// /health
                health::health_handler,

                convert::handler,
                backfill::backfill_docx::handler,
        ),
        components(
            schemas(
                        EmptyResponse,
                        ErrorResponse,
                        ConvertRequest,
            ),
        ),
        security(
            ("internal" = [])
        ),
        tags(
            (name = "convert service", description = "Macro Convert Service")
        )
    )]
pub struct ApiDoc;
