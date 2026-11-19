use super::*;

fn fixtures() -> (
    InitializeMailbox,
    VerifiedMailboxGrant,
    InitializationSnapshot,
) {
    let actor = MacroUserIdStr::try_from("macro|actor@example.com".to_owned()).unwrap();
    let owner = Uuid::now_v7();
    (
        InitializeMailbox {
            attempt: Uuid::now_v7(),
            actor,
            actor_fusion_id: owner,
            force_share: false,
        },
        VerifiedMailboxGrant {
            scopes: vec![
                "User.Read".into(),
                "Mail.ReadWrite".into(),
                "Mail.Send".into(),
            ],
            calendar_requested: false,
            id: Uuid::now_v7(),
            generation: 1,
            owner,
            email: "mailbox@example.com".into(),
            tenant_id: "tenant".into(),
            mailbox_id: "mailbox".into(),
        },
        InitializationSnapshot {
            entitlement: crate::domain::inbox_entitlement::InboxConnectionFacts {
                professional: false,
                accessible_inboxes: 0,
                reconnecting: false,
            },
            existing: Some(ExistingMailbox {
                id: Uuid::now_v7(),
                owner: MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap(),
                grant_id: Some(Uuid::now_v7()),
                grant_generation: 1,
                sync_generation: 1,
                tenant_id: Some("tenant".into()),
                mailbox_id: Some("mailbox".into()),
                actor_has_access: false,
                owner_account_exists: true,
                being_removed: false,
            }),
            account_for_email: None,
        },
    )
}

#[test]
fn another_users_secondary_inbox_requires_explicit_sharing() {
    let (mut request, grant, snapshot) = fixtures();
    assert!(matches!(
        decide(&request, &grant, &snapshot),
        Err(InitializationError::SharingConfirmation { .. })
    ));
    request.force_share = true;
    assert_eq!(
        decide(&request, &grant, &snapshot).unwrap(),
        InitializationDecision::Promote
    );
}

#[test]
fn sharing_consent_cannot_replace_a_different_microsoft_identity() {
    let (mut request, mut grant, snapshot) = fixtures();
    request.force_share = true;
    grant.mailbox_id = "recycled-address".into();
    assert!(matches!(
        decide(&request, &grant, &snapshot),
        Err(InitializationError::IdentityConflict)
    ));
}

#[test]
fn existing_delegate_can_reconnect_without_promoting_the_owner() {
    let (request, grant, mut snapshot) = fixtures();
    snapshot.existing.as_mut().unwrap().actor_has_access = true;
    assert_eq!(
        decide(&request, &grant, &snapshot).unwrap(),
        InitializationDecision::Reconnect
    );
}

#[test]
fn verified_mailbox_account_uses_existing_scoped_delegation() {
    let (request, grant, mut snapshot) = fixtures();
    snapshot.existing.as_mut().unwrap().owner =
        MacroUserIdStr::try_from("macro|mailbox@example.com".to_owned()).unwrap();
    assert_eq!(
        decide(&request, &grant, &snapshot).unwrap(),
        InitializationDecision::Delegate
    );
}

#[test]
fn new_mailbox_uses_existing_macro_identity_without_moving_the_oauth_owner() {
    let (request, grant, mut snapshot) = fixtures();
    snapshot.existing = None;
    let owner = MacroUserIdStr::try_from("macro|mailbox@example.com".to_owned()).unwrap();
    snapshot.account_for_email = Some(owner.clone());
    assert_eq!(
        decide(&request, &grant, &snapshot).unwrap(),
        InitializationDecision::Create { owner }
    );
    assert_eq!(grant.owner, request.actor_fusion_id);
}

#[test]
fn the_addresss_own_account_takes_its_inbox_over_instead_of_sharing_it() {
    let (mut request, mut grant, mut snapshot) = fixtures();
    grant.email = "actor@example.com".into();
    snapshot.account_for_email = Some(request.actor.clone());
    for force_share in [false, true] {
        request.force_share = force_share;
        assert_eq!(
            decide(&request, &grant, &snapshot).unwrap(),
            InitializationDecision::Rehome {
                owner: request.actor.clone()
            }
        );
    }
}

#[test]
fn another_connector_hands_the_inbox_to_the_addresss_account() {
    let (request, grant, mut snapshot) = fixtures();
    let account = MacroUserIdStr::try_from("macro|mailbox@example.com".to_owned()).unwrap();
    snapshot.account_for_email = Some(account.clone());
    assert_eq!(
        decide(&request, &grant, &snapshot).unwrap(),
        InitializationDecision::Rehome { owner: account }
    );
}

#[test]
fn an_inbox_whose_owner_account_is_gone_has_no_one_to_share_with() {
    let (mut request, grant, mut snapshot) = fixtures();
    snapshot.existing.as_mut().unwrap().owner_account_exists = false;
    for force_share in [false, true] {
        request.force_share = force_share;
        assert_eq!(
            decide(&request, &grant, &snapshot).unwrap(),
            InitializationDecision::Rehome {
                owner: request.actor.clone()
            }
        );
    }
    let existing = snapshot.existing.as_mut().unwrap();
    existing.owner = MacroUserIdStr::try_from("macro|mailbox@example.com".to_owned()).unwrap();
    assert_eq!(
        decide(&request, &grant, &snapshot).unwrap(),
        InitializationDecision::Rehome {
            owner: request.actor.clone()
        },
        "an edge to the deleted address account cannot be written"
    );
}

#[test]
fn an_inbox_being_removed_is_neither_shared_nor_reconnected() {
    let (request, grant, mut snapshot) = fixtures();
    let existing = snapshot.existing.as_mut().unwrap();
    existing.being_removed = true;
    existing.owner = request.actor.clone();
    assert!(matches!(
        decide(&request, &grant, &snapshot),
        Err(InitializationError::InboxBeingRemoved)
    ));
}

#[test]
fn a_departing_link_holds_its_address_for_a_different_mailbox_until_it_is_gone() {
    let (request, mut grant, mut snapshot) = fixtures();
    grant.mailbox_id = "recycled-address".into();
    for (being_removed, owner_account_exists) in [(true, true), (false, false)] {
        let existing = snapshot.existing.as_mut().unwrap();
        existing.being_removed = being_removed;
        existing.owner_account_exists = owner_account_exists;
        assert!(matches!(
            decide(&request, &grant, &snapshot),
            Err(InitializationError::InboxBeingRemoved)
        ));
    }
}
