use super::*;
use std::sync::Mutex;

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

struct FakeLifecycleRepository {
    bindings: Vec<DeletedUserBinding>,
    state: Mutex<LifecycleState>,
}

struct LifecycleState {
    snapshots: Vec<InboxLifecycleSnapshot>,
    snapshot_calls: Vec<Uuid>,
    removals: Vec<(InboxLifecycleSnapshot, String, InboxRemoval)>,
}

impl InboxLifecycleRepository for FakeLifecycleRepository {
    async fn snapshot(&self, link: Uuid) -> Result<InboxLifecycleSnapshot, InboxLifecycleError> {
        let mut state = self.state.lock().unwrap();
        state.snapshot_calls.push(link);
        state
            .snapshots
            .iter()
            .find(|snapshot| snapshot.link_id == link)
            .cloned()
            .ok_or(InboxLifecycleError::NotFound)
    }

    async fn remove(
        &self,
        actor: &InboxActor,
        expected: &InboxLifecycleSnapshot,
        decision: &InboxRemoval,
        reason: DeletionReason,
    ) -> Result<(), InboxLifecycleError> {
        assert!(matches!(reason, DeletionReason::UserDeleted));
        let mut state = self.state.lock().unwrap();
        let current = state
            .snapshots
            .iter_mut()
            .find(|snapshot| snapshot.link_id == expected.link_id)
            .unwrap();
        assert_eq!(current, expected);
        if !current.disconnecting {
            current
                .delegates
                .retain(|delegate| delegate != actor.macro_id.as_ref());
            match decision {
                InboxRemoval::Disconnect => {
                    current.disconnecting = true;
                    current.custodians.clear();
                }
                InboxRemoval::Detach {
                    replace_custodian,
                    replacement,
                } => {
                    current
                        .custodians
                        .retain(|custodian| custodian.actor_id != actor.macro_id.as_ref());
                    if *replace_custodian {
                        current.sync_generation += 1;
                        current.grant_id = replacement.as_ref().map(|custodian| custodian.grant_id);
                        if let Some(replacement) = replacement {
                            current.credential_owner = replacement.credential_owner.clone();
                            current.grant_generation = replacement.grant_generation;
                        } else {
                            current.grant_generation += 1;
                        }
                    }
                }
            }
        }
        state.removals.push((
            expected.clone(),
            actor.macro_id.to_string(),
            decision.clone(),
        ));
        Ok(())
    }

    async fn bindings_for_deleted_user(
        &self,
        owner: &str,
    ) -> Result<Vec<DeletedUserBinding>, InboxLifecycleError> {
        assert!(
            self.bindings
                .iter()
                .all(|binding| binding.actor.credential_owner == owner)
        );
        Ok(self.bindings.clone())
    }

    async fn resync(
        &self,
        _: &InboxActor,
        _: &InboxLifecycleSnapshot,
    ) -> Result<InboxResync, InboxLifecycleError> {
        panic!("deleted_user must not resync")
    }

    async fn ready_for_delete(&self, _: Uuid) -> Result<bool, InboxLifecycleError> {
        panic!("deleted_user must not check physical deletion")
    }

    async fn claim_effect(&self, _: Uuid) -> Result<Option<InboxLifecycleLease>, MailboxError> {
        panic!("deleted_user must not publish effects")
    }

    async fn finish_effect(&self, _: &InboxLifecycleLease, _: bool) -> Result<(), MailboxError> {
        panic!("deleted_user must not finish effects")
    }
}

struct UnusedEffects;

impl InboxLifecycleEffects for UnusedEffects {
    async fn apply(&self, _: Uuid, _: &InboxLifecycleEffect) -> Result<(), MailboxError> {
        panic!("deleted_user must not apply effects")
    }
}

