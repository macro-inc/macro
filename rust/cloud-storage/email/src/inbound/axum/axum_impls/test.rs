use super::{EmailLinkErr, resolve_target_link};
use crate::domain::models::{Link, UserProvider};
use chrono::Utc;
use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use uuid::Uuid;

fn test_link(id: Uuid, email: &str) -> Link {
    Link {
        id,
        macro_id: MacroUserIdStr::try_from_email("user@test.com").unwrap(),
        fusionauth_user_id: "fa-user".to_string(),
        email_address: EmailStr::try_from(email.to_string()).unwrap(),
        provider: UserProvider::Gmail,
        is_sync_active: true,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}

#[test]
fn header_selects_owned_link() {
    let id1 = Uuid::from_u128(1);
    let id2 = Uuid::from_u128(2);
    let links = vec![
        test_link(id1, "primary@test.com"),
        test_link(id2, "other@test.com"),
    ];
    let resolved = resolve_target_link(links, Some(id2), "primary@test.com").unwrap();
    assert_eq!(resolved.id, id2);
}

#[test]
fn header_for_unowned_link_is_not_found() {
    let links = vec![test_link(Uuid::from_u128(1), "primary@test.com")];
    let result = resolve_target_link(links, Some(Uuid::from_u128(99)), "primary@test.com");
    assert!(matches!(result, Err(EmailLinkErr::NotFound)));
}

#[test]
fn no_header_falls_back_to_primary_email_match() {
    let primary = Uuid::from_u128(1);
    let links = vec![
        test_link(Uuid::from_u128(2), "secondary@test.com"),
        test_link(primary, "primary@test.com"),
    ];
    let resolved = resolve_target_link(links, None, "primary@test.com").unwrap();
    assert_eq!(resolved.id, primary);
}

#[test]
fn primary_match_is_case_insensitive() {
    let primary = Uuid::from_u128(1);
    let links = vec![test_link(primary, "Primary@Test.com")];
    let resolved = resolve_target_link(links, None, "primary@test.com").unwrap();
    assert_eq!(resolved.id, primary);
}

#[test]
fn no_header_and_no_primary_is_rejected() {
    let links = vec![test_link(Uuid::from_u128(2), "secondary@test.com")];
    let result = resolve_target_link(links, None, "primary@test.com");
    assert!(matches!(result, Err(EmailLinkErr::NoInboxSelected)));
}

#[test]
fn no_links_at_all_is_rejected() {
    let result = resolve_target_link(vec![], None, "primary@test.com");
    assert!(matches!(result, Err(EmailLinkErr::NoInboxSelected)));
}
