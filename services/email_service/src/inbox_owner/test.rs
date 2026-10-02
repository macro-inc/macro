use super::*;

struct Owners {
    mailbox_profile: Option<InboxOwner>,
    existing_inbox: bool,
    matching_inbox_grant: bool,
    delegated: bool,
    grant_owner: Option<InboxOwner>,
}
impl InboxOwnerRepository for Owners {
    async fn by_email(&self, _: &str) -> Result<Option<InboxOwner>, Report> {
        Ok(self.mailbox_profile.clone())
    }
    async fn has_inbox(&self, _: &str) -> Result<bool, Report> {
        Ok(self.existing_inbox)
    }
    async fn inbox_uses_grant(
        &self,
        _: &str,
        _: &MacroUserIdStr<'_>,
        _: Uuid,
    ) -> Result<bool, Report> {
        Ok(self.matching_inbox_grant)
    }
    async fn already_delegated(&self, _: &str, _: Uuid, _: Uuid) -> Result<bool, Report> {
        Ok(self.delegated)
    }
    async fn by_fusionauth_id(&self, id: Uuid) -> Result<InboxOwner, Report> {
        let owner = self
            .grant_owner
            .clone()
            .ok_or_else(|| rootcause::report!("no owner"))?;
        assert_eq!(owner.fusionauth_id, id);
        Ok(owner)
    }
}
fn owner() -> InboxOwner {
    InboxOwner {
        macro_id: MacroUserIdStr::try_from("macro|older@example.com".to_string()).unwrap(),
        fusionauth_id: Uuid::now_v7(),
    }
}

#[tokio::test]
async fn secondary_mailbox_without_an_inbox_bootstraps_under_its_existing_grant_owner() {
    let owner = owner();
    let service = InboxOwnerService {
        repo: Owners {
            mailbox_profile: None,
            existing_inbox: false,
            matching_inbox_grant: false,
            delegated: false,
            grant_owner: Some(owner.clone()),
        },
    };
    let resolved = service
        .resolve(
            "secondary@example.com",
            Some(owner.fusionauth_id),
            Uuid::now_v7(),
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(resolved.macro_id, owner.macro_id);
    assert_eq!(resolved.fusionauth_id, owner.fusionauth_id);
}

#[tokio::test]
async fn existing_external_inbox_retains_the_sharing_confirmation_flow() {
    let service = InboxOwnerService {
        repo: Owners {
            mailbox_profile: None,
            existing_inbox: true,
            matching_inbox_grant: false,
            delegated: false,
            grant_owner: None,
        },
    };
    assert!(
        service
            .resolve(
                "secondary@example.com",
                Some(Uuid::now_v7()),
                Uuid::now_v7()
            )
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn same_account_and_legacy_callbacks_keep_the_data_source_flow() {
    let requester = Uuid::now_v7();
    let service = InboxOwnerService {
        repo: Owners {
            mailbox_profile: None,
            existing_inbox: false,
            matching_inbox_grant: false,
            delegated: false,
            grant_owner: None,
        },
    };
    for grant_owner in [None, Some(requester)] {
        assert!(
            service
                .resolve("secondary@example.com", grant_owner, requester)
                .await
                .unwrap()
                .is_none()
        );
    }
}

#[tokio::test]
async fn a_missing_grant_owner_profile_does_not_fall_back_to_the_requester() {
    let service = InboxOwnerService {
        repo: Owners {
            mailbox_profile: None,
            existing_inbox: false,
            matching_inbox_grant: false,
            delegated: false,
            grant_owner: None,
        },
    };
    assert!(
        service
            .resolve(
                "secondary@example.com",
                Some(Uuid::now_v7()),
                Uuid::now_v7()
            )
            .await
            .is_err()
    );
}

#[tokio::test]
async fn a_mailbox_with_its_own_profile_retains_its_existing_owner() {
    let owner = owner();
    let service = InboxOwnerService {
        repo: Owners {
            mailbox_profile: Some(owner.clone()),
            existing_inbox: false,
            matching_inbox_grant: false,
            delegated: false,
            grant_owner: None,
        },
    };
    for grant_owner in [None, Some(owner.fusionauth_id)] {
        let result = service
            .resolve("older@example.com", grant_owner, Uuid::now_v7())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(result.macro_id, owner.macro_id);
        assert_eq!(result.fusionauth_id, owner.fusionauth_id);
    }
}

#[tokio::test]
async fn a_mailbox_profile_cannot_override_a_different_verified_grant_owner() {
    let profile = owner();
    let grant_owner = owner();
    for existing_inbox in [false, true] {
        let service = InboxOwnerService {
            repo: Owners {
                mailbox_profile: Some(profile.clone()),
                existing_inbox,
                matching_inbox_grant: false,
                delegated: true,
                grant_owner: Some(grant_owner.clone()),
            },
        };
        assert!(
            service
                .resolve(
                    "older@example.com",
                    Some(grant_owner.fusionauth_id),
                    Uuid::now_v7(),
                )
                .await
                .is_err()
        );
    }
}

#[tokio::test]
async fn a_shared_inbox_can_reconnect_before_its_grant_is_relocated() {
    let profile = owner();
    let grant_owner = owner();
    let service = InboxOwnerService {
        repo: Owners {
            mailbox_profile: Some(profile.clone()),
            existing_inbox: true,
            matching_inbox_grant: true,
            delegated: true,
            grant_owner: Some(grant_owner.clone()),
        },
    };
    let resolved = service
        .resolve(
            "older@example.com",
            Some(grant_owner.fusionauth_id),
            Uuid::now_v7(),
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(resolved.macro_id, profile.macro_id);
    assert_eq!(resolved.fusionauth_id, profile.fusionauth_id);
}

#[tokio::test]
async fn reconnecting_an_already_delegated_mailbox_does_not_promote_it() {
    let owner = owner();
    let service = InboxOwnerService {
        repo: Owners {
            mailbox_profile: None,
            existing_inbox: true,
            matching_inbox_grant: false,
            delegated: true,
            grant_owner: Some(owner.clone()),
        },
    };
    let resolved = service
        .resolve(
            "secondary@example.com",
            Some(owner.fusionauth_id),
            Uuid::now_v7(),
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(resolved.fusionauth_id, owner.fusionauth_id);
}
