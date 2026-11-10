use std::sync::{Arc, Mutex};

use chrono::Duration;
use macro_user_id::user_id::MacroUserIdStr;

use super::*;
use crate::domain::{
    models::{PairingClaimFacts, ReportedWorkspaceKind},
    ports::{OpenPairingCounts, PairingRow},
};

const TEAMMATE_ID: &str = "macro|teammate@example.com";
const OTHER_TEAM_ID: Uuid = Uuid::from_u128(8);

const OWNER_ID: &str = "macro|owner@example.com";
const MEMBER_ID: &str = "macro|member@example.com";
const CODE: &str = "KX7M-4QHD";
const TEAM_ID: Uuid = Uuid::from_u128(7);

fn caller(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_string()).unwrap()
}

fn harness(owner: HarnessOwner) -> Harness {
    Harness {
        allow_permission_bypass: false,
        id: HarnessId::TEST_A,
        kind: "macrod".to_owned(),
        name: "erics-macbook".to_owned(),
        owner,
        created_by: OWNER_ID.to_owned(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        connected: false,
        last_connected_at: None,
        workspace_path: None,
        reported_workspaces: Vec::new(),
    }
}

fn pending_pairing() -> PairingRow {
    PairingRow {
        details: PairingDetails {
            code: CODE.to_owned(),
            requested_name: "erics-macbook".to_owned(),
            host: Some("eric@macbook / darwin".to_owned()),
            created_at: Utc::now(),
            expires_at: Utc::now() + Duration::minutes(10),
        },
        status: PairingStatus::Pending,
    }
}

#[derive(Debug, Default)]
struct Calls {
    inserted_pairings: Vec<NewPairing>,
    approved: Vec<(String, NewHarness)>,
    claimed: Vec<Uuid>,
    deleted: Vec<HarnessId>,
    updated: Vec<(HarnessId, HarnessChanges)>,
    owner_checks: Vec<HarnessOwner>,
    team_lookups: Vec<(String, Uuid)>,
    reported: Vec<(HarnessId, Vec<ReportedWorkspace>)>,
}

#[derive(Clone, Default)]
struct FakeRepo {
    open_counts: OpenPairingCountsConfig,
    insert_conflicts: usize,
    pairing: Option<PairingRow>,
    claim_facts: Option<PairingClaimFacts>,
    approve_result: Option<Harness>,
    claim_result: Option<Harness>,
    harness: Option<Harness>,
    delete_result: bool,
    user_has_team: bool,
    user_owns_team: bool,
    bound_agents: Vec<BoundAgentFacts>,
    calls: Arc<Mutex<Calls>>,
}

#[derive(Clone, Copy, Debug, Default)]
struct OpenPairingCountsConfig {
    total: i64,
    with_same_name: i64,
}

impl HarnessRepo for FakeRepo {
    type Err = anyhow::Error;

    async fn insert_pairing(&self, pairing: NewPairing) -> Result<bool, Self::Err> {
        let mut calls = self.calls.lock().unwrap();
        calls.inserted_pairings.push(pairing);
        Ok(calls.inserted_pairings.len() > self.insert_conflicts)
    }

    async fn delete_expired_pairings(&self) -> Result<(), Self::Err> {
        Ok(())
    }

    async fn count_open_pairings(&self, _name: &str) -> Result<OpenPairingCounts, Self::Err> {
        Ok(OpenPairingCounts {
            total: self.open_counts.total,
            with_same_name: self.open_counts.with_same_name,
        })
    }

    async fn get_pairing(&self, _code: &str) -> Result<Option<PairingRow>, Self::Err> {
        Ok(self.pairing.clone())
    }

    async fn approve_pairing(
        &self,
        code: &str,
        harness: NewHarness,
    ) -> Result<Option<Harness>, Self::Err> {
        self.calls
            .lock()
            .unwrap()
            .approved
            .push((code.to_owned(), harness));
        Ok(self.approve_result.clone())
    }

    async fn pairing_claim_facts(
        &self,
        _pairing_id: Uuid,
    ) -> Result<Option<PairingClaimFacts>, Self::Err> {
        Ok(self.claim_facts.clone())
    }

    async fn claim_pairing(
        &self,
        pairing_id: Uuid,
        _token_id: Uuid,
        _token: HashedHarnessToken,
    ) -> Result<Option<Harness>, Self::Err> {
        self.calls.lock().unwrap().claimed.push(pairing_id);
        Ok(self.claim_result.clone())
    }

    async fn list_visible_harnesses(
        &self,
        _caller: MacroUserIdStr<'static>,
    ) -> Result<Vec<Harness>, Self::Err> {
        Ok(self.harness.clone().into_iter().collect())
    }

    async fn get_harness(&self, _harness_id: HarnessId) -> Result<Option<Harness>, Self::Err> {
        Ok(self.harness.clone())
    }

    async fn update_harness(
        &self,
        managed: &ManagedHarness,
        changes: HarnessChanges,
    ) -> Result<HarnessUpdate, Self::Err> {
        if let Some(owner) = &changes.owner {
            self.calls.lock().unwrap().owner_checks.push(owner.clone());
            let stranded = agents_stranded_by(owner, self.bound_agents.clone());
            if !stranded.is_empty() {
                return Ok(HarnessUpdate::OwnerChangeBlocked(stranded));
            }
        }
        self.calls
            .lock()
            .unwrap()
            .updated
            .push((managed.harness().id, changes.clone()));
        let harness = managed.harness().clone();
        Ok(HarnessUpdate::Updated(Harness {
            name: changes.name.unwrap_or(harness.name),
            allow_permission_bypass: changes
                .allow_permission_bypass
                .unwrap_or(harness.allow_permission_bypass),
            owner: changes.owner.unwrap_or(harness.owner),
            workspace_path: match changes.workspace {
                Some(RequestedHarnessWorkspace::Path { path }) => Some(path),
                Some(RequestedHarnessWorkspace::Local) => None,
                None => harness.workspace_path.clone(),
            },
            ..harness
        }))
    }

    async fn replace_reported_workspaces(
        &self,
        harness_id: HarnessId,
        workspaces: Vec<ReportedWorkspace>,
    ) -> Result<bool, Self::Err> {
        self.calls
            .lock()
            .unwrap()
            .reported
            .push((harness_id, workspaces));
        Ok(self.harness.is_some())
    }

    async fn delete_harness(&self, harness_id: HarnessId) -> Result<bool, Self::Err> {
        self.calls.lock().unwrap().deleted.push(harness_id);
        Ok(self.delete_result)
    }

    async fn user_has_team(
        &self,
        caller: MacroUserIdStr<'static>,
        team_id: Uuid,
    ) -> Result<bool, Self::Err> {
        self.calls
            .lock()
            .unwrap()
            .team_lookups
            .push((caller.as_ref().to_owned(), team_id));
        Ok(self.user_has_team)
    }

    async fn user_owns_team(
        &self,
        _caller: MacroUserIdStr<'static>,
        _team_id: Uuid,
    ) -> Result<bool, Self::Err> {
        Ok(self.user_owns_team)
    }

    async fn list_bound_agents(
        &self,
        _harness_id: HarnessId,
    ) -> Result<Vec<HarnessAgent>, Self::Err> {
        Ok(Vec::new())
    }

    async fn list_sessions(
        &self,
        _harness_id: HarnessId,
    ) -> Result<Vec<HarnessSession>, Self::Err> {
        Ok(Vec::new())
    }
}

fn service(repo: FakeRepo) -> HarnessServiceImpl<FakeRepo> {
    HarnessServiceImpl::new(repo)
}

#[tokio::test]
async fn creating_a_pairing_returns_code_and_secret_and_persists_only_hashes() {
    let repo = FakeRepo::default();
    let created = service(repo.clone())
        .create_pairing(CreatePairingRequest {
            name: "  erics-macbook  ".to_owned(),
            host: Some("eric@macbook".to_owned()),
        })
        .await
        .unwrap();

    assert_eq!(created.code.len(), 9);
    assert!(!created.device_secret.is_empty());
    assert!(created.expires_at > Utc::now());

    let calls = repo.calls.lock().unwrap();
    let inserted = &calls.inserted_pairings[0];
    assert_eq!(inserted.requested_name, "erics-macbook");
    assert_eq!(inserted.code, created.code);
    assert_eq!(
        inserted.device_secret_hash,
        harness_token::hash_token(&created.device_secret)
    );
}

#[tokio::test]
async fn pairing_creation_retries_code_collisions() {
    let repo = FakeRepo {
        insert_conflicts: 2,
        ..FakeRepo::default()
    };
    let created = service(repo.clone())
        .create_pairing(CreatePairingRequest {
            name: "erics-macbook".to_owned(),
            host: None,
        })
        .await
        .unwrap();

    let calls = repo.calls.lock().unwrap();
    assert_eq!(calls.inserted_pairings.len(), 3);
    assert_eq!(calls.inserted_pairings[2].code, created.code);
}

#[tokio::test]
async fn pairing_creation_is_throttled_and_validates_the_name() {
    let throttled = FakeRepo {
        open_counts: OpenPairingCountsConfig {
            total: MAX_OPEN_PAIRINGS,
            with_same_name: 0,
        },
        ..FakeRepo::default()
    };
    let result = service(throttled)
        .create_pairing(CreatePairingRequest {
            name: "erics-macbook".to_owned(),
            host: None,
        })
        .await;
    assert!(matches!(result, Err(HarnessError::Throttled)));

    let result = service(FakeRepo::default())
        .create_pairing(CreatePairingRequest {
            name: "   ".to_owned(),
            host: None,
        })
        .await;
    assert!(matches!(result, Err(HarnessError::BadRequest(_))));
}

#[tokio::test]
async fn pairing_lookup_normalizes_codes_and_reports_state() {
    let repo = FakeRepo {
        pairing: Some(pending_pairing()),
        ..FakeRepo::default()
    };
    let details = service(repo).get_pairing("kx7m 4qhd").await.unwrap();
    assert_eq!(details.requested_name, "erics-macbook");

    let missing = service(FakeRepo::default()).get_pairing(CODE).await;
    assert!(matches!(missing, Err(HarnessError::NotFound(_))));

    let mut expired = pending_pairing();
    expired.details.expires_at = Utc::now() - Duration::minutes(1);
    let repo = FakeRepo {
        pairing: Some(expired),
        ..FakeRepo::default()
    };
    assert!(matches!(
        service(repo).get_pairing(CODE).await,
        Err(HarnessError::Gone(_))
    ));

    let mut approved = pending_pairing();
    approved.status = PairingStatus::Approved;
    let repo = FakeRepo {
        pairing: Some(approved),
        ..FakeRepo::default()
    };
    assert!(matches!(
        service(repo).get_pairing(CODE).await,
        Err(HarnessError::Gone(_))
    ));

    assert!(matches!(
        service(FakeRepo::default()).get_pairing("nope").await,
        Err(HarnessError::BadRequest(_))
    ));
}

#[tokio::test]
async fn approval_registers_a_private_harness_for_the_caller() {
    let repo = FakeRepo {
        pairing: Some(pending_pairing()),
        approve_result: Some(harness(HarnessOwner::User {
            user_id: OWNER_ID.to_owned(),
        })),
        ..FakeRepo::default()
    };
    let approved = service(repo.clone())
        .approve_pairing(
            caller(OWNER_ID),
            "kx7m4qhd",
            ApprovePairingRequest {
                allow_permission_bypass: false,
                name: None,
                team_id: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(approved.name, "erics-macbook");

    let calls = repo.calls.lock().unwrap();
    let (code, new_harness) = &calls.approved[0];
    assert_eq!(code, CODE);
    assert_eq!(new_harness.name, "erics-macbook");
    assert_eq!(
        new_harness.owner,
        HarnessOwner::User {
            user_id: OWNER_ID.to_owned()
        }
    );
    assert_eq!(new_harness.created_by.as_ref(), OWNER_ID);
    assert!(!new_harness.allow_permission_bypass);
    assert!(calls.team_lookups.is_empty());
}

#[tokio::test]
async fn team_approval_requires_membership_and_honors_the_name_override() {
    let repo = FakeRepo {
        pairing: Some(pending_pairing()),
        approve_result: Some(harness(HarnessOwner::Team { team_id: TEAM_ID })),
        user_has_team: true,
        ..FakeRepo::default()
    };
    service(repo.clone())
        .approve_pairing(
            caller(MEMBER_ID),
            CODE,
            ApprovePairingRequest {
                allow_permission_bypass: false,
                name: Some("team box".to_owned()),
                team_id: Some(TEAM_ID),
            },
        )
        .await
        .unwrap();

    let calls = repo.calls.lock().unwrap();
    let (_, new_harness) = &calls.approved[0];
    assert_eq!(new_harness.name, "team box");
    assert_eq!(new_harness.owner, HarnessOwner::Team { team_id: TEAM_ID });
    assert_eq!(calls.team_lookups[0], (MEMBER_ID.to_owned(), TEAM_ID));

    let repo = FakeRepo {
        pairing: Some(pending_pairing()),
        user_has_team: false,
        ..FakeRepo::default()
    };
    let result = service(repo)
        .approve_pairing(
            caller(MEMBER_ID),
            CODE,
            ApprovePairingRequest {
                allow_permission_bypass: false,
                name: None,
                team_id: Some(TEAM_ID),
            },
        )
        .await;
    assert!(matches!(result, Err(HarnessError::Unauthorized)));
}

#[tokio::test]
async fn approval_race_reports_gone() {
    let repo = FakeRepo {
        pairing: Some(pending_pairing()),
        approve_result: None,
        ..FakeRepo::default()
    };
    let result = service(repo)
        .approve_pairing(
            caller(OWNER_ID),
            CODE,
            ApprovePairingRequest {
                allow_permission_bypass: false,
                name: None,
                team_id: None,
            },
        )
        .await;
    assert!(matches!(result, Err(HarnessError::Gone(_))));
}

fn claim_facts(status: PairingStatus, secret: &str) -> PairingClaimFacts {
    PairingClaimFacts {
        device_secret_hash: harness_token::hash_token(secret),
        status,
        expires_at: Utc::now() + Duration::minutes(10),
        harness_id: Some(HarnessId::TEST_A),
    }
}

#[tokio::test]
async fn claim_verifies_the_secret_then_walks_pending_to_claimed() {
    let secret = "device-secret";
    let pairing_id = Uuid::new_v4();

    let repo = FakeRepo {
        claim_facts: Some(claim_facts(PairingStatus::Pending, secret)),
        ..FakeRepo::default()
    };
    let outcome = service(repo)
        .claim_pairing(
            pairing_id,
            ClaimPairingRequest {
                device_secret: secret.to_owned(),
            },
        )
        .await
        .unwrap();
    assert!(matches!(outcome, ClaimOutcome::Pending));

    let repo = FakeRepo {
        claim_facts: Some(claim_facts(PairingStatus::Approved, secret)),
        claim_result: Some(harness(HarnessOwner::User {
            user_id: OWNER_ID.to_owned(),
        })),
        ..FakeRepo::default()
    };
    let outcome = service(repo.clone())
        .claim_pairing(
            pairing_id,
            ClaimPairingRequest {
                device_secret: secret.to_owned(),
            },
        )
        .await
        .unwrap();
    let ClaimOutcome::Claimed(claimed) = outcome else {
        panic!("expected a claimed outcome");
    };
    assert!(claimed.token.starts_with("mhns_"));
    assert_eq!(repo.calls.lock().unwrap().claimed, [pairing_id]);
}

#[tokio::test]
async fn claim_rejects_bad_secrets_and_dead_pairings() {
    let secret = "device-secret";
    let pairing_id = Uuid::new_v4();

    let repo = FakeRepo {
        claim_facts: Some(claim_facts(PairingStatus::Approved, secret)),
        ..FakeRepo::default()
    };
    let result = service(repo)
        .claim_pairing(
            pairing_id,
            ClaimPairingRequest {
                device_secret: "wrong".to_owned(),
            },
        )
        .await;
    assert!(matches!(result, Err(HarnessError::Unauthorized)));

    let repo = FakeRepo {
        claim_facts: Some(claim_facts(PairingStatus::Claimed, secret)),
        ..FakeRepo::default()
    };
    let result = service(repo)
        .claim_pairing(
            pairing_id,
            ClaimPairingRequest {
                device_secret: secret.to_owned(),
            },
        )
        .await;
    assert!(matches!(result, Err(HarnessError::Gone(_))));

    let mut expired = claim_facts(PairingStatus::Pending, secret);
    expired.expires_at = Utc::now() - Duration::minutes(1);
    let repo = FakeRepo {
        claim_facts: Some(expired),
        ..FakeRepo::default()
    };
    let result = service(repo)
        .claim_pairing(
            pairing_id,
            ClaimPairingRequest {
                device_secret: secret.to_owned(),
            },
        )
        .await;
    assert!(matches!(result, Err(HarnessError::Gone(_))));

    let result = service(FakeRepo::default())
        .claim_pairing(
            pairing_id,
            ClaimPairingRequest {
                device_secret: secret.to_owned(),
            },
        )
        .await;
    assert!(matches!(result, Err(HarnessError::NotFound(_))));
}

#[tokio::test]
async fn private_harnesses_are_deletable_only_by_their_owner() {
    let repo = FakeRepo {
        harness: Some(harness(HarnessOwner::User {
            user_id: OWNER_ID.to_owned(),
        })),
        delete_result: true,
        ..FakeRepo::default()
    };
    service(repo.clone())
        .delete_harness(caller(OWNER_ID), HarnessId::TEST_A)
        .await
        .unwrap();
    assert_eq!(repo.calls.lock().unwrap().deleted, [HarnessId::TEST_A]);

    let repo = FakeRepo {
        harness: Some(harness(HarnessOwner::User {
            user_id: OWNER_ID.to_owned(),
        })),
        ..FakeRepo::default()
    };
    let result = service(repo)
        .delete_harness(caller(MEMBER_ID), HarnessId::TEST_A)
        .await;
    assert!(matches!(result, Err(HarnessError::Unauthorized)));
}

#[tokio::test]
async fn team_harnesses_are_deletable_by_their_registrant_or_the_team_owner() {
    // The registrant.
    let repo = FakeRepo {
        harness: Some(harness(HarnessOwner::Team { team_id: TEAM_ID })),
        delete_result: true,
        ..FakeRepo::default()
    };
    service(repo)
        .delete_harness(caller(OWNER_ID), HarnessId::TEST_A)
        .await
        .unwrap();

    // The team owner.
    let repo = FakeRepo {
        harness: Some(harness(HarnessOwner::Team { team_id: TEAM_ID })),
        delete_result: true,
        user_owns_team: true,
        ..FakeRepo::default()
    };
    service(repo)
        .delete_harness(caller(MEMBER_ID), HarnessId::TEST_A)
        .await
        .unwrap();

    // A plain member who did not register it.
    let repo = FakeRepo {
        harness: Some(harness(HarnessOwner::Team { team_id: TEAM_ID })),
        user_has_team: true,
        ..FakeRepo::default()
    };
    let result = service(repo)
        .delete_harness(caller(MEMBER_ID), HarnessId::TEST_A)
        .await;
    assert!(matches!(result, Err(HarnessError::Unauthorized)));

    let result = service(FakeRepo::default())
        .delete_harness(caller(OWNER_ID), HarnessId::TEST_A)
        .await;
    assert!(matches!(result, Err(HarnessError::NotFound(_))));
}

#[tokio::test]
async fn approval_records_explicit_permission_bypass_consent() {
    let repo = FakeRepo {
        pairing: Some(pending_pairing()),
        approve_result: Some(harness(HarnessOwner::User {
            user_id: OWNER_ID.to_owned(),
        })),
        ..FakeRepo::default()
    };
    service(repo.clone())
        .approve_pairing(
            caller(OWNER_ID),
            CODE,
            ApprovePairingRequest {
                name: None,
                team_id: None,
                allow_permission_bypass: true,
            },
        )
        .await
        .unwrap();
    assert!(
        repo.calls.lock().unwrap().approved[0]
            .1
            .allow_permission_bypass
    );
}

#[tokio::test]
async fn a_manager_changes_bypass_and_name_on_the_web() {
    let repo = FakeRepo {
        harness: Some(harness(HarnessOwner::User {
            user_id: OWNER_ID.to_owned(),
        })),
        ..FakeRepo::default()
    };
    let updated = service(repo.clone())
        .patch_harness(
            caller(OWNER_ID),
            HarnessId::TEST_A,
            PatchHarnessRequest {
                name: Some("  studio  ".to_owned()),
                allow_permission_bypass: Some(true),
                owner: None,
                workspace: None,
            },
        )
        .await
        .unwrap();

    assert!(updated.allow_permission_bypass);
    assert_eq!(updated.name, "studio");
    assert_eq!(
        repo.calls.lock().unwrap().updated,
        [(
            HarnessId::TEST_A,
            HarnessChanges {
                name: Some("studio".to_owned()),
                allow_permission_bypass: Some(true),
                owner: None,
                workspace: None,
            }
        )]
    );
}

#[tokio::test]
async fn an_empty_patch_writes_nothing() {
    let repo = FakeRepo {
        harness: Some(harness(HarnessOwner::User {
            user_id: OWNER_ID.to_owned(),
        })),
        ..FakeRepo::default()
    };
    let unchanged = service(repo.clone())
        .patch_harness(
            caller(OWNER_ID),
            HarnessId::TEST_A,
            PatchHarnessRequest::default(),
        )
        .await
        .unwrap();

    assert_eq!(unchanged.name, "erics-macbook");
    assert!(repo.calls.lock().unwrap().updated.is_empty());
}

#[tokio::test]
async fn a_patch_rejects_a_blank_name() {
    let repo = FakeRepo {
        harness: Some(harness(HarnessOwner::User {
            user_id: OWNER_ID.to_owned(),
        })),
        ..FakeRepo::default()
    };
    let result = service(repo.clone())
        .patch_harness(
            caller(OWNER_ID),
            HarnessId::TEST_A,
            PatchHarnessRequest {
                name: Some("   ".to_owned()),
                allow_permission_bypass: None,
                owner: None,
                workspace: None,
            },
        )
        .await;

    assert!(matches!(result, Err(HarnessError::BadRequest(_))));
    assert!(repo.calls.lock().unwrap().updated.is_empty());
}

#[tokio::test]
async fn only_a_harness_manager_may_patch() {
    for (owner, caller_id, allowed) in [
        (
            HarnessOwner::User {
                user_id: OWNER_ID.to_owned(),
            },
            MEMBER_ID,
            false,
        ),
        (HarnessOwner::Team { team_id: TEAM_ID }, MEMBER_ID, false),
        (HarnessOwner::Team { team_id: TEAM_ID }, OWNER_ID, true),
    ] {
        let repo = FakeRepo {
            harness: Some(harness(owner.clone())),
            ..FakeRepo::default()
        };
        let result = service(repo.clone())
            .patch_harness(
                caller(caller_id),
                HarnessId::TEST_A,
                PatchHarnessRequest {
                    name: None,
                    allow_permission_bypass: Some(true),
                    owner: None,
                    workspace: None,
                },
            )
            .await;

        if allowed {
            assert!(result.unwrap().allow_permission_bypass, "{owner:?}");
        } else {
            assert!(
                matches!(result, Err(HarnessError::Unauthorized)),
                "{owner:?} by {caller_id}"
            );
            assert!(repo.calls.lock().unwrap().updated.is_empty());
        }
    }

    let result = service(FakeRepo::default())
        .patch_harness(
            caller(OWNER_ID),
            HarnessId::TEST_A,
            PatchHarnessRequest {
                name: None,
                allow_permission_bypass: Some(false),
                owner: None,
                workspace: None,
            },
        )
        .await;
    assert!(matches!(result, Err(HarnessError::NotFound(_))));
}

fn bound_agent(name: &str, owner: HarnessAgentOwner, owner_in_new_team: bool) -> BoundAgentFacts {
    BoundAgentFacts {
        agent: BoundHarnessAgent {
            bot_id: bot_id::BotId::new_from_uuid(Uuid::new_v4()),
            name: name.to_owned(),
            handle: name.to_lowercase(),
            owner,
        },
        owner_in_new_team,
    }
}

#[tokio::test]
async fn a_private_harness_moves_to_a_team_its_owner_belongs_to() {
    let repo = FakeRepo {
        harness: Some(harness(HarnessOwner::User {
            user_id: OWNER_ID.to_owned(),
        })),
        user_has_team: true,
        // The owner's own private agent may use a harness of their team.
        bound_agents: vec![bound_agent(
            "Mine",
            HarnessAgentOwner::User {
                user_id: OWNER_ID.to_owned(),
            },
            true,
        )],
        ..FakeRepo::default()
    };
    let updated = service(repo.clone())
        .patch_harness(
            caller(OWNER_ID),
            HarnessId::TEST_A,
            PatchHarnessRequest {
                owner: Some(RequestedHarnessOwner::Team { team_id: TEAM_ID }),
                ..PatchHarnessRequest::default()
            },
        )
        .await
        .unwrap();

    assert_eq!(updated.owner, HarnessOwner::Team { team_id: TEAM_ID });
    let calls = repo.calls.lock().unwrap();
    assert_eq!(calls.team_lookups, [(OWNER_ID.to_owned(), TEAM_ID)]);
    assert_eq!(calls.updated.len(), 1);
}

#[tokio::test]
async fn moving_to_a_team_requires_membership() {
    let repo = FakeRepo {
        harness: Some(harness(HarnessOwner::User {
            user_id: OWNER_ID.to_owned(),
        })),
        user_has_team: false,
        ..FakeRepo::default()
    };
    let result = service(repo.clone())
        .patch_harness(
            caller(OWNER_ID),
            HarnessId::TEST_A,
            PatchHarnessRequest {
                owner: Some(RequestedHarnessOwner::Team { team_id: TEAM_ID }),
                ..PatchHarnessRequest::default()
            },
        )
        .await;

    assert!(matches!(result, Err(HarnessError::Unauthorized)));
    assert!(repo.calls.lock().unwrap().owner_checks.is_empty());
}

#[tokio::test]
async fn only_a_manager_may_change_the_owner() {
    // A plain member of the team who did not register the harness.
    let repo = FakeRepo {
        harness: Some(harness(HarnessOwner::Team { team_id: TEAM_ID })),
        user_has_team: true,
        ..FakeRepo::default()
    };
    let result = service(repo.clone())
        .patch_harness(
            caller(MEMBER_ID),
            HarnessId::TEST_A,
            PatchHarnessRequest {
                owner: Some(RequestedHarnessOwner::User),
                ..PatchHarnessRequest::default()
            },
        )
        .await;

    assert!(matches!(result, Err(HarnessError::Unauthorized)));
    assert!(repo.calls.lock().unwrap().owner_checks.is_empty());
}

#[tokio::test]
async fn making_a_team_harness_private_is_blocked_by_agents_others_own() {
    let teammate_agent = bound_agent(
        "Teammate's",
        HarnessAgentOwner::User {
            user_id: TEAMMATE_ID.to_owned(),
        },
        false,
    );
    let team_agent = bound_agent(
        "Team's",
        HarnessAgentOwner::Team { team_id: TEAM_ID },
        false,
    );
    let repo = FakeRepo {
        harness: Some(harness(HarnessOwner::Team { team_id: TEAM_ID })),
        bound_agents: vec![
            bound_agent(
                "Mine",
                HarnessAgentOwner::User {
                    user_id: OWNER_ID.to_owned(),
                },
                false,
            ),
            teammate_agent.clone(),
            team_agent.clone(),
        ],
        ..FakeRepo::default()
    };
    let result = service(repo.clone())
        .patch_harness(
            caller(OWNER_ID),
            HarnessId::TEST_A,
            PatchHarnessRequest {
                owner: Some(RequestedHarnessOwner::User),
                ..PatchHarnessRequest::default()
            },
        )
        .await;

    let Err(HarnessError::OwnerChangeBlocked(blocking)) = result else {
        panic!("expected the owner change to be blocked, got {result:?}");
    };
    assert_eq!(blocking, [teammate_agent.agent, team_agent.agent]);
    assert!(repo.calls.lock().unwrap().updated.is_empty());
}

#[tokio::test]
async fn a_team_owner_makes_a_team_harness_private_to_themselves() {
    // The team owner did not register the harness; only their own private
    // agent is bound, so nothing is stranded.
    let repo = FakeRepo {
        harness: Some(harness(HarnessOwner::Team { team_id: TEAM_ID })),
        user_owns_team: true,
        bound_agents: vec![bound_agent(
            "Mine",
            HarnessAgentOwner::User {
                user_id: MEMBER_ID.to_owned(),
            },
            false,
        )],
        ..FakeRepo::default()
    };
    let updated = service(repo.clone())
        .patch_harness(
            caller(MEMBER_ID),
            HarnessId::TEST_A,
            PatchHarnessRequest {
                owner: Some(RequestedHarnessOwner::User),
                ..PatchHarnessRequest::default()
            },
        )
        .await
        .unwrap();

    assert_eq!(
        updated.owner,
        HarnessOwner::User {
            user_id: MEMBER_ID.to_owned(),
        }
    );
}

#[tokio::test]
async fn moving_between_teams_is_blocked_by_the_old_teams_agents() {
    let team_agent = bound_agent(
        "Team's",
        HarnessAgentOwner::Team { team_id: TEAM_ID },
        false,
    );
    let repo = FakeRepo {
        harness: Some(harness(HarnessOwner::Team { team_id: TEAM_ID })),
        user_has_team: true,
        bound_agents: vec![team_agent.clone()],
        ..FakeRepo::default()
    };
    let result = service(repo.clone())
        .patch_harness(
            caller(OWNER_ID),
            HarnessId::TEST_A,
            PatchHarnessRequest {
                owner: Some(RequestedHarnessOwner::Team {
                    team_id: OTHER_TEAM_ID,
                }),
                ..PatchHarnessRequest::default()
            },
        )
        .await;

    let Err(HarnessError::OwnerChangeBlocked(blocking)) = result else {
        panic!("expected the owner change to be blocked, got {result:?}");
    };
    assert_eq!(blocking, [team_agent.agent]);
}

#[tokio::test]
async fn requesting_the_current_owner_writes_nothing() {
    let repo = FakeRepo {
        harness: Some(harness(HarnessOwner::User {
            user_id: OWNER_ID.to_owned(),
        })),
        ..FakeRepo::default()
    };
    service(repo.clone())
        .patch_harness(
            caller(OWNER_ID),
            HarnessId::TEST_A,
            PatchHarnessRequest {
                owner: Some(RequestedHarnessOwner::User),
                ..PatchHarnessRequest::default()
            },
        )
        .await
        .unwrap();

    assert!(repo.calls.lock().unwrap().updated.is_empty());
}

fn reported(path: &str, kind: ReportedWorkspaceKind) -> ReportedWorkspace {
    ReportedWorkspace {
        path: path.to_owned(),
        kind,
    }
}

fn harness_with_reported_workspaces() -> Harness {
    Harness {
        reported_workspaces: vec![
            reported("/home/owner/code", ReportedWorkspaceKind::AllowedRoot),
            reported("/home/owner/code/macro", ReportedWorkspaceKind::Repository),
        ],
        ..harness(HarnessOwner::User {
            user_id: OWNER_ID.to_owned(),
        })
    }
}

#[tokio::test]
async fn a_daemon_report_replaces_its_workspaces_without_duplicates() {
    let repo = FakeRepo {
        harness: Some(harness_with_reported_workspaces()),
        ..FakeRepo::default()
    };

    service(repo.clone())
        .report_workspaces(
            HarnessId::TEST_A,
            ReportWorkspacesRequest {
                workspaces: vec![
                    reported("/srv/work", ReportedWorkspaceKind::AllowedRoot),
                    reported("/srv/work/api", ReportedWorkspaceKind::Repository),
                    reported("/srv/work", ReportedWorkspaceKind::Repository),
                ],
            },
        )
        .await
        .unwrap();

    assert_eq!(
        repo.calls.lock().unwrap().reported,
        [(
            HarnessId::TEST_A,
            vec![
                reported("/srv/work", ReportedWorkspaceKind::AllowedRoot),
                reported("/srv/work/api", ReportedWorkspaceKind::Repository),
            ]
        )]
    );
}

#[tokio::test]
async fn a_daemon_report_refuses_empty_paths_and_oversized_lists() {
    let repo = FakeRepo {
        harness: Some(harness_with_reported_workspaces()),
        ..FakeRepo::default()
    };

    let empty_path = service(repo.clone())
        .report_workspaces(
            HarnessId::TEST_A,
            ReportWorkspacesRequest {
                workspaces: vec![reported("", ReportedWorkspaceKind::AllowedRoot)],
            },
        )
        .await;
    let too_many = service(repo.clone())
        .report_workspaces(
            HarnessId::TEST_A,
            ReportWorkspacesRequest {
                workspaces: (0..=MAX_REPORTED_WORKSPACES)
                    .map(|index| {
                        reported(
                            &format!("/srv/work/{index}"),
                            ReportedWorkspaceKind::Repository,
                        )
                    })
                    .collect(),
            },
        )
        .await;

    assert!(matches!(empty_path, Err(HarnessError::BadRequest(_))));
    assert!(matches!(too_many, Err(HarnessError::BadRequest(_))));
    assert!(repo.calls.lock().unwrap().reported.is_empty());
}

#[tokio::test]
async fn a_report_for_a_removed_harness_is_not_found() {
    let result = service(FakeRepo::default())
        .report_workspaces(
            HarnessId::TEST_A,
            ReportWorkspacesRequest {
                workspaces: vec![reported("/srv/work", ReportedWorkspaceKind::AllowedRoot)],
            },
        )
        .await;

    assert!(matches!(result, Err(HarnessError::NotFound(_))));
}

#[tokio::test]
async fn a_manager_picks_a_reported_workspace_for_the_runtime() {
    let repo = FakeRepo {
        harness: Some(harness_with_reported_workspaces()),
        ..FakeRepo::default()
    };

    let updated = service(repo.clone())
        .patch_harness(
            caller(OWNER_ID),
            HarnessId::TEST_A,
            PatchHarnessRequest {
                workspace: Some(RequestedHarnessWorkspace::Path {
                    path: "/home/owner/code/macro".to_owned(),
                }),
                ..PatchHarnessRequest::default()
            },
        )
        .await
        .unwrap();

    assert_eq!(
        updated.workspace_path.as_deref(),
        Some("/home/owner/code/macro")
    );
    assert_eq!(
        repo.calls.lock().unwrap().updated,
        [(
            HarnessId::TEST_A,
            HarnessChanges {
                workspace: Some(RequestedHarnessWorkspace::Path {
                    path: "/home/owner/code/macro".to_owned(),
                }),
                ..HarnessChanges::default()
            }
        )]
    );
}

#[tokio::test]
async fn a_runtime_workspace_must_be_one_the_daemon_reported() {
    let repo = FakeRepo {
        harness: Some(harness_with_reported_workspaces()),
        ..FakeRepo::default()
    };

    for path in [
        "/etc",
        "/home/owner/code/../../../etc",
        "/home/owner/code/macro/",
    ] {
        let result = service(repo.clone())
            .patch_harness(
                caller(OWNER_ID),
                HarnessId::TEST_A,
                PatchHarnessRequest {
                    workspace: Some(RequestedHarnessWorkspace::Path {
                        path: path.to_owned(),
                    }),
                    ..PatchHarnessRequest::default()
                },
            )
            .await;

        assert!(matches!(result, Err(HarnessError::BadRequest(_))), "{path}");
    }
    assert!(repo.calls.lock().unwrap().updated.is_empty());
}

#[tokio::test]
async fn going_back_to_the_local_workspace_writes_only_when_one_is_set() {
    let repo = FakeRepo {
        harness: Some(harness_with_reported_workspaces()),
        ..FakeRepo::default()
    };
    service(repo.clone())
        .patch_harness(
            caller(OWNER_ID),
            HarnessId::TEST_A,
            PatchHarnessRequest {
                workspace: Some(RequestedHarnessWorkspace::Local),
                ..PatchHarnessRequest::default()
            },
        )
        .await
        .unwrap();
    assert!(repo.calls.lock().unwrap().updated.is_empty());

    let repo = FakeRepo {
        harness: Some(Harness {
            workspace_path: Some("/home/owner/code/macro".to_owned()),
            ..harness_with_reported_workspaces()
        }),
        ..FakeRepo::default()
    };
    let updated = service(repo.clone())
        .patch_harness(
            caller(OWNER_ID),
            HarnessId::TEST_A,
            PatchHarnessRequest {
                workspace: Some(RequestedHarnessWorkspace::Local),
                ..PatchHarnessRequest::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(updated.workspace_path, None);
    assert_eq!(repo.calls.lock().unwrap().updated.len(), 1);
}

#[tokio::test]
async fn only_a_manager_may_change_the_runtime_workspace() {
    let repo = FakeRepo {
        harness: Some(harness_with_reported_workspaces()),
        ..FakeRepo::default()
    };

    let result = service(repo.clone())
        .patch_harness(
            caller(MEMBER_ID),
            HarnessId::TEST_A,
            PatchHarnessRequest {
                workspace: Some(RequestedHarnessWorkspace::Path {
                    path: "/home/owner/code".to_owned(),
                }),
                ..PatchHarnessRequest::default()
            },
        )
        .await;

    assert!(matches!(result, Err(HarnessError::Unauthorized)));
    assert!(repo.calls.lock().unwrap().updated.is_empty());
}
