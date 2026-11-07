use super::*;
use crate::domain::models::UserProvider;
use macro_user_id::user_id::MacroUserIdStr;
use models_email::gmail::{SendAsAlias, SendAsVerificationStatus};

fn link() -> Link {
    Link {
        id: Uuid::from_u128(1),
        macro_id: MacroUserIdStr::try_from_email("base@example.com").unwrap(),
        fusionauth_user_id: "grant".to_owned(),
        email_address: EmailStr::try_from("base@example.com".to_owned()).unwrap(),
        provider: UserProvider::Gmail,
        is_sync_active: true,
        is_primary: true,
        created_at: Default::default(),
        updated_at: Default::default(),
    }
}

fn alias(address: &str, status: Option<SendAsVerificationStatus>) -> SendAsAlias {
    SendAsAlias {
        send_as_email: address.to_owned(),
        verification_status: status,
        display_name: Some("Sender".to_owned()),
        signature: None,
        is_primary: None,
        is_default: None,
    }
}

#[test]
fn malformed_addresses_do_not_discard_healthy_aliases_or_change_verification() {
    let addresses = sender_addresses(
        &link(),
        vec![
            alias("invalid", Some(SendAsVerificationStatus::Accepted)),
            alias("base@example.com", None),
            alias(
                "resident@example.com",
                Some(SendAsVerificationStatus::Accepted),
            ),
            alias(
                "pending@example.com",
                Some(SendAsVerificationStatus::Pending),
            ),
            alias(
                "unknown@example.com",
                Some(SendAsVerificationStatus::Unknown),
            ),
            alias("also-invalid", None),
        ],
    );
    assert_eq!(
        addresses
            .iter()
            .map(|sender| sender.email_address.0.as_ref())
            .collect::<Vec<_>>(),
        vec![
            "base@example.com",
            "resident@example.com",
            "pending@example.com",
            "unknown@example.com"
        ]
    );
    assert_eq!(
        addresses
            .iter()
            .map(|sender| sender.verified)
            .collect::<Vec<_>>(),
        vec![true, true, false, false]
    );
    assert_eq!(addresses[1].display_name.as_deref(), Some("Sender"));
}

#[test]
fn an_entirely_malformed_catalog_is_empty_not_an_availability_error() {
    assert!(sender_addresses(&link(), vec![alias("invalid", None)]).is_empty());
}
