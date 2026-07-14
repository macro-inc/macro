use super::{EmailLinkErr, EmailLinkExtractor, resolve_target_link};
use crate::{
    domain::{
        models::{Link, UserProvider},
        ports::NoOpEmailService,
    },
    inbound::axum::previews_router::EmailRouterState,
};
use axum::{
    body::to_bytes,
    extract::FromRequestParts,
    http::{Request, StatusCode, header},
    response::IntoResponse,
};
use axum_extra::extract::Cached;
use chrono::Utc;
use macro_authorization::{
    MacroAuthorizationError, MacroAuthorizationServiceImpl,
    testing::{FakeMacroAuthorizationService, bearer},
};
use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use uuid::Uuid;

fn test_link(id: Uuid, owner: &str, email: &str, is_primary: bool) -> Link {
    Link {
        id,
        macro_id: MacroUserIdStr::try_from_email(owner).unwrap(),
        fusionauth_user_id: "fa-user".to_string(),
        email_address: EmailStr::try_from(email.to_string()).unwrap(),
        provider: UserProvider::Gmail,
        is_sync_active: true,
        is_primary,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}

fn caller() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("user@test.com").unwrap()
}

#[test]
fn header_selects_owned_link() {
    let id1 = Uuid::from_u128(1);
    let id2 = Uuid::from_u128(2);
    let links = vec![
        test_link(id1, "user@test.com", "user@test.com", true),
        test_link(id2, "user@test.com", "other@test.com", false),
    ];
    let resolved = resolve_target_link(links, Some(id2), &caller()).unwrap();
    assert_eq!(resolved.id, id2);
}

#[test]
fn header_for_unowned_link_is_not_found() {
    let links = vec![test_link(
        Uuid::from_u128(1),
        "user@test.com",
        "user@test.com",
        true,
    )];
    let result = resolve_target_link(links, Some(Uuid::from_u128(99)), &caller());
    assert!(matches!(result, Err(EmailLinkErr::NotFound)));
}

#[test]
fn no_header_falls_back_to_callers_primary() {
    let primary = Uuid::from_u128(1);
    let links = vec![
        test_link(
            Uuid::from_u128(2),
            "user@test.com",
            "secondary@test.com",
            false,
        ),
        test_link(primary, "user@test.com", "user@test.com", true),
    ];
    let resolved = resolve_target_link(links, None, &caller()).unwrap();
    assert_eq!(resolved.id, primary);
}

#[test]
fn delegated_primary_is_not_the_callers_primary() {
    // A delegated inbox is primary for its own account; without the macro_id
    // guard it would be picked as the caller's default target.
    let own_primary = Uuid::from_u128(1);
    let links = vec![
        test_link(
            Uuid::from_u128(2),
            "delegator@test.com",
            "delegator@test.com",
            true,
        ),
        test_link(own_primary, "user@test.com", "user@test.com", true),
    ];
    let resolved = resolve_target_link(links, None, &caller()).unwrap();
    assert_eq!(resolved.id, own_primary);
}

#[test]
fn no_header_and_no_primary_is_rejected() {
    let links = vec![test_link(
        Uuid::from_u128(2),
        "user@test.com",
        "secondary@test.com",
        false,
    )];
    let result = resolve_target_link(links, None, &caller());
    assert!(matches!(result, Err(EmailLinkErr::NoInboxSelected)));
}

#[test]
fn no_links_at_all_is_rejected() {
    let result = resolve_target_link(vec![], None, &caller());
    assert!(matches!(result, Err(EmailLinkErr::NoInboxSelected)));
}

#[tokio::test]
async fn expired_credentials_propagate_through_cached_email_link_extractor() {
    let authorization =
        FakeMacroAuthorizationService::never(MacroAuthorizationError::CredentialsExpired);
    let state = EmailRouterState::new(
        NoOpEmailService,
        MacroAuthorizationServiceImpl::new(authorization.clone()),
    );
    let request = bearer(Request::get("/"), "expired").body(()).unwrap();
    let (mut parts, _) = request.into_parts();

    let rejection = match Cached::<EmailLinkExtractor<NoOpEmailService>>::from_request_parts(
        &mut parts, &state,
    )
    .await
    {
        Ok(_) => panic!("expired credentials should be rejected"),
        Err(rejection) => rejection,
    };
    let response = rejection.into_response();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response.headers().get(header::WWW_AUTHENTICATE).unwrap(),
        "Bearer error=\"invalid_token\", error_description=\"jwt expired\""
    );
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert_eq!(body.as_ref(), br#"{"message":"jwt expired"}"#);
    assert_eq!(authorization.calls(), ["expired"]);
}
