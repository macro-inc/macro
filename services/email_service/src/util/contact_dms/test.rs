use super::colleague_emails;

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
fn caps_the_number_of_colleagues() {
    let contacts: Vec<String> = (0..500).map(|i| format!("person{i}@acme.com")).collect();

    assert_eq!(colleague_emails("owner@acme.com", &contacts).len(), 200);
}
