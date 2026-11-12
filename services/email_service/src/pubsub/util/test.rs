use super::build_notification_recipients;
use macro_user_id::user_id::MacroUserIdStr;

fn id(s: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(s.to_string()).expect("valid macro user id")
}

#[test]
fn fans_out_to_owner_and_every_delegated_primary() {
    let owner = id("macro|shared@team.test");
    let primaries = vec![
        "macro|alice@team.test".to_string(),
        "macro|bob@team.test".to_string(),
    ];

    let recipients = build_notification_recipients(&owner, primaries);

    assert_eq!(recipients.len(), 3);
    assert!(recipients.contains(&owner));
    assert!(recipients.contains(&id("macro|alice@team.test")));
    assert!(recipients.contains(&id("macro|bob@team.test")));
}

#[test]
fn owner_only_when_no_delegates() {
    let owner = id("macro|solo@personal.test");
    let recipients = build_notification_recipients(&owner, vec![]);
    assert_eq!(recipients.len(), 1);
    assert!(recipients.contains(&owner));
}

#[test]
fn skips_primaries_that_fail_to_parse() {
    let owner = id("macro|shared@team.test");
    let primaries = vec![
        "not-a-macro-id".to_string(),
        "macro|ok@team.test".to_string(),
    ];

    let recipients = build_notification_recipients(&owner, primaries);

    assert_eq!(recipients.len(), 2);
    assert!(recipients.contains(&owner));
    assert!(recipients.contains(&id("macro|ok@team.test")));
}
