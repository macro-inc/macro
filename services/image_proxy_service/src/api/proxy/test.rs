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

#[test]
fn svg_is_refused_as_unsupported_media() {
    let response = ProxyError::Fetch(FetchError::MediaTypeNotAllowed {
        media_type: MediaType::from_content_type("image/svg+xml"),
    })
    .into_response();

    assert_eq!(response.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
}