async fn assert_double_match_removal(with_replacement: bool) {
    for owner_first in [true, false] {
        let mut before = snapshot();
        before.promoted = false;
        before.owner = "macro|a-owner@example.com".into();
        let replacement = with_replacement.then(|| before.custodians[0].clone());
        before.custodians = vec![MailboxCustodian {
            actor_id: actor().macro_id.to_string(),
            credential_owner: "leaving-owner".into(),
            grant_id: before.grant_id.unwrap(),
            grant_generation: 1,
            scopes: vec![],
        }];
        before.custodians.extend(replacement.clone());
        let custodian = DeletedUserBinding {
            actor: actor(),
            link_id: before.link_id,
            kind: DeletedUserBindingKind::Custodian,
        };
        let owner = DeletedUserBinding {
            actor: InboxActor {
                macro_id: MacroUserIdStr::try_from(before.owner.clone()).unwrap(),
                credential_owner: "leaving-owner".into(),
            },
            link_id: before.link_id,
            kind: DeletedUserBindingKind::Owner,
        };
        let repo = FakeLifecycleRepository {
            bindings: if owner_first {
                vec![owner, custodian]
            } else {
                vec![custodian, owner]
            },
            state: Mutex::new(LifecycleState {
                snapshots: vec![before.clone()],
                snapshot_calls: vec![],
                removals: vec![],
            }),
        };
        let service = InboxLifecycleService::new(repo, UnusedEffects);

        service.deleted_user("leaving-owner").await.unwrap();

        let state = service.repo.state.lock().unwrap();
        let [
            (first, first_actor, first_decision),
            (second, second_actor, second_decision),
        ] = state.removals.as_slice()
        else {
            panic!("both bindings must be processed")
        };
        assert_eq!(first, &before);
        assert_eq!(first_actor, actor().macro_id.as_ref());
        assert_eq!(
            first_decision,
            &InboxRemoval::Detach {
                replace_custodian: true,
                replacement: replacement.clone(),
            }
        );
        assert_eq!(second_actor, &before.owner);
        assert_eq!(second_decision, &InboxRemoval::Disconnect);
        assert!(!second.disconnecting);
        assert_eq!(second.sync_generation, 2);
        assert_eq!(
            second.grant_id,
            replacement.as_ref().map(|custodian| custodian.grant_id)
        );
        assert_eq!(
            second.credential_owner,
            if with_replacement {
                "remaining-owner"
            } else {
                "leaving-owner"
            }
        );
        assert_eq!(
            second.grant_generation,
            if with_replacement { 1 } else { 2 }
        );
        assert_eq!(
            second.custodians,
            replacement.into_iter().collect::<Vec<_>>()
        );
        assert!(!second.delegates.contains(&actor().macro_id.to_string()));
    }
}

#[tokio::test]
async fn deleted_user_rebinds_custodian_before_owner_in_either_repository_order() {
    assert_double_match_removal(true).await;
}

#[tokio::test]
async fn deleted_user_marks_reauthentication_before_owner_in_either_repository_order() {
    assert_double_match_removal(false).await;
}

#[tokio::test]
async fn deleted_user_single_binding_keeps_existing_removal_decision() {
    for kind in [
        DeletedUserBindingKind::Custodian,
        DeletedUserBindingKind::Owner,
    ] {
        let mut before = snapshot();
        before.promoted = false;
        let leaving = if kind == DeletedUserBindingKind::Custodian {
            actor()
        } else {
            InboxActor {
                macro_id: MacroUserIdStr::try_from(before.owner.clone()).unwrap(),
                credential_owner: "leaving-owner".into(),
            }
        };
        let expected = if kind == DeletedUserBindingKind::Custodian {
            InboxRemoval::Detach {
                replace_custodian: true,
                replacement: Some(before.custodians[0].clone()),
            }
        } else {
            InboxRemoval::Disconnect
        };
        let expected_actor = leaving.macro_id.to_string();
        let repo = FakeLifecycleRepository {
            bindings: vec![DeletedUserBinding {
                actor: leaving,
                link_id: before.link_id,
                kind,
            }],
            state: Mutex::new(LifecycleState {
                snapshots: vec![before.clone()],
                snapshot_calls: vec![],
                removals: vec![],
            }),
        };
        let service = InboxLifecycleService::new(repo, UnusedEffects);

        service.deleted_user("leaving-owner").await.unwrap();

        assert_eq!(
            service.repo.state.lock().unwrap().removals,
            vec![(before, expected_actor, expected)]
        );
    }
}

