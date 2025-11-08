use utoipa::OpenApi;

use super::proxy::{self, ProxyParams};
use super::unfurl::get_unfurl::{
    self, GetUnfurlBulkBody, GetUnfurlBulkResponse, GetUnfurlQueryParams,
};
use crate::unfurl::GetUnfurlResponse;

#[derive(OpenApi)]
#[openapi(
        info(
            terms_of_service = "https://macro.com/terms",
        ),
        paths(
            get_unfurl::get_unfurl_handler,
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
