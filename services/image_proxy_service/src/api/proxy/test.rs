use tower::ServiceExt;

use super::*;

#[test]
fn ua_rejection_symptoms_are_retried_without_a_user_agent() {
    let forbidden = ProxyError::Fetch(FetchError::Status {
        status: StatusCode::FORBIDDEN,
    });
    let challenge_page = ProxyError::Fetch(FetchError::MediaTypeNotAllowed {
        media_type: MediaType::from_content_type("text/html"),
    });
    let refused = ProxyError::Fetch(FetchError::AddressNotAllowed {
        address: "127.0.0.1".parse().unwrap(),
    });

    assert!(forbidden.is_retryable_without_ua());
    assert!(challenge_page.is_retryable_without_ua());
    assert!(!refused.is_retryable_without_ua());
    assert!(!ProxyError::Fetch(FetchError::TotalTimeout).is_retryable_without_ua());
}

fn is_allowed_content_type(content_type: &str) -> bool {
    MediaType::from_content_type(content_type).is_some_and(|media_type| {
        AcceptedMediaTypes::only(ALLOWED_MEDIA_TYPES).accepts(&media_type)
    })
}

fn text_html_refused() -> ProxyError {
    ProxyError::Fetch(FetchError::MediaTypeNotAllowed {
        media_type: MediaType::from_content_type("text/html"),
    })
}

#[test]
fn test_allows_image_content_types() {
    assert!(is_allowed_content_type("image/png"));
    assert!(is_allowed_content_type("image/jpeg; charset=utf-8"));
}

#[test]
fn test_allows_octet_stream_content_type() {
    assert!(is_allowed_content_type("application/octet-stream"));
    assert!(is_allowed_content_type(
        "application/octet-stream; charset=binary"
    ));
    assert!(is_allowed_content_type("APPLICATION/OCTET-STREAM"));
}

#[test]
fn test_allows_image_content_types_and_aliases() {
    for content_type in [
        "image/x-png",
        "image/x-ms-bmp",
        "image/jpg",
        "image/pjpeg",
        "image/apng",
        "image/gif",
        "image/webp",
        "image/avif",
        "image/bmp",
        "image/tiff",
        "image/heic",
        "image/heif",
        "image/jxl",
        "image/x-icon",
        "image/vnd.microsoft.icon",
        "image/svg+xml",
        "image/svg+xml; charset=utf-8",
        "IMAGE/PNG",
    ] {
        assert!(is_allowed_content_type(content_type), "{content_type}");
    }
}

#[test]
fn test_rejects_non_image_content_types() {
    for content_type in [
        "text/html",
        "text/html; charset=utf-8",
        "application/json",
        "application/xhtml+xml",
        "text/xml",
        "image/x-xbitmap",
        "image/",
    ] {
        assert!(!is_allowed_content_type(content_type), "{content_type}");
    }
}

#[test]
fn test_unsupported_media_type_is_415() {
    let response = text_html_refused().into_response();
    assert_eq!(response.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
}

const SVG_WITH_SCRIPT: &str =
    r#"<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.domain)</script></svg>"#;

async fn send_through_sandbox(response: fn() -> Response) -> Response {
    let router: Router =
        with_sandbox_headers(Router::new().route("/", get(move || async move { response() })));
    router
        .oneshot(axum::http::Request::get("/").body(Body::empty()).unwrap())
        .await
        .unwrap()
}

fn assert_sandboxed(response: &Response) {
    let headers = response.headers();
    assert_eq!(headers["x-content-type-options"], "nosniff");
    assert_eq!(
        headers["content-security-policy"],
        "default-src 'none'; style-src 'unsafe-inline'; sandbox"
    );
}

#[tokio::test]
async fn test_svg_with_script_is_sandboxed_attachment() {
    let response = send_through_sandbox(|| {
        image_response("image/svg+xml", Body::from(SVG_WITH_SCRIPT)).unwrap()
    })
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    assert_sandboxed(&response);
    let headers = response.headers();
    assert_eq!(headers["content-type"], "image/svg+xml");
    assert_eq!(headers["content-disposition"], "attachment");
    assert!(
        headers["content-security-policy"]
            .to_str()
            .unwrap()
            .split(';')
            .any(|directive| directive.trim() == "sandbox")
    );
}

#[tokio::test]
async fn test_raster_response_is_sandboxed_inline() {
    let response =
        send_through_sandbox(|| image_response("image/png", Body::empty()).unwrap()).await;

    assert_sandboxed(&response);
    assert_eq!(response.headers()["content-type"], "image/png");
    assert!(response.headers().get("content-disposition").is_none());
}

#[tokio::test]
async fn test_error_response_is_sandboxed() {
    let response = send_through_sandbox(|| text_html_refused().into_response()).await;

    assert_eq!(response.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
    assert_sandboxed(&response);
}

#[test]
fn upstream_refusals_are_not_found_and_server_errors_bad_gateway() {
    for status in [
        StatusCode::FORBIDDEN,
        StatusCode::NOT_FOUND,
        StatusCode::TOO_MANY_REQUESTS,
    ] {
        let response = ProxyError::Fetch(FetchError::Status { status }).into_response();
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{status}");
    }

    let response = ProxyError::Fetch(FetchError::Status {
        status: StatusCode::INTERNAL_SERVER_ERROR,
    })
    .into_response();
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
}

// These expectations come from the deployed generic proxy contract: callers
// match on the status, body and content type of each refusal.
#[tokio::test]
async fn proxy_error_contract_preserves_status_body_and_content_type() {
    use http_body_util::BodyExt;

    for (error, status, body) in [
        (
            FetchError::SchemeNotAllowed {
                scheme: "ftp".into(),
            },
            StatusCode::BAD_REQUEST,
            "only http/https URLs are allowed",
        ),
        (
            FetchError::AddressNotAllowed {
                address: "127.0.0.1".parse().unwrap(),
            },
            StatusCode::FORBIDDEN,
            "requests to private/internal IPs are not allowed",
        ),
        (
            FetchError::TotalTimeout,
            StatusCode::GATEWAY_TIMEOUT,
            "timeout fetching upstream image: fetch exceeded its total timeout",
        ),
        (
            FetchError::Status {
                status: StatusCode::FORBIDDEN,
            },
            StatusCode::NOT_FOUND,
            "upstream returned status 403 Forbidden",
        ),
        (
            FetchError::Status {
                status: StatusCode::INTERNAL_SERVER_ERROR,
            },
            StatusCode::BAD_GATEWAY,
            "upstream returned status 500 Internal Server Error",
        ),
        (
            FetchError::MediaTypeNotAllowed {
                media_type: MediaType::from_content_type("text/html"),
            },
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "upstream content-type is not a supported image: text/html",
        ),
        (
            FetchError::BodyTooLarge {
                limit: MAX_IMAGE_SIZE,
            },
            StatusCode::UNPROCESSABLE_ENTITY,
            "image exceeds max size of 10485760 bytes",
        ),
        (
            FetchError::CredentialsInUrl,
            StatusCode::BAD_REQUEST,
            "URLs with credentials are not allowed",
        ),
    ] {
        let response = ProxyError::Fetch(error).into_response();
        assert_eq!(response.status(), status, "{body}");
        assert_eq!(
            response.headers()["content-type"],
            "text/plain; charset=utf-8"
        );
        assert!(!response.headers().contains_key("cache-control"));
        assert_eq!(
            response.into_body().collect().await.unwrap().to_bytes(),
            body
        );
    }
}
