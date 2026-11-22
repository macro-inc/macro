use super::*;
use crate::domain::models::DiscoverySteer;
use macro_user_id::email::EmailStr;

#[test]
fn custom_domains_follow_primary_mx_without_guessing_from_backup_or_ambiguous_records() {
    let email = EmailStr::parse_from_str("Owner+Tag@custom.example.com").unwrap();
    for (exchange, provider, steer) in [
        ("aspmx.l.google.com.", "Google", Some(DiscoverySteer::Gmail)),
        (
            "tenant.mail.protection.outlook.com.",
            "Microsoft",
            Some(DiscoverySteer::Outlook),
        ),
        ("in1-smtp.messagingengine.com.", "Fastmail", None),
    ] {
        let hint = classify_mx(&email.0, &[(10, exchange.into())]);
        assert_eq!(hint.provider.as_deref(), Some(provider));
        assert_eq!(hint.steer, steer);
    }
    for records in [
        vec![],
        vec![(0, ".".into())],
        vec![
            (0, "mx.unknown.example.com".into()),
            (10, "aspmx.l.google.com".into()),
        ],
        vec![
            (0, "aspmx.l.google.com".into()),
            (0, "tenant.mail.protection.outlook.com".into()),
        ],
        vec![(0, "aspmx.l.google.com".into()); MX_LIMIT + 1],
    ] {
        assert!(classify_mx(&email.0, &records).provider.is_none());
    }
}

#[tokio::test]
async fn catalog_and_reserved_domains_never_initialize_network_discovery() {
    let hints = ProviderHints::default();
    let domain = "fastmail.com";
    let email = EmailStr::try_from(format!("Owner+Tag@{domain}")).unwrap();
    let hint = hints.lookup(&email.0).await.unwrap();
    assert_eq!(hint.provider.as_deref(), Some("Fastmail"));
    assert!(hint.steer.is_none());
    assert_eq!(hint.imap.unwrap().username, email.0.as_ref());
    let reserved = EmailStr::parse_from_str("owner@example.com").unwrap();
    assert!(hints.lookup(&reserved.0).await.unwrap().provider.is_none());
    let local_domain = "example.LOCAL";
    let local = EmailStr::try_from(format!("owner@{local_domain}")).unwrap();
    assert!(matches!(hints.lookup(&local.0).await, Err(Error::Invalid)));
    assert!(!discovery::valid_host(local_domain));
    assert!(hints.resolver.get().is_none());
}
