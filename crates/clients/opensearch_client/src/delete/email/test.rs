use super::*;

#[test]
fn resolves_default_email_destination() {
    assert_eq!(
        resolve_destination(None),
        opensearch_types::SearchIndex::Emails.as_ref()
    );
}

#[test]
fn resolves_overridden_email_destination() {
    assert_eq!(
        resolve_destination(Some("emails_backfill")),
        "emails_backfill"
    );
}
