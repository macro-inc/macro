use utoipa::OpenApi;

use super::GetContactsResponse;

#[derive(OpenApi)]
#[openapi(
        info(
            terms_of_service = "https://macro.com/terms",
        ),
        paths(
            super::handler,
        ),
        components(
            schemas(
                GetContactsResponse
            ),
        ),
        tags(
            (name = "macro contacts service", description = "Contacts Service")
        )
    )]
pub struct ApiDoc;
