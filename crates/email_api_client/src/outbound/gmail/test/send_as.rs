//! Tests for Gmail send-as adapter.

use models_email::gmail::send_as::{SendAsResource, SendAsVerificationStatus};

use crate::domain::ports::ProviderSendAsAlias;

fn convert_send_as(resource: SendAsResource) -> ProviderSendAsAlias {
    ProviderSendAsAlias {
        send_as_email: resource.send_as_email,
        display_name: resource.display_name,
        reply_to_address: resource.reply_to_address,
        signature: resource.signature,
        is_default: resource.is_default,
        is_verified: resource.verification_status.is_verified(),
        is_primary: resource.is_primary,
    }
}

#[test]
fn convert_send_as_maps_verified_alias() {
    let resource = SendAsResource {
        send_as_email: "alias@example.com".to_string(),
        display_name: Some("Support Team".to_string()),
        reply_to_address: Some("reply@example.com".to_string()),
        signature: Some("<p>Regards</p>".to_string()),
        is_primary: false,
        is_default: true,
        treat_as_alias: true,
        verification_status: SendAsVerificationStatus::Accepted,
        smtp_msa: None,
    };

    let alias = convert_send_as(resource);

    assert_eq!(alias.send_as_email, "alias@example.com");
    assert_eq!(alias.display_name, Some("Support Team".to_string()));
    assert_eq!(
        alias.reply_to_address,
        Some("reply@example.com".to_string())
    );
    assert_eq!(alias.signature, Some("<p>Regards</p>".to_string()));
    assert!(!alias.is_primary);
    assert!(alias.is_default);
    assert!(alias.is_verified);
}

#[test]
fn convert_send_as_maps_pending_as_unverified() {
    let resource = SendAsResource {
        send_as_email: "pending@example.com".to_string(),
        display_name: None,
        reply_to_address: None,
        signature: None,
        is_primary: false,
        is_default: false,
        treat_as_alias: false,
        verification_status: SendAsVerificationStatus::Pending,
        smtp_msa: None,
    };

    let alias = convert_send_as(resource);

    assert!(!alias.is_verified);
}

#[test]
fn convert_send_as_maps_primary() {
    let resource = SendAsResource {
        send_as_email: "primary@example.com".to_string(),
        display_name: Some("Primary User".to_string()),
        reply_to_address: None,
        signature: None,
        is_primary: true,
        is_default: true,
        treat_as_alias: false,
        verification_status: SendAsVerificationStatus::Accepted,
        smtp_msa: None,
    };

    let alias = convert_send_as(resource);

    assert!(alias.is_primary);
    assert!(alias.is_default);
    assert!(alias.is_verified);
}
