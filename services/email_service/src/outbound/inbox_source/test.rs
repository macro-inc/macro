use super::*;
use contacts::domain::models::list::ContactList;
use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use uuid::Uuid;

fn link(provider: UserProvider) -> Link {
    let macro_id = MacroUserIdStr::try_from("macro|owner@example.com".to_string()).unwrap();
    let email_address = EmailStr::try_from("owner@example.com".to_string()).unwrap();
    Link {
        id: Uuid::from_u128(7),
        is_primary: Link::derive_is_primary(&macro_id, &email_address),
        macro_id,
        fusionauth_user_id: "fa".to_string(),
        email_address,
        provider,
        is_sync_active: true,
        needs_reauth: false,
        last_sync_error_at: None,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
    }
}

#[test]
fn an_inbox_records_its_contacts_in_its_owners_list_for_its_provider() {
    for (provider, list) in [
        (UserProvider::Gmail, ContactList::Gmail),
        (UserProvider::Outlook, ContactList::Outlook),
    ] {
        let link = link(provider);
        let source = inbox_source(&link);
        assert_eq!(source.owner, link.macro_id);
        assert_eq!(source.link_id, link.id);
        assert_eq!(ContactList::from(source.provider), list);
    }
}
