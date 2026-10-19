use super::*;

fn actor() -> InboxActor {
    InboxActor {
        macro_id: MacroUserIdStr::parse_from_str("macro|leaving@example.com").unwrap(),
        credential_owner: "leaving-owner".into(),
    }
}
fn snapshot() -> InboxLifecycleSnapshot {
    InboxLifecycleSnapshot {
        link_id: Uuid::now_v7(),
        owner: "macro|shared@example.com".into(),
        provider: UserProvider::Outlook,
        promoted: true,
        delegates: vec![
            "macro|leaving@example.com".into(),
            "macro|remaining@example.com".into(),
        ],
        sync_generation: 1,
        grant_id: Some(Uuid::now_v7()),
        grant_generation: 1,
        credential_owner: "leaving-owner".into(),
        disconnecting: false,
        custodians: vec![MailboxCustodian {
            actor_id: "macro|remaining@example.com".into(),
            credential_owner: "remaining-owner".into(),
            grant_id: Uuid::now_v7(),
            grant_generation: 1,
            scopes: vec![],
        }],
    }
}
#[test]
fn custodian_leaving_keeps_shared_mailbox_and_selects_a_consented_replacement() {
    let snapshot = snapshot();
    assert_eq!(
        removal(&snapshot, &actor()),
        InboxRemoval::Detach {
            replace_custodian: true,
            replacement: Some(snapshot.custodians[0].clone())
        }
    );
}
#[test]
fn no_remaining_credential_requires_reconnect_without_destroying_shared_history() {
    let mut snapshot = snapshot();
    snapshot.custodians.clear();
    assert_eq!(
        removal(&snapshot, &actor()),
        InboxRemoval::Detach {
            replace_custodian: true,
            replacement: None
        }
    );
}
#[test]
fn a_removed_delegate_is_not_an_eligible_credential_custodian() {
    let mut snapshot = snapshot();
    snapshot.custodians[0].actor_id = "macro|former@example.com".into();
    assert_eq!(
        removal(&snapshot, &actor()),
        InboxRemoval::Detach {
            replace_custodian: true,
            replacement: None
        }
    );
}
#[test]
fn non_custodian_leaving_does_not_change_credentials() {
    let mut snapshot = snapshot();
    snapshot.credential_owner = "someone-else".into();
    assert_eq!(
        removal(&snapshot, &actor()),
        InboxRemoval::Detach {
            replace_custodian: false,
            replacement: None
        }
    );
}
#[test]
fn last_delegate_removes_a_promoted_mailbox_but_cannot_remove_a_human_owners_mailbox() {
    let mut snapshot = snapshot();
    snapshot.delegates = vec![actor().macro_id.to_string()];
    assert_eq!(removal(&snapshot, &actor()), InboxRemoval::Disconnect);
    snapshot.promoted = false;
    assert!(matches!(
        removal(&snapshot, &actor()),
        InboxRemoval::Detach { .. }
    ));
}
#[test]
fn owner_removes_the_owned_mailbox() {
    let mut snapshot = snapshot();
    snapshot.owner = actor().macro_id.to_string();
    assert_eq!(removal(&snapshot, &actor()), InboxRemoval::Disconnect);
}
