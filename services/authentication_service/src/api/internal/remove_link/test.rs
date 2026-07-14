use super::*;
use axum::extract::{self, FromRequestParts};
use axum::http::Request;
use url::Url;

fn link(display_name: &str, idp_user_id: &str) -> Link {
    Link {
        display_name: display_name.to_string(),
        identity_provider_id: "idp".to_string(),
        identity_provider_name: "google_gmail".to_string(),
        identity_provider_type: "Google".to_string(),
        identity_provider_user_id: idp_user_id.to_string(),
        insert_instant: 0,
        last_login_instant: 0,
        tenant_id: "tenant".to_string(),
        token: "token".to_string(),
        user_id: "user".to_string(),
    }
}

#[test]
fn find_idp_link_selects_secondary_inbox_not_owner_primary() {
    let links = vec![
        link("gab@macro.com", "google-primary"),
        link("gabtest1@macro.com", "google-secondary"),
    ];

    let found =
        find_idp_link(links, "gabtest1@macro.com").expect("secondary inbox link should be found");

    assert_eq!(found.display_name, "gabtest1@macro.com");
    assert_eq!(found.identity_provider_user_id, "google-secondary");
}

#[test]
fn find_idp_link_returns_none_when_absent() {
    let links = vec![link("gab@macro.com", "google-primary")];

    assert!(find_idp_link(links, "missing@macro.com").is_none());
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
