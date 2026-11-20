use super::*;

#[test]
fn every_list_parses_from_its_own_key() {
    // Name every variant so a new list fails to compile here until it is added.
    let all = |list: ContactList| match list {
        ContactList::Teammates
        | ContactList::Interacted
        | ContactList::Invited
        | ContactList::Gmail
        | ContactList::Outlook => list,
    };
    for list in [
        ContactList::Teammates,
        ContactList::Interacted,
        ContactList::Invited,
        ContactList::Gmail,
        ContactList::Outlook,
    ]
    .map(all)
    {
        assert_eq!(ContactList::from_key(list.as_ref()), Some(list));
    }
}

#[test]
fn an_unknown_key_names_no_list() {
    assert_eq!(ContactList::from_key("custom:0192"), None);
    assert_eq!(ContactList::from_key("Gmail"), None);
}
