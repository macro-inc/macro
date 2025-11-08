use crate::config::Config;
use anyhow::Context;
use axum::Router;
use tower::ServiceBuilder;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

pub mod context;
mod health;
mod proxy;
mod swagger;
mod unfurl;

pub async fn setup_and_serve(config: &Config) -> anyhow::Result<()> {
    let cors = macro_cors::cors_layer();

    let app = api_router()
        .layer(cors.clone())
        .merge(health::router().layer(cors))
        .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", swagger::ApiDoc::openapi()));

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", config.port))
        .await
        .unwrap();

    tracing::info!(
        "\n📜 unfurl_service 📜\nenvironment {:?}\nport: {}",
        &config.environment,
        &config.port
    );

    axum::serve(listener, app.into_make_service())
        .await
        .context("error starting service")
}

fn api_router() -> Router {
    Router::new()
        .nest("/unfurl", unfurl::router().layer(ServiceBuilder::new()))
        .nest("/proxy", proxy::router().layer(ServiceBuilder::new()))
}

#[cfg(test)]
mod tests {
    use crate::api::unfurl::get_unfurl::{GetUnfurlBulkBody, GetUnfurlBulkResponse};

    use super::*;
    use crate::unfurl::{GetUnfurlResponse, GetUnfurlResponseList};
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use http_body_util::BodyExt; // for `collect`
    use tower::ServiceExt;

    #[tokio::test]
    async fn test_not_found() {
        let api = api_router();

        let response = api
            .oneshot(
                Request::builder()
                    .uri("/does-not-exist")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        assert!(body.is_empty());
    }

    #[tokio::test]
    async fn test_unfurl_url_nonexistent() {
        let api = api_router();

        let response = api
            .oneshot(
                Request::builder()
                    .uri("/unfurl?url=https://doesnotexist.com")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);

        let body = response.into_body();
        let bytes = axum::body::to_bytes(body, 2048).await.unwrap();
        let body_str = String::from_utf8(bytes.to_vec()).unwrap();

        let unfurled_link: Option<GetUnfurlResponse> = serde_json::from_str(&body_str).unwrap();
        assert!(
            unfurled_link.is_none(),
            "non-existent link should return an empty response"
        );
    }

    #[ignore]
    #[tokio::test]
    async fn test_unfurl_hello_url() {
        let api = api_router();

        let response = api
            .oneshot(
                Request::builder()
                    .uri("/unfurl?url=https://hello.com")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let body = response.into_body();
        let bytes = axum::body::to_bytes(body, 2048).await.unwrap();
        let body_str = String::from_utf8(bytes.to_vec()).unwrap();

        let unfurled_link: Option<GetUnfurlResponse> = serde_json::from_str(&body_str).unwrap();
        let unfurled_link = unfurled_link.unwrap();

        assert_eq!(&unfurled_link.title, "Hello");
        assert_eq!(
            &unfurled_link.description.unwrap(),
            "This is a description."
        );
        assert_eq!(&unfurled_link.url, "https://hello.com");
    }

    #[ignore]
    #[tokio::test]
    async fn test_bulk() {
        let api = api_router();

        let body = GetUnfurlBulkBody {
            url_list: ["https://hello.com", "https://example.com"]
                .iter()
                .map(|s| s.to_string())
                .collect(),
        };

        let body: Body = serde_json::to_string(&body).unwrap().into();

        let req = Request::builder()
            .method(http::Method::POST)
            .uri("/unfurl/bulk")
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(body)
            .unwrap();
        let response = api.oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let body = response.into_body();
        let bytes = axum::body::to_bytes(body, 8192).await.unwrap();
        let body_str = String::from_utf8(bytes.to_vec()).unwrap();

        let resp: GetUnfurlBulkResponse = serde_json::from_str(&body_str).unwrap();
        let unfurled_links: GetUnfurlResponseList = resp.responses;

        assert_eq!(&unfurled_links[0].as_ref().unwrap().title, "Hello");
        assert_eq!(
            &unfurled_links[1].as_ref().unwrap().title,
            "Example Website"
        );
    }

    // Make sure 404 fetched links return expected outputs in bulk list
    #[ignore]
    #[tokio::test]
    async fn test_bulk_404_links() {
        let api = api_router();

        let body = GetUnfurlBulkBody {
            url_list: [
                "https://hello.com",
                "https://example.com",
                // does not exist with mock fetcher
                "https://nonexistent.com",
            ]
            .iter()
            .map(|s| s.to_string())
            .collect(),
        };

        let body: Body = serde_json::to_string(&body).unwrap().into();

        let response = api
            .oneshot(
                Request::builder()
                    .method(http::Method::POST)
                    .header(http::header::CONTENT_TYPE, "application/json")
                    .uri("/unfurl/bulk")
                    .body(body)
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let body = response.into_body();
        let bytes = axum::body::to_bytes(body, 8192).await.unwrap();
        let body_str = String::from_utf8(bytes.to_vec()).unwrap();
        let resp: GetUnfurlBulkResponse = serde_json::from_str(&body_str).unwrap();
        let unfurled_links: GetUnfurlResponseList = resp.responses;

        assert_eq!(&unfurled_links[0].as_ref().unwrap().title, "Hello");
        assert_eq!(
            &unfurled_links[1].as_ref().unwrap().title,
            "Example Website"
        );

        // 404s with mock fetch, should be None
        assert!(&unfurled_links[2].as_ref().is_none());
    }
}
