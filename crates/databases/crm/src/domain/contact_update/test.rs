use super::{ContactFieldUpdate, ContactIdentityChange};
use crate::domain::model::{CrmContact, CrmError};
use chrono::DateTime;
use uuid::Uuid;

fn contact(
    company_id: Option<Uuid>,
    emails: &[&str],
    company_domain_emails: &[&str],
) -> CrmContact {
    CrmContact {
        id: Uuid::nil(),
        company_id,
        email: emails.first().map(|email| (*email).to_owned()),
        name: None,
        hidden: false,
        first_interaction: DateTime::UNIX_EPOCH,
        last_interaction: DateTime::UNIX_EPOCH,
        created_at: DateTime::UNIX_EPOCH,
        updated_at: DateTime::UNIX_EPOCH,
        emails: emails.iter().map(|email| (*email).to_owned()).collect(),
        company_domain_emails: company_domain_emails
            .iter()
            .map(|email| (*email).to_owned())
            .collect(),
    }
}

fn rejected(result: Result<ContactIdentityChange, CrmError>) -> String {
    match result {
        Err(CrmError::InvalidRequest(message)) => message,
        other => panic!("expected a rejection, got {other:?}"),
    }
}

#[test]
fn an_added_address_becomes_primary_only_when_there_is_none() {
    let blank = contact(None, &[], &[]);
    let change = ContactFieldUpdate::AddEmail("a@example.org".into())
        .resolve(&blank)
        .unwrap();
    assert_eq!(change.primary.as_deref(), Some("a@example.org"));
    assert_eq!(change.added.as_deref(), Some("a@example.org"));

    let held = contact(None, &["a@example.org"], &[]);
    let change = ContactFieldUpdate::AddEmail("b@example.org".into())
        .resolve(&held)
        .unwrap();
    assert_eq!(change.primary.as_deref(), Some("a@example.org"));
    assert_eq!(change.added.as_deref(), Some("b@example.org"));

    let retry = ContactFieldUpdate::AddEmail("a@example.org".into())
        .resolve(&held)
        .unwrap();
    assert!(retry.changes_nothing(&held));
}

#[test]
fn choosing_the_primary_adds_an_address_the_contact_does_not_hold() {
    let held = contact(None, &["a@example.org", "b@example.org"], &[]);

    let existing = ContactFieldUpdate::Email("b@example.org".into())
        .resolve(&held)
        .unwrap();
    assert_eq!(existing.primary.as_deref(), Some("b@example.org"));
    assert_eq!(existing.added, None);

    let new = ContactFieldUpdate::Email("c@example.org".into())
        .resolve(&held)
        .unwrap();
    assert_eq!(new.primary.as_deref(), Some("c@example.org"));
    assert_eq!(new.added.as_deref(), Some("c@example.org"));
    assert_eq!(new.removed, None);
}

#[test]
fn removing_the_primary_promotes_the_oldest_address_left() {
    let held = contact(
        None,
        &["a@example.org", "b@example.org", "c@example.org"],
        &[],
    );

    let primary = ContactFieldUpdate::RemoveEmail("a@example.org".into())
        .resolve(&held)
        .unwrap();
    assert_eq!(primary.primary.as_deref(), Some("b@example.org"));
    assert_eq!(primary.removed.as_deref(), Some("a@example.org"));

    let further = ContactFieldUpdate::RemoveEmail("c@example.org".into())
        .resolve(&held)
        .unwrap();
    assert_eq!(further.primary.as_deref(), Some("a@example.org"));

    let only = contact(None, &["a@example.org"], &[]);
    let last = ContactFieldUpdate::RemoveEmail("a@example.org".into())
        .resolve(&only)
        .unwrap();
    assert_eq!(last.primary, None);

    let absent = ContactFieldUpdate::RemoveEmail("z@example.org".into())
        .resolve(&held)
        .unwrap();
    assert!(absent.changes_nothing(&held));
}

#[test]
fn the_last_company_domain_address_cannot_be_removed() {
    let company = Uuid::from_u128(1);
    let one = contact(
        Some(company),
        &["a@example.com", "a@example.org"],
        &["a@example.com"],
    );
    assert_eq!(
        rejected(ContactFieldUpdate::RemoveEmail("a@example.com".into()).resolve(&one)),
        "this address links the contact to its company and cannot be removed"
    );
    assert!(
        ContactFieldUpdate::RemoveEmail("a@example.org".into())
            .resolve(&one)
            .is_ok()
    );

    let two = contact(
        Some(company),
        &["a@example.com", "b@example.com"],
        &["a@example.com", "b@example.com"],
    );
    let change = ContactFieldUpdate::RemoveEmail("a@example.com".into())
        .resolve(&two)
        .unwrap();
    assert_eq!(change.primary.as_deref(), Some("b@example.com"));
}

/// A consumer provider; no reserved example domain is one.
const PERSONAL_DOMAIN: &str = "gmail.com";

#[test]
fn a_company_domain_contact_cannot_be_unlinked_or_moved() {
    let company = Uuid::from_u128(1);
    let other = Uuid::from_u128(2);
    let personal = format!("a@{PERSONAL_DOMAIN}");
    // A personal primary does not lift the rule while a company-domain
    // address remains.
    let tied = contact(
        Some(company),
        &[&personal, "a@example.com"],
        &["a@example.com"],
    );
    assert_eq!(
        rejected(ContactFieldUpdate::NoCompany.resolve(&tied)),
        "a contact on its company's domain cannot be unlinked"
    );
    assert_eq!(
        rejected(ContactFieldUpdate::Company(other).resolve(&tied)),
        "a contact on its company's domain cannot change company"
    );

    let linked = contact(Some(company), &[&personal], &[]);
    let unlinked = ContactFieldUpdate::NoCompany.resolve(&linked).unwrap();
    assert_eq!(unlinked.company_id, None);
    assert_eq!(unlinked.primary.as_deref(), Some(personal.as_str()));
    let moved = ContactFieldUpdate::Company(other).resolve(&linked).unwrap();
    assert_eq!(moved.company_id, Some(other));

    let unfiled = contact(None, &[&personal], &[]);
    assert!(
        ContactFieldUpdate::NoCompany
            .resolve(&unfiled)
            .unwrap()
            .changes_nothing(&unfiled)
    );
}

#[test]
fn linking_still_requires_a_personal_provider_primary() {
    let personal = format!("a@{PERSONAL_DOMAIN}");
    let work = contact(None, &["a@example.org", &personal], &[]);
    assert_eq!(
        rejected(ContactFieldUpdate::Company(Uuid::from_u128(1)).resolve(&work)),
        "company changes require a personal-provider email"
    );
}
