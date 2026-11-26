use super::*;

#[test]
fn only_an_active_imap_link_owner_receives_its_exact_binding() {
    let owner = MacroUserIdStr::try_from("macro|owner@example.com".to_string()).unwrap();
    let delegate = MacroUserIdStr::try_from("macro|delegate@example.com".to_string()).unwrap();
    let binding = Binding {
        link_id: Uuid::from_u128(4),
        sync_generation: 7,
        grant_generation: 3,
    };
    let access = |uses_imap, active| ImapSettingsAccess {
        owner: owner.clone(),
        uses_imap,
        active,
        binding,
    };
    assert_eq!(access(true, true).authorize(&owner).unwrap(), binding);
    for result in [
        access(true, true).authorize(&delegate),
        access(false, true).authorize(&owner),
        access(true, false).authorize(&owner),
    ] {
        assert!(matches!(
            result,
            Err(ImapConnectionError::Provider(Error::NotFound))
        ));
    }
}
