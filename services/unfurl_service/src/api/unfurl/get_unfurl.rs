use axum::extract::Json;
use axum::extract::State;
use axum::http::StatusCode;

use crate::unfurl::GetUnfurlResponseList;
use crate::unfurl::fetch_links_async;
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
    ))]
#[tracing::instrument(skip(http_client, body))]
pub async fn get_bulk_unfurl_handler(
    State(http_client): State<reqwest::Client>,
    body: Json<GetUnfurlBulkBody>,
) -> (StatusCode, Json<GetUnfurlBulkResponse>) {
    let links = fetch_links_async(&http_client, &body.url_list).await;
    let response = GetUnfurlBulkResponse { responses: links };
    (StatusCode::OK, Json(response))
}
