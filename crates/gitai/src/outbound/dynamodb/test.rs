use chrono::Utc;

use super::*;
use crate::domain::models::{Email, Hostname};

#[test]
fn a_new_credential_item_has_no_revoked_at_attribute() {
    // The revoke update keeps an existing `revoked_at`; an explicit NULL
    // written at mint time would make every credential look revoked-never.
    let info = CredentialInfo {
        id: CredentialId::generate(),
        email: Email::parse("dev@example.com").unwrap(),
        hostname: Hostname::parse("laptop-1").unwrap(),
        created_at: Utc::now(),
        last_used_at: None,
        revoked_at: None,
    };
    let item: HashMap<String, AttributeValue> = serde_dynamo::to_item(&info).unwrap();
    assert!(!item.contains_key("revoked_at"));
    assert!(!item.contains_key("last_used_at"));

    let read_back: CredentialInfo = serde_dynamo::from_item(item).unwrap();
    assert_eq!(read_back, info);
}
