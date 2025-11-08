use axum::{
    body::Body,
    extract::{FromRequest, Request},
};
use cool_asserts::assert_matches;

use super::*;

#[tokio::test]
async fn it_works_with_no_params() {
    let request = Request::builder()
        .uri("https://example.com")
        .body(Body::from(()))
        .unwrap();

    let extracted = Query::<LoginQueryParams>::from_request(request, &())
        .await
        .expect("it should extract");

    assert_matches!(
        extracted,
        Query(LoginQueryParams {
            idp_name: None,
            idp_id: None,
            login_hint: None,
            original_url: None,
            is_mobile: false
        })
    );
}

#[tokio::test]
async fn it_works_with_mobile() {
    let request = Request::builder()
        .uri("https://example.com?is_mobile=true")
        .body(Body::from(()))
        .unwrap();

    let extracted = Query::<LoginQueryParams>::from_request(request, &())
        .await
        .expect("it should extract");

    assert_matches!(
        extracted,
        Query(LoginQueryParams {
            idp_name: None,
            idp_id: None,
            login_hint: None,
            original_url: None,
            is_mobile: true
        })
    );
}

#[tokio::test]
async fn it_works_with_mobile_false() {
    let request = Request::builder()
        .uri("https://example.com?is_mobile=false")
        .body(Body::from(()))
        .unwrap();

    let extracted = Query::<LoginQueryParams>::from_request(request, &())
        .await
        .expect("it should extract");

    assert_matches!(
        extracted,
        Query(LoginQueryParams {
            idp_name: None,
            idp_id: None,
            login_hint: None,
            original_url: None,
            is_mobile: false
        })
    );
}

#[tokio::test]
async fn it_fails_with_mobile_garbage() {
    let request = Request::builder()
        .uri("https://example.com?is_mobile=garbage")
        .body(Body::from(()))
        .unwrap();
    let _rejection = Query::<LoginQueryParams>::from_request(request, &())
        .await
        .unwrap_err();
}

#[tokio::test]
async fn it_works_with_everything() {
    let request = Request::builder().uri("https://example.com?is_mobile=true&idp_name=testing&idp_id=something&login_hint=myhint&original_url=https%3A%2F%2Fexample.com").body(Body::from(())).unwrap();

    let extracted = Query::<LoginQueryParams>::from_request(request, &())
        .await
        .expect("it should extract");

    assert_matches!(extracted, Query(LoginQueryParams {
       idp_name: Some(idp_name),
       idp_id: Some(idp_id),
       login_hint: Some(login_hint),
       original_url: Some(original_url),
       is_mobile: true
    }) => {
        assert_eq!(idp_name, "testing");
        assert_eq!(idp_id, "something");
        assert_eq!(login_hint, "myhint");
        assert_eq!(original_url.0.as_str(), "https://example.com/");
    });
}

#[tokio::test]
async fn it_works_with_macro_scheme() {
    let request = Request::builder().uri("https://example.com/login/sso?original_url=macro%3A%2F%2Fapp%2Flogin&idp_name=google&is_mobile=true").body(Body::from(())).unwrap();

    let extracted = Query::<LoginQueryParams>::from_request(request, &())
        .await
        .expect("it should extract");

    assert_matches!(extracted, Query(LoginQueryParams {
       idp_name: Some(idp_name),
       idp_id: None,
       login_hint: None,
       original_url: Some(original_url),
       is_mobile: true
    }) => {
        assert_eq!(idp_name, "google");
        assert_eq!(original_url.0.as_str(), "macro://app/login");
    });
}

#[tokio::test]
async fn it_works_with_double_encoded_scheme() {
    let request = Request::builder().uri("https://example.com/login/sso?original_url=https%253A%252F%252Fexample.com&idp_name=google&is_mobile=true").body(Body::from(())).unwrap();

    let extracted = Query::<LoginQueryParams>::from_request(request, &())
        .await
        .expect("it should extract");

    assert_matches!(extracted, Query(LoginQueryParams {
       idp_name: Some(idp_name),
       idp_id: None,
       login_hint: None,
       original_url: Some(original_url),
       is_mobile: true
    }) => {
        assert_eq!(idp_name, "google");
        assert_eq!(original_url.0.as_str(), "https://example.com/");
    });
}
