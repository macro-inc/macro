use axum::{Json, Router, http::StatusCode, response::IntoResponse, routing::get};
use model::response::EmptyResponse;

/// Health check
#[utoipa::path(
        get,
        tag = "Health",
        path = "/health",
        responses(
            (status = 200, description = "Health", body = EmptyResponse),
        )
    )]
pub async fn health_handler() -> impl IntoResponse {
    (StatusCode::OK, Json(EmptyResponse::default()))
}

pub fn router() -> Router {
    Router::new().route("/health", get(health_handler))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    #[allow(unused_imports)]
    use http_body_util::BodyExt;
    // for `collect`
    use tower::ServiceExt;

    #[tokio::test]
    async fn test_health_check() {
        let api = router();

        let response = api
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .method("GET")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }
}