#[tokio::test]
async fn deleted_user_same_actor_in_both_roles_matches_single_binding_calls() {
    let mut before = snapshot();
    before.promoted = false;
    before.owner = actor().macro_id.to_string();
    before.custodians.push(MailboxCustodian {
        actor_id: before.owner.clone(),
        credential_owner: "leaving-owner".into(),
        grant_id: before.grant_id.unwrap(),
        grant_generation: 1,
        scopes: vec![],
    });
    for kinds in [
        vec![DeletedUserBindingKind::Custodian],
        vec![DeletedUserBindingKind::Owner],
        vec![
            DeletedUserBindingKind::Custodian,
            DeletedUserBindingKind::Owner,
        ],
        vec![
            DeletedUserBindingKind::Owner,
            DeletedUserBindingKind::Custodian,
        ],
    ] {
        let repo = FakeLifecycleRepository {
            bindings: kinds
                .into_iter()
                .map(|kind| DeletedUserBinding {
                    actor: actor(),
                    link_id: before.link_id,
                    kind,
                })
                .collect(),
            state: Mutex::new(LifecycleState {
                snapshots: vec![before.clone()],
                snapshot_calls: vec![],
                removals: vec![],
            }),
        };
        let service = InboxLifecycleService::new(repo, UnusedEffects);

        service.deleted_user("leaving-owner").await.unwrap();

        let state = service.repo.state.lock().unwrap();
        assert_eq!(state.snapshot_calls, vec![before.link_id]);
        assert_eq!(
            state.removals,
            vec![(
                before.clone(),
                before.owner.clone(),
                InboxRemoval::Disconnect
            )]
        );
    }
}

#[tokio::test]
async fn deleted_user_orders_links_then_binding_kind_then_actors() {
    let mut first = snapshot();
    first.link_id = Uuid::from_u128(1);
    let mut second = first.clone();
    second.link_id = Uuid::from_u128(2);
    let bindings = vec![
        (
            second.link_id,
            "macro|leaving@example.com",
            DeletedUserBindingKind::Custodian,
        ),
        (
            first.link_id,
            "macro|shared@example.com",
            DeletedUserBindingKind::Owner,
        ),
        (
            first.link_id,
            "macro|z-custodian@example.com",
            DeletedUserBindingKind::Custodian,
        ),
        (
            first.link_id,
            "macro|leaving@example.com",
            DeletedUserBindingKind::Custodian,
        ),
        (
            first.link_id,
            "macro|leaving@example.com",
            DeletedUserBindingKind::Owner,
        ),
    ]
    .into_iter()
    .map(|(link_id, actor_id, kind)| DeletedUserBinding {
        actor: InboxActor {
            macro_id: MacroUserIdStr::parse_from_str(actor_id).unwrap(),
            credential_owner: "leaving-owner".into(),
        },
        link_id,
        kind,
    })
    .collect();
    let repo = FakeLifecycleRepository {
        bindings,
        state: Mutex::new(LifecycleState {
            snapshots: vec![first, second],
            snapshot_calls: vec![],
            removals: vec![],
        }),
    };
    let service = InboxLifecycleService::new(repo, UnusedEffects);

    service.deleted_user("leaving-owner").await.unwrap();

    let state = service.repo.state.lock().unwrap();
    let order: Vec<_> = state
        .removals
        .iter()
        .map(|(snapshot, actor, _)| (snapshot.link_id, actor.as_str()))
        .collect();
    assert_eq!(
        order,
        vec![
            (Uuid::from_u128(1), "macro|leaving@example.com"),
            (Uuid::from_u128(1), "macro|z-custodian@example.com"),
            (Uuid::from_u128(1), "macro|shared@example.com"),
            (Uuid::from_u128(2), "macro|leaving@example.com"),
        ]
    );
}
