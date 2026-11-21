use super::*;
use crate::api::internal::fusionauth_fixture;
use axum::extract::{self, FromRequestParts};
use axum::http::Request;
use url::Url;

#[tokio::test]
async fn removing_a_deleted_users_link_succeeds() {
    let (_server, auth_client) = fusionauth_fixture::without_user("deleted-user").await;

    let response = remove_link(
        &auth_client,
        "deleted-user",
        "inbox@macro.com",
        fusionauth_fixture::GMAIL_IDP_NAME,
    )
    .await
    .expect("a deleted user has no link left to remove");

    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn it_deserializes_linked_email_query_param() {
    let mut url: Url = "https://test.com".parse().unwrap();
    url.query_pairs_mut()
        .append_pair("fusionauth_user_id", "fa-user-1")
        .append_pair("linked_email", "gabtest1@macro.com")
        .append_pair("idp_name", "google_gmail");

    let (mut parts, ()) = Request::builder()
        .uri(url.as_str())
        .body(())
        .unwrap()
        .into_parts();

    let extract::Query(params) =
        extract::Query::<RemoveLinkQueryParams>::from_request_parts(&mut parts, &())
            .await
            .expect("query params should deserialize");

    assert_eq!(params.fusionauth_user_id, "fa-user-1");
    assert_eq!(params.linked_email, "gabtest1@macro.com");
    assert_eq!(params.idp_name, "google_gmail");
}
