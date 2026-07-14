use ::unfurl::domain::models::GetUnfurlResponse;
use ::unfurl::inbound::axum_router::{self, GetUnfurlQueryParams};
use utoipa::OpenApi;

use super::proxy::{self, ProxyParams};
use super::unfurl::get_unfurl::{self, GetUnfurlBulkBody, GetUnfurlBulkResponse};

#[derive(OpenApi)]
#[openapi(
        info(
            terms_of_service = "https://macro.com/terms",
        ),
        paths(
            axum_router::get_unfurl_handler,
            get_unfurl::get_bulk_unfurl_handler,
            proxy::proxy_request_handler,
        ),
        components(
            schemas(
                GetUnfurlResponse,
                GetUnfurlQueryParams,
                GetUnfurlBulkResponse,
                GetUnfurlBulkBody,
                ProxyParams,
            ),
        ),
        tags(
            (name = "macro unfurl service", description = "Unfurl Service")
        )
    )]
pub struct ApiDoc;
