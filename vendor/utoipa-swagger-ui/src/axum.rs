#![cfg(feature = "axum")]

use std::sync::Arc;

use axum::{
    body::Body,
    extract::Path,
    http::{HeaderMap, Request, Response, StatusCode},
    middleware::{self, Next},
    response::IntoResponse,
    routing, Extension, Json, Router,
};
use base64::{prelude::BASE64_STANDARD, Engine};

use crate::{ApiDoc, BasicAuth, Config, SwaggerUi, Url};

impl<S> From<SwaggerUi> for Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    fn from(swagger_ui: SwaggerUi) -> Self {
        let urls_capacity = swagger_ui.urls.len();
        let external_urls_capacity = swagger_ui.external_urls.len();

        let (router, urls) = swagger_ui.urls.into_iter().fold(
            (
                Router::<S>::new(),
                Vec::<Url>::with_capacity(urls_capacity + external_urls_capacity),
            ),
            |router_and_urls, (url, openapi)| {
                add_api_doc_to_urls(router_and_urls, (url, Arc::new(ApiDoc::Utoipa(openapi))))
            },
        );
        let (router, urls) = swagger_ui.external_urls.into_iter().fold(
            (router, urls),
            |router_and_urls, (url, openapi)| {
                add_api_doc_to_urls(router_and_urls, (url, Arc::new(ApiDoc::Value(openapi))))
            },
        );

        let config = if let Some(config) = swagger_ui.config {
            if config.url.is_some() || !config.urls.is_empty() {
                config
            } else {
                config.configure_defaults(urls)
            }
        } else {
            Config::new(urls)
        };

        let handler = routing::get(serve_swagger_ui).layer(Extension(Arc::new(config.clone())));
        let path: &str = swagger_ui.path.as_ref();

        let mut router = if path == "/" {
            router
                .route(path, handler.clone())
                .route(&format!("{}{{*rest}}", path), handler)
        } else {
            let path = if path.ends_with('/') {
                &path[..path.len() - 1]
            } else {
                path
            };
            debug_assert!(!path.is_empty());

            let slash_path = format!("{}/", path);
            router
                .route(
                    path,
                    routing::get(|| async move { axum::response::Redirect::to(&slash_path) }),
                )
                .route(&format!("{}/", path), handler.clone())
                .route(&format!("{}/{{*rest}}", path), handler)
        };

        if let Some(BasicAuth { username, password }) = config.basic_auth {
            let username = Arc::new(username);
            let password = Arc::new(password);
            let basic_auth_middleware =
                move |headers: HeaderMap, req: Request<Body>, next: Next| {
                    let username = username.clone();
                    let password = password.clone();
                    async move {
                        if let Some(header) = headers.get("Authorization") {
                            if let Ok(header_str) = header.to_str() {
                                let base64_encoded_credentials =
                                    BASE64_STANDARD.encode(format!("{}:{}", &username, &password));
                                if header_str == format!("Basic {}", base64_encoded_credentials) {
                                    return Ok::<Response<Body>, StatusCode>(next.run(req).await);
                                }
                            }
                        }
                        Ok::<Response<Body>, StatusCode>(
                            (
                                StatusCode::UNAUTHORIZED,
                                [("WWW-Authenticate", "Basic realm=\":\"")],
                            )
                                .into_response(),
                        )
                    }
                };
            router = router.layer(middleware::from_fn(basic_auth_middleware));
        }

        router
    }
}

fn add_api_doc_to_urls<S>(
    router_and_urls: (Router<S>, Vec<Url<'static>>),
    url: (Url<'static>, Arc<ApiDoc>),
) -> (Router<S>, Vec<Url<'static>>)
where
    S: Clone + Send + Sync + 'static,
{
    let (router, mut urls) = router_and_urls;
    let (url, openapi) = url;
    (
        router.route(
            url.url.as_ref(),
            routing::get(move || async { Json(openapi) }),
        ),
        {
            urls.push(url);
            urls
        },
    )
}

async fn serve_swagger_ui(
    path: Option<Path<String>>,
    Extension(state): Extension<Arc<Config<'static>>>,
) -> impl IntoResponse {
    let tail = match path.as_ref() {
        Some(tail) => tail,
        None => "",
    };

    match super::serve(tail, state) {
        Ok(file) => file
            .map(|file| {
                (
                    StatusCode::OK,
                    [("Content-Type", file.content_type)],
                    file.bytes,
                )
                    .into_response()
            })
            .unwrap_or_else(|| StatusCode::NOT_FOUND.into_response()),
        Err(error) => (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use http::header::AUTHORIZATION;
    use http::HeaderValue;
    use tower::util::ServiceExt;

    #[tokio::test]
    async fn mount_onto_root() {
        let app = Router::<()>::from(SwaggerUi::new("/"));
        let response = app.clone().oneshot(get("/")).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let response = app.clone().oneshot(get("/swagger-ui.css")).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn mount_onto_path_ends_with_slash() {
        let app = Router::<()>::from(SwaggerUi::new("/swagger-ui/"));
        let response = app.clone().oneshot(get("/swagger-ui")).await.unwrap();
        assert_eq!(response.status(), StatusCode::SEE_OTHER);
        let response = app.clone().oneshot(get("/swagger-ui/")).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let request = get("/swagger-ui/swagger-ui.css");
        let response = app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn mount_onto_path_not_end_with_slash() {
        let app = Router::<()>::from(SwaggerUi::new("/swagger-ui"));
        let response = app.clone().oneshot(get("/swagger-ui")).await.unwrap();
        assert_eq!(response.status(), StatusCode::SEE_OTHER);
        let response = app.clone().oneshot(get("/swagger-ui/")).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let request = get("/swagger-ui/swagger-ui.css");
        let response = app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn basic_auth() {
        let swagger_ui =
            SwaggerUi::new("/swagger-ui").config(Config::default().basic_auth(BasicAuth {
                username: "admin".to_string(),
                password: "password".to_string(),
            }));
        let app = Router::<()>::from(swagger_ui);
        let response = app.clone().oneshot(get("/swagger-ui")).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        let encoded_credentials = BASE64_STANDARD.encode("admin:password");
        let authorization = format!("Basic {}", encoded_credentials);
        let request = authorized_get("/swagger-ui", &authorization);
        let response = app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::SEE_OTHER);
        let request = authorized_get("/swagger-ui/", &authorization);
        let response = app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let request = authorized_get("/swagger-ui/swagger-ui.css", &authorization);
        let response = app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    fn get(url: &str) -> Request<Body> {
        Request::builder().uri(url).body(Body::empty()).unwrap()
    }

    fn authorized_get(url: &str, authorization: &str) -> Request<Body> {
        Request::builder()
            .uri(url)
            .header(AUTHORIZATION, HeaderValue::from_str(authorization).unwrap())
            .body(Body::empty())
            .unwrap()
    }
}
