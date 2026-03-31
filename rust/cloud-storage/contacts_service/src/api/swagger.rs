use utoipa::OpenApi;

use super::{AddContactRequest, GetContactsResponse};

#[derive(OpenApi)]
#[openapi(
        info(
            terms_of_service = "https://macro.com/terms",
        ),
        paths(
            super::handler,
            super::add_contact_handler,
        ),
        components(
            schemas(
                GetContactsResponse,
                AddContactRequest,
            ),
        ),
        tags(
            (name = "macro contacts service", description = "Contacts Service")
        )
    )]
pub struct ApiDoc;
