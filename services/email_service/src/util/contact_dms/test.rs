use super::{colleague_emails, without_hidden_emails};
use std::collections::HashSet;

fn emails(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}

#[test]
fn keeps_only_addresses_on_the_owners_work_domain() {
    let contacts = emails(&[
        "alice@acme.com",
        "bob@other.com",
        "owner@acme.com",
        "carol@acme.com",
    ]);

    assert_eq!(
        colleague_emails("Owner@Acme.com", &contacts),
        emails(&["alice@acme.com", "carol@acme.com"])
    );
}

#[test]
fn consumer_domains_have_no_colleagues() {
    let contacts = emails(&["friend@gmail.com", "other@gmail.com"]);

    assert!(colleague_emails("owner@gmail.com", &contacts).is_empty());
}

#[test]
fn skips_hidden_addresses_ignoring_case() {
    let hidden = HashSet::from(["hidden@example.com".to_owned()]);

    assert_eq!(
        without_hidden_emails(emails(&["Hidden@example.com", "kept@example.com"]), &hidden),
        emails(&["kept@example.com"])
    );
}

#[test]
fn caps_the_number_of_colleagues() {
    let contacts: Vec<String> = (0..500).map(|i| format!("person{i}@acme.com")).collect();

    assert_eq!(colleague_emails("owner@acme.com", &contacts).len(), 200);
}
