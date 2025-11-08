use axum::extract::Json;
use axum::extract::Query;
use axum::http::StatusCode;

use crate::unfurl::{
    GetUnfurlResponse, GetUnfurlResponseList, append_optimistic_favico, extract_meta_tags,
    fetch_links_async,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Serialize, Deserialize, ToSchema, Default)]
pub struct GetUnfurlBulkResponse {
    pub responses: GetUnfurlResponseList,
}

#[derive(Debug, Serialize, Deserialize, ToSchema, Default)]
pub struct GetUnfurlBulkBody {
    pub url_list: Vec<String>,
}

#[derive(Deserialize, ToSchema, Debug)]
pub struct GetUnfurlQueryParams {
    url: String,
}

#[utoipa::path(get,
    tag = "unfurl",
    operation_id = "get_unfurl",
    path = "/unfurl", responses(
    (status = 200, body=GetUnfurlResponse),
    (status = 401, body=String),
    (status = 404, body=String),
    (status = 500, body=String)),
    params(
        ("url"=String, Query, description="URL to unfold"),
    )
)]
#[tracing::instrument]
pub async fn get_unfurl_handler(
    Query(params): Query<GetUnfurlQueryParams>,
) -> (StatusCode, Json<Option<GetUnfurlResponse>>) {
    let tags = match extract_meta_tags(&params.url).await {
        Ok(t) => append_optimistic_favico(t, params.url.as_str()),
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(None)),
    };

    let response = GetUnfurlResponse::new(&params.url, &tags);
    (StatusCode::OK, Json(Some(response)))
}

#[utoipa::path(post,
    tag = "unfurl",
    operation_id = "get_unfurl_bulk",
    path = "/unfurl/bulk", responses(
    (status = 200, body=GetUnfurlBulkResponse),
    (status = 401, body=String),
    (status = 404, body=String),
    (status = 500, body=String)),
    request_body(content = GetUnfurlBulkBody,
        description = "JSON list of URLs",
        content_type="application/json",
        // TODO: update
        //example=json!(["https://macro.com", "https://github.com"])
    ))]
#[tracing::instrument]
pub async fn get_bulk_unfurl_handler(
    body: Json<GetUnfurlBulkBody>,
) -> (StatusCode, Json<GetUnfurlBulkResponse>) {
    let links = fetch_links_async(&body.url_list).await;
    let response = GetUnfurlBulkResponse { responses: links };
    (StatusCode::OK, Json(response))
}
