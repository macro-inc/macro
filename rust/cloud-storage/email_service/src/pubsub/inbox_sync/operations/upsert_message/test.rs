use super::*;

fn id(s: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(s.to_string()).unwrap()
}

#[test]
fn includes_owner_and_all_delegated_primaries() {
    let owner = id("macro|owner@x.com");
    let recipients = build_notification_recipients(
        &owner,
        vec![
            "macro|primary-a@x.com".to_string(),
            "macro|primary-b@x.com".to_string(),
        ],
    );

    assert_eq!(
        recipients,
        HashSet::from([
            owner,
            id("macro|primary-a@x.com"),
            id("macro|primary-b@x.com"),
        ])
    );
}

#[test]
fn returns_only_owner_when_no_primaries() {
    let owner = id("macro|owner@x.com");
    let recipients = build_notification_recipients(&owner, vec![]);

    assert_eq!(recipients, HashSet::from([owner]));
}

#[test]
fn skips_unparseable_primaries_keeping_valid_ones() {
    let owner = id("macro|owner@x.com");
    let recipients = build_notification_recipients(
        &owner,
        vec![
            "macro|primary-a@x.com".to_string(),
            "not-a-valid-id".to_string(),
        ],
    );

    assert_eq!(
        recipients,
        HashSet::from([owner, id("macro|primary-a@x.com")])
    );
}
