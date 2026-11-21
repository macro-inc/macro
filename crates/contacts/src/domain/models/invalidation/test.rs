use super::*;

fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).unwrap()
}

#[test]
fn names_changed_contacts_up_to_the_lookup_limit() {
    let changed: Vec<_> = (0..MAX_CHANGED_CONTACTS)
        .map(|i| user(&format!("contact{i}@example.com")))
        .collect();

    let invalidation = ContactsInvalidation::new(user("owner@example.com"), changed.clone());

    assert_eq!(invalidation.changed(), Some(changed.as_slice()));
}

#[test]
fn more_changed_contacts_than_one_lookup_leaves_the_change_unknown() {
    let changed: Vec<_> = (0..=MAX_CHANGED_CONTACTS)
        .map(|i| user(&format!("contact{i}@example.com")))
        .collect();

    let invalidation = ContactsInvalidation::new(user("owner@example.com"), changed);

    assert_eq!(invalidation.changed(), None);
}

#[test]
fn no_changed_contacts_leaves_the_change_unknown() {
    let invalidation = ContactsInvalidation::new(user("owner@example.com"), Vec::new());

    assert_eq!(invalidation.changed(), None);
}
