use super::{EmailLinkErr, MultiEmailLinkExtractor, resolve_target_link};
use crate::domain::models::{Link, UserProvider};
use axum::{body::to_bytes, http::StatusCode, response::IntoResponse};
use chrono::Utc;
use macro_authorization::MacroAuthorizationRejection;
use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use std::{borrow::Cow, marker::PhantomData};
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

#[tokio::test]
async fn authorization_error_delegates_response() {
    let rejection = MacroAuthorizationRejection {
        status: StatusCode::IM_A_TEAPOT,
        message: Cow::Borrowed("safe authorization error"),
    };
    let expected = rejection.clone().into_response();
    let actual = EmailLinkErr::Authorization(rejection).into_response();

    assert_eq!(actual.status(), expected.status());
    let actual_body = to_bytes(actual.into_body(), usize::MAX).await.unwrap();
    let expected_body = to_bytes(expected.into_body(), usize::MAX).await.unwrap();
    assert_eq!(actual_body, expected_body);
    assert_eq!(actual_body, r#"{"message":"safe authorization error"}"#);
}

#[test]
fn multi_email_link_extractor_is_cloneable_without_generic_clone_bounds() {
    struct NotClone;

    let extractor = MultiEmailLinkExtractor::<NotClone, NotClone>(Vec::new(), PhantomData);
    let _clone = extractor.clone();
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
