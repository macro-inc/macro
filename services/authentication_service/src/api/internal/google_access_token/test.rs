use super::*;
use crate::api::internal::fusionauth_fixture;

#[tokio::test]
async fn a_deleted_user_has_no_google_grant() {
    let (_server, auth_client) = fusionauth_fixture::without_user("deleted-user").await;
    let params = GoogleAccessTokenParams {
        fusionauth_user_id: "deleted-user".into(),
        email: "inbox@macro.com".into(),
    };

    let response = get_access_token(
        Arc::new(auth_client),
        &params,
        fusionauth_fixture::GMAIL_IDP_NAME,
    )
    .await
    .expect_err("a deleted user has no grant to mint a token from");

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}
