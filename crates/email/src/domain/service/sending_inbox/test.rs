use super::*;
use crate::domain::models::UserProvider;
use chrono::Utc;
use macro_user_id::email::EmailStr;

fn link(owner: &str, address: &str) -> Link {
    Link {
        id: uuid::Uuid::now_v7(),
        macro_id: MacroUserIdStr::try_from_email(owner).unwrap(),
        fusionauth_user_id: "fa-user".to_owned(),
        email_address: EmailStr::try_from(address.to_owned()).unwrap(),
        provider: UserProvider::Gmail,
        is_sync_active: true,
        // Generated in the database from macro_id and email_address; mirrored
        // here so a fixture cannot claim a primary inbox it would not have.
        is_primary: owner == address,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}

fn caller() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("user@test.com").unwrap()
}

#[test]
fn a_blank_address_is_no_choice_at_all() {
    // Both a model that emitted an empty string and form state that sent one
    // mean "you pick", not "send from the inbox called nothing".
    for blank in [Some(""), Some("   "), None] {
        assert_eq!(requested_address(blank), None, "{blank:?}");
    }
    assert_eq!(
        requested_address(Some(" me@test.com ")),
        Some("me@test.com")
    );
}

#[test]
fn the_default_sender_is_the_callers_primary_inbox() {
    let inboxes = vec![
        link("user@test.com", "work@test.com"),
        link("user@test.com", "user@test.com"),
    ];

    assert_eq!(default_inbox(&inboxes, &caller()), Some(1));
}

#[test]
fn a_delegated_primary_inbox_is_never_the_callers_default() {
    // A delegated inbox is primary for *its* owner. Without the macro-id
    // guard a teammate's mailbox becomes the caller's default sender, which
    // is how an agent ends up mailing from an address that is not the user's.
    let inboxes = vec![
        link("teammate@test.com", "teammate@test.com"),
        link("user@test.com", "work@test.com"),
    ];

    assert_eq!(default_inbox(&inboxes, &caller()), Some(1));
}

#[test]
fn a_caller_with_only_delegated_inboxes_still_gets_one() {
    let inboxes = vec![link("teammate@test.com", "teammate@test.com")];

    assert_eq!(default_inbox(&inboxes, &caller()), Some(0));
}

#[test]
fn no_inbox_means_no_default() {
    assert_eq!(default_inbox(&[], &caller()), None);
}

#[test]
fn an_address_matches_whatever_its_case() {
    let inboxes = vec![link("user@test.com", "Work@Test.com")];

    assert_eq!(
        inbox_by_address(&inboxes, &caller(), "work@test.com"),
        Some(0)
    );
}

#[test]
fn an_address_reachable_through_two_accounts_resolves_to_the_callers_own() {
    // Row order decides nothing: the delegated copy is listed first.
    let inboxes = vec![
        link("teammate@test.com", "shared@test.com"),
        link("user@test.com", "shared@test.com"),
    ];

    assert_eq!(
        inbox_by_address(&inboxes, &caller(), "shared@test.com"),
        Some(1)
    );
}

#[test]
fn an_unconnected_address_matches_nothing() {
    let inboxes = vec![link("user@test.com", "user@test.com")];

    assert_eq!(
        inbox_by_address(&inboxes, &caller(), "someone@elsewhere.test"),
        None
    );
}
