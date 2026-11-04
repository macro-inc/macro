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
