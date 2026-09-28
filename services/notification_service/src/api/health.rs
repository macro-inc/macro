use axum::{Json, Router, response::IntoResponse, routing::get};
use model::response::EmptyResponse;

/// Health check
#[utoipa::path(
        get,
        path = "/health",
        responses(
            (status = 200, description = "health", body = EmptyResponse),
        )
    )]
pub async fn health_handler() -> impl IntoResponse {
    Json(EmptyResponse::default())
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
    use http_body_util::BodyExt; // for `collect`
    use tower::ServiceExt;

    fn dual_mounted_health() -> Router {
        let health = router();
        Router::new()
            .merge(health.clone())
            .nest("/notification", health)
    }

    #[tokio::test]
    async fn test_health_check() {
        let api = dual_mounted_health();

        for uri in ["/health", "/notification/health"] {
            let response = api
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(uri)
                        .method("GET")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();

            assert_eq!(
                response.status(),
                StatusCode::OK,
                "health at {uri} should be 200"
            );
        }
    }
}
