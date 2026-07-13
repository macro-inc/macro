use axum::{Router, routing::get};

/// Health check
#[utoipa::path(
        get,
        path = "/health",
        responses(
            (status = 200, description = "health", body = String),
        )
    )]
pub async fn health_handler() -> String {
    "healthy".to_string()
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
    use http_body_util::BodyExt; // for `collect`
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
        let body = String::from_utf8(
            response
                .into_body()
                .collect()
                .await
                .unwrap()
                .to_bytes()
                .to_vec(),
        )
        .unwrap();
        assert_eq!(body, "healthy");
    }
}
