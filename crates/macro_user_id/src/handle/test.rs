use super::*;

#[test]
fn accepts_canonical_handles() {
    for handle in ["ada", "ada.lovelace", "ada-01", "ada_01", "-ada", "_ada"] {
        assert_eq!(MailboxHandle::parse(handle).unwrap().as_str(), handle);
    }
}

#[test]
fn rejects_invalid_and_reserved_handles() {
    for handle in [
        "ab",
        "admin",
        "ada@rox.one",
        "..ada",
        ".ada",
        "ada.",
        "ada..lovelace",
        "Ada",
        "ada lovelace",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "postmaster",
    ] {
        assert!(MailboxHandle::parse(handle).is_err(), "accepted {handle}");
    }
}

#[test]
fn address_uses_the_first_party_domain() {
    assert_eq!(
        MailboxHandle::parse("ada").unwrap().email_address(),
        "ada@rox.one"
    );
}
