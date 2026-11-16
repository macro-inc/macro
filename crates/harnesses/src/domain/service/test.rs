use std::sync::{Arc, Mutex};

use chrono::Duration;
use macro_user_id::user_id::MacroUserIdStr;

use super::*;
use crate::domain::account_logins::{AccountLoginNotice, ComputerAccountLogin};
use crate::domain::models::ClaudeMode;
use crate::domain::{
    models::PairingClaimFacts,
    ports::{HostedPairingUpsert, OpenPairingCounts, PairingRow},
};

const OWNER_ID: &str = "macro|owner@example.com";
const MEMBER_ID: &str = "macro|member@example.com";
const CODE: &str = "KX7M-4QHD";
const TEAM_ID: Uuid = Uuid::from_u128(7);

fn caller(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_string()).unwrap()
}

fn user_owner(id: &str) -> HarnessOwner {
    HarnessOwner::User {
        user_id: id.to_owned(),
    }
}

fn harness(owner: HarnessOwner) -> Harness {
    Harness {
        allow_permission_bypass: false,
        id: HarnessId::TEST_A,
        kind: "macrod".to_owned(),
        name: "erics-macbook".to_owned(),
        owner,
        access: HarnessAccess::None,
        shared_team_ids: Vec::new(),
        created_by: OWNER_ID.to_owned(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        connected: false,
        last_connected_at: None,
        computer_id: None,
        team_agent_user_id: None,
        claude_mode: ClaudeMode::MacroCredits,
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
    claimed: Vec<PairingId>,
    deleted: Vec<HarnessId>,
    updated: Vec<(HarnessId, HarnessChanges)>,
    team_lookups: Vec<(String, Uuid)>,
    hosted_upserts: Vec<(NewPairing, NewHarness)>,
    account_logins: Vec<(HarnessId, AccountLoginChange)>,
    team_access: Vec<(Uuid, bool)>,
}

#[derive(Clone)]
struct FakeRepo {
    access: HarnessAccess,
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
    hosted_upsert: HostedPairingUpsert,
    calls: Arc<Mutex<Calls>>,
}

impl Default for FakeRepo {
    fn default() -> Self {
        Self {
            access: HarnessAccess::None,
            open_counts: OpenPairingCountsConfig::default(),
            insert_conflicts: 0,
            pairing: None,
            claim_facts: None,
            approve_result: None,
            claim_result: None,
            harness: None,
            delete_result: false,
            user_has_team: false,
            user_owns_team: false,
            hosted_upsert: HostedPairingUpsert::Created,
            calls: Arc::default(),
        }
    }
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

    async fn upsert_hosted_pairing(
        &self,
        pairing: NewPairing,
        new_harness: NewHarness,
    ) -> Result<HostedPairingUpsert, Self::Err> {
        self.calls
            .lock()
            .unwrap()
            .hosted_upserts
            .push((pairing, new_harness));
        Ok(self.hosted_upsert)
    }

    async fn computer_harness(
        &self,
        _computer_id: ComputerId,
    ) -> Result<Option<HarnessId>, Self::Err> {
        Ok(self.harness.as_ref().map(|harness| harness.id))
    }

    async fn computer_harness_ids(
        &self,
        _computer_id: ComputerId,
    ) -> Result<Vec<HarnessId>, Self::Err> {
        Ok(self.harness.iter().map(|harness| harness.id).collect())
    }

    async fn harness_computer(
        &self,
        _harness_id: HarnessId,
    ) -> Result<Option<ComputerId>, Self::Err> {
        Ok(self
            .harness
            .as_ref()
            .and_then(|harness| harness.computer_id))
    }

    async fn record_account_login(
        &self,
        harness_id: HarnessId,
        change: AccountLoginChange,
    ) -> Result<bool, Self::Err> {
        self.calls
            .lock()
            .unwrap()
            .account_logins
            .push((harness_id, change));
        Ok(self.harness.is_some())
    }

    async fn active_account_login(
        &self,
        _harness_id: HarnessId,
        _provider: AgentProvider,
    ) -> Result<Option<HarnessAccountLogin>, Self::Err> {
        Ok(None)
    }

    async fn computer_account_logins(
        &self,
        _provider: AgentProvider,
    ) -> Result<Vec<ComputerAccountLogin>, Self::Err> {
        Ok(Vec::new())
    }

    async fn record_login_notice(
        &self,
        _login_id: Uuid,
        _notice: AccountLoginNotice,
    ) -> Result<(), Self::Err> {
        Ok(())
    }

    async fn pairing_claim_facts(
        &self,
        _pairing_id: PairingId,
    ) -> Result<Option<PairingClaimFacts>, Self::Err> {
        Ok(self.claim_facts.clone())
    }

    async fn claim_pairing(
        &self,
        pairing_id: PairingId,
        _device_secret_hash: [u8; 32],
        _token_id: Uuid,
        _token: HashedHarnessToken,
    ) -> Result<Option<Harness>, Self::Err> {
        self.calls.lock().unwrap().claimed.push(pairing_id);
        Ok(self.claim_result.clone())
    }

    async fn list_usable_harnesses(
        &self,
        _caller: MacroUserIdStr<'static>,
    ) -> Result<Vec<Harness>, Self::Err> {
        Ok(self.harness.clone().into_iter().collect())
    }

    async fn list_directory_harnesses(
        &self,
        _caller: MacroUserIdStr<'static>,
    ) -> Result<Vec<Harness>, Self::Err> {
        Ok(self.harness.clone().into_iter().collect())
    }

    async fn harness_access(
        &self,
        _harness_id: HarnessId,
        caller: MacroUserIdStr<'static>,
    ) -> Result<HarnessAccess, Self::Err> {
        // As `harness_access_level`: a computer's buyer is not its owner.
        if self.harness.as_ref().is_some_and(|h| {
            h.computer_id.is_none()
                && match &h.owner {
                    HarnessOwner::User { user_id } => user_id == caller.as_ref(),
                }
        }) {
            return Ok(HarnessAccess::Owner);
        }
        Ok(self.access)
    }

    async fn set_team_access(
        &self,
        _harness_id: HarnessId,
        team_id: Uuid,
        enabled: bool,
    ) -> Result<(), Self::Err> {
        self.calls
            .lock()
            .unwrap()
            .team_access
            .push((team_id, enabled));
        Ok(())
    }

    async fn list_residents(
        &self,
        _harness_id: HarnessId,
    ) -> Result<Vec<HarnessResident>, Self::Err> {
        Ok(Vec::new())
    }

    async fn get_harness(&self, _harness_id: HarnessId) -> Result<Option<Harness>, Self::Err> {
        Ok(self.harness.clone())
    }

    async fn update_harness(
        &self,
        harness_id: HarnessId,
        changes: HarnessChanges,
    ) -> Result<Option<Harness>, Self::Err> {
        self.calls
            .lock()
            .unwrap()
            .updated
            .push((harness_id, changes.clone()));
        Ok(self.harness.clone().map(|harness| Harness {
            name: changes.name.unwrap_or(harness.name),
            allow_permission_bypass: changes
                .allow_permission_bypass
                .unwrap_or(harness.allow_permission_bypass),
            ..harness
        }))
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

/// The one agent teammate's computer in these tests, and its agent.
const AGENT_COMPUTER_ID: ComputerId = ComputerId::new_from_uuid(Uuid::from_u128(0xa6e7));
const TEAM_AGENT_ID: &str = "macro|agent@example.com";

#[derive(Clone, Default)]
struct FakeTeamAgents;

impl ComputerTeamAgents for FakeTeamAgents {
    type Err = anyhow::Error;

    async fn team_agents_of(
        &self,
        computers: &[ComputerId],
    ) -> Result<std::collections::HashMap<ComputerId, MacroUserIdStr<'static>>, Self::Err> {
        Ok(computers
            .iter()
            .filter(|computer| **computer == AGENT_COMPUTER_ID)
            .map(|computer| (*computer, caller(TEAM_AGENT_ID)))
            .collect())
    }
}

fn service(repo: FakeRepo) -> HarnessServiceImpl<FakeRepo, FakeTeamAgents> {
    HarnessServiceImpl::new(repo, FakeTeamAgents)
}

#[tokio::test]
async fn listings_mark_an_agent_teammates_computer_with_its_agent() {
    let agent_computer = FakeRepo {
        harness: Some(Harness {
            computer_id: Some(AGENT_COMPUTER_ID),
            ..harness(user_owner(OWNER_ID))
        }),
        ..FakeRepo::default()
    };
    let usable = service(agent_computer.clone())
        .list_harnesses(caller(OWNER_ID))
        .await
        .unwrap();
    let directory = service(agent_computer)
        .list_directory(caller(OWNER_ID))
        .await
        .unwrap();
    assert_eq!(usable[0].team_agent_user_id, Some(caller(TEAM_AGENT_ID)));
    assert_eq!(directory[0].team_agent_user_id, Some(caller(TEAM_AGENT_ID)));

    let people_computer = FakeRepo {
        harness: Some(Harness {
            computer_id: Some(COMPUTER_ID),
            ..harness(user_owner(OWNER_ID))
        }),
        ..FakeRepo::default()
    };
    let usable = service(people_computer)
        .list_harnesses(caller(OWNER_ID))
        .await
        .unwrap();
    assert_eq!(usable[0].team_agent_user_id, None);
}

#[tokio::test]
async fn only_an_agent_computers_harness_has_a_team_agent() {
    let on = |computer_id| FakeRepo {
        harness: Some(Harness {
            computer_id,
            ..harness(user_owner(OWNER_ID))
        }),
        ..FakeRepo::default()
    };
    assert_eq!(
        service(on(Some(AGENT_COMPUTER_ID)))
            .harness_team_agent(HarnessId::TEST_A)
            .await
            .unwrap(),
        Some(caller(TEAM_AGENT_ID))
    );
    assert_eq!(
        service(on(Some(COMPUTER_ID)))
            .harness_team_agent(HarnessId::TEST_A)
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        service(on(None))
            .harness_team_agent(HarnessId::TEST_A)
            .await
            .unwrap(),
        None
    );
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
        approve_result: Some(harness(user_owner(MEMBER_ID))),
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

    {
        let calls = repo.calls.lock().unwrap();
        let (_, new_harness) = &calls.approved[0];
        assert_eq!(new_harness.name, "team box");
        assert_eq!(new_harness.owner, user_owner(MEMBER_ID));
        assert_eq!(new_harness.team_grant, Some(TEAM_ID));
        assert_eq!(calls.team_lookups[0], (MEMBER_ID.to_owned(), TEAM_ID));
    }

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
    let pairing_id = PairingId::new_from_uuid(Uuid::new_v4());

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
    let pairing_id = PairingId::new_from_uuid(Uuid::new_v4());

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

/// A Macro computer's harness goes away with the computer (Release now);
/// deleting it directly would leave a paid computer with no runtime.
#[tokio::test]
async fn a_computer_harness_cannot_be_removed_like_a_paired_machine() {
    let repo = FakeRepo {
        harness: Some(Harness {
            computer_id: Some(COMPUTER_ID),
            ..harness(HarnessOwner::User {
                user_id: OWNER_ID.to_owned(),
            })
        }),
        access: HarnessAccess::Owner,
        delete_result: true,
        ..FakeRepo::default()
    };
    let result = service(repo.clone())
        .delete_harness(caller(OWNER_ID), HarnessId::TEST_A)
        .await;
    assert!(
        matches!(&result, Err(HarnessError::ComputerHarness)),
        "{result:?}"
    );
    // Nor can its own daemon retire it: agents stay bound to it until release.
    let result = service(repo.clone()).delete_self(HarnessId::TEST_A).await;
    assert!(
        matches!(&result, Err(HarnessError::ComputerHarness)),
        "{result:?}"
    );
    assert!(repo.calls.lock().unwrap().deleted.is_empty());
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

fn shared_with_team() -> Harness {
    Harness {
        shared_team_ids: vec![TEAM_ID],
        ..harness(user_owner(OWNER_ID))
    }
}

#[tokio::test]
async fn team_runtimes_are_deletable_by_their_owner_or_the_team_owner() {
    // Its owner.
    let repo = FakeRepo {
        harness: Some(shared_with_team()),
        delete_result: true,
        ..FakeRepo::default()
    };
    service(repo)
        .delete_harness(caller(OWNER_ID), HarnessId::TEST_A)
        .await
        .unwrap();

    // The team owner.
    let repo = FakeRepo {
        harness: Some(shared_with_team()),
        delete_result: true,
        user_owns_team: true,
        ..FakeRepo::default()
    };
    service(repo)
        .delete_harness(caller(MEMBER_ID), HarnessId::TEST_A)
        .await
        .unwrap();

    // A plain member.
    let repo = FakeRepo {
        harness: Some(shared_with_team()),
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
async fn only_the_owner_opens_a_runtime_to_a_team_they_belong_to() {
    let request = || SetHarnessTeamAccessRequest {
        team_id: TEAM_ID,
        enabled: true,
    };

    // The owner, on their own team.
    let repo = FakeRepo {
        access: HarnessAccess::Owner,
        user_has_team: true,
        ..FakeRepo::default()
    };
    service(repo.clone())
        .set_team_access(caller(OWNER_ID), HarnessId::TEST_A, request())
        .await
        .unwrap();
    assert_eq!(repo.calls.lock().unwrap().team_access, [(TEAM_ID, true)]);

    // Someone holding a grant cannot pass it on.
    let repo = FakeRepo {
        access: HarnessAccess::User,
        user_has_team: true,
        ..FakeRepo::default()
    };
    let result = service(repo.clone())
        .set_team_access(caller(MEMBER_ID), HarnessId::TEST_A, request())
        .await;
    assert!(matches!(result, Err(HarnessError::Unauthorized)));
    assert!(repo.calls.lock().unwrap().team_access.is_empty());

    // The owner, on a team they are not in.
    let repo = FakeRepo {
        access: HarnessAccess::Owner,
        user_has_team: false,
        ..FakeRepo::default()
    };
    let result = service(repo)
        .set_team_access(caller(OWNER_ID), HarnessId::TEST_A, request())
        .await;
    assert!(matches!(result, Err(HarnessError::Unauthorized)));
}

/// A computer's harness belongs to its team: nobody opens it to another team
/// or closes it to its own.
#[tokio::test]
async fn a_computer_harness_is_never_shared_or_unshared() {
    for enabled in [true, false] {
        let repo = FakeRepo {
            harness: Some(Harness {
                computer_id: Some(COMPUTER_ID),
                shared_team_ids: vec![TEAM_ID],
                ..harness(user_owner(OWNER_ID))
            }),
            access: HarnessAccess::Owner,
            user_has_team: true,
            ..FakeRepo::default()
        };
        let result = service(repo.clone())
            .set_team_access(
                caller(OWNER_ID),
                HarnessId::TEST_A,
                SetHarnessTeamAccessRequest {
                    team_id: Uuid::from_u128(8),
                    enabled,
                },
            )
            .await;
        assert!(
            matches!(&result, Err(HarnessError::ComputerHarness)),
            "{result:?}"
        );
        assert!(repo.calls.lock().unwrap().team_access.is_empty());
    }
}

#[tokio::test]
async fn residents_are_visible_to_readers_and_users_only() {
    let repo = FakeRepo {
        access: HarnessAccess::None,
        ..FakeRepo::default()
    };
    let result = service(repo)
        .list_residents(caller(MEMBER_ID), HarnessId::TEST_A)
        .await;
    assert!(matches!(result, Err(HarnessError::Unauthorized)));

    let repo = FakeRepo {
        access: HarnessAccess::User,
        ..FakeRepo::default()
    };
    service(repo)
        .list_residents(caller(MEMBER_ID), HarnessId::TEST_A)
        .await
        .unwrap();

    let repo = FakeRepo {
        access: HarnessAccess::Read,
        ..FakeRepo::default()
    };
    service(repo)
        .list_residents(caller(MEMBER_ID), HarnessId::TEST_A)
        .await
        .unwrap();
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
        (user_owner(OWNER_ID), MEMBER_ID, false),
        (user_owner(OWNER_ID), OWNER_ID, true),
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
            },
        )
        .await;
    assert!(matches!(result, Err(HarnessError::NotFound(_))));
}

const COMPUTER_ID: ComputerId = ComputerId::new_from_uuid(Uuid::from_u128(42));

fn hosted_request() -> CreateHostedPairing {
    CreateHostedPairing {
        team_id: TEAM_ID,
        name: "  Standard computer  ".to_owned(),
        created_by: caller(OWNER_ID),
        computer_id: COMPUTER_ID,
    }
}

#[tokio::test]
async fn hosted_pairing_registers_an_approved_team_harness_past_the_throttle() {
    // Far over both open-pairing caps: hosted pairings never consult them.
    let repo = FakeRepo {
        open_counts: OpenPairingCountsConfig {
            total: 1_000,
            with_same_name: 1_000,
        },
        ..FakeRepo::default()
    };
    let hosted = service(repo.clone())
        .create_hosted_pairing(hosted_request())
        .await
        .unwrap();

    assert!(!hosted.device_secret.expose().is_empty());
    let calls = repo.calls.lock().unwrap();
    assert!(calls.inserted_pairings.is_empty());
    assert_eq!(calls.hosted_upserts.len(), 1);
    let (pairing, new_harness) = &calls.hosted_upserts[0];
    assert_eq!(pairing.id, hosted.pairing_id);
    assert_eq!(pairing.code, format!("hosted:{}", hosted.pairing_id));
    assert_eq!(
        pairing.device_secret_hash,
        harness_token::hash_token(hosted.device_secret.expose())
    );
    assert_eq!(pairing.requested_name, "Standard computer");
    assert_eq!(pairing.host, None);
    assert!(pairing.expires_at > Utc::now());
    assert_eq!(new_harness.name, "Standard computer");
    assert_eq!(new_harness.owner, user_owner(OWNER_ID));
    assert_eq!(new_harness.created_by.as_ref(), OWNER_ID);
    // Bought computers start with "Don't ask before acting" on.
    assert!(new_harness.allow_permission_bypass);
    assert_eq!(new_harness.computer_id, Some(COMPUTER_ID));
}

#[tokio::test]
async fn hosted_pairing_rotates_before_claim_and_returns_fresh_pairing_after_rekey() {
    let existing = PairingId::new_from_uuid(Uuid::from_u128(99));
    let repo = FakeRepo {
        hosted_upsert: HostedPairingUpsert::Rotated {
            pairing_id: existing,
        },
        ..FakeRepo::default()
    };
    let hosted = service(repo.clone())
        .create_hosted_pairing(hosted_request())
        .await
        .unwrap();
    assert_eq!(hosted.pairing_id, existing);
    {
        let calls = repo.calls.lock().unwrap();
        assert_eq!(
            calls.hosted_upserts[0].0.device_secret_hash,
            harness_token::hash_token(hosted.device_secret.expose())
        );
    }

    let mut repo = FakeRepo {
        hosted_upsert: HostedPairingUpsert::Rekeyed,
        ..FakeRepo::default()
    };
    let hosted = service(repo.clone())
        .create_hosted_pairing(hosted_request())
        .await
        .unwrap();
    {
        let calls = repo.calls.lock().unwrap();
        assert_eq!(hosted.pairing_id, calls.hosted_upserts[0].0.id);
        assert_eq!(
            calls.hosted_upserts[0].0.device_secret_hash,
            harness_token::hash_token(hosted.device_secret.expose())
        );
    }
    let mut existing_harness = harness(user_owner(OWNER_ID));
    existing_harness.computer_id = Some(COMPUTER_ID);
    repo.claim_facts = Some(PairingClaimFacts {
        device_secret_hash: harness_token::hash_token(hosted.device_secret.expose()),
        status: PairingStatus::Approved,
        expires_at: Utc::now() + Duration::minutes(15),
        harness_id: Some(existing_harness.id),
    });
    repo.claim_result = Some(existing_harness.clone());
    let ClaimOutcome::Claimed(reclaimed) = service(repo)
        .claim_pairing(
            hosted.pairing_id,
            ClaimPairingRequest {
                device_secret: hosted.device_secret.expose().to_owned(),
            },
        )
        .await
        .unwrap()
    else {
        panic!("expected re-enrollment credentials");
    };
    assert_eq!(reclaimed.harness.id, existing_harness.id);
    assert_eq!(reclaimed.harness.computer_id, Some(COMPUTER_ID));
    assert!(reclaimed.token.starts_with("mhns_"));
}

#[tokio::test]
async fn hosted_pairing_validates_the_name() {
    let result = service(FakeRepo::default())
        .create_hosted_pairing(CreateHostedPairing {
            name: "   ".to_owned(),
            ..hosted_request()
        })
        .await;
    assert!(matches!(result, Err(HarnessError::BadRequest(_))));
}

#[tokio::test]
async fn revoking_a_hosted_harness_deletes_it_and_is_idempotent() {
    let repo = FakeRepo {
        harness: Some(Harness {
            computer_id: Some(COMPUTER_ID),
            ..harness(user_owner(OWNER_ID))
        }),
        delete_result: true,
        ..FakeRepo::default()
    };
    service(repo.clone())
        .revoke_hosted_harness(COMPUTER_ID)
        .await
        .unwrap();
    assert_eq!(repo.calls.lock().unwrap().deleted, [HarnessId::TEST_A]);

    let repo = FakeRepo::default();
    service(repo.clone())
        .revoke_hosted_harness(COMPUTER_ID)
        .await
        .unwrap();
    assert!(repo.calls.lock().unwrap().deleted.is_empty());
}

#[tokio::test]
async fn harness_computer_maps_hosted_harnesses_only() {
    let repo = FakeRepo {
        harness: Some(Harness {
            computer_id: Some(COMPUTER_ID),
            ..harness(user_owner(OWNER_ID))
        }),
        ..FakeRepo::default()
    };
    assert_eq!(
        service(repo)
            .harness_computer(HarnessId::TEST_A)
            .await
            .unwrap(),
        Some(COMPUTER_ID)
    );
    let repo = FakeRepo {
        harness: Some(harness(user_owner(OWNER_ID))),
        ..FakeRepo::default()
    };
    assert_eq!(
        service(repo)
            .harness_computer(HarnessId::TEST_A)
            .await
            .unwrap(),
        None
    );
}

#[tokio::test]
async fn team_members_view_a_team_harness_but_only_managers_manage_it() {
    let repo = FakeRepo {
        harness: Some(harness(user_owner(OWNER_ID))),
        access: HarnessAccess::Read,
        user_has_team: true,
        ..FakeRepo::default()
    };
    service(repo.clone())
        .authorize_harness(
            caller(MEMBER_ID),
            HarnessId::TEST_A,
            HarnessPermission::View,
        )
        .await
        .unwrap();
    let managed = service(repo.clone())
        .authorize_harness(
            caller(MEMBER_ID),
            HarnessId::TEST_A,
            HarnessPermission::Manage,
        )
        .await;
    assert!(matches!(managed, Err(HarnessError::Unauthorized)));
    service(repo.clone())
        .authorize_harness(
            caller(OWNER_ID),
            HarnessId::TEST_A,
            HarnessPermission::Manage,
        )
        .await
        .unwrap();

    let outsider = FakeRepo {
        harness: Some(harness(user_owner(OWNER_ID))),
        ..FakeRepo::default()
    };
    let viewed = service(outsider)
        .authorize_harness(
            caller(MEMBER_ID),
            HarnessId::TEST_A,
            HarnessPermission::View,
        )
        .await;
    assert!(matches!(viewed, Err(HarnessError::Unauthorized)));
}

/// A computer belongs to its team: the team's owner and admins manage it,
/// and its buyer only while still one of them.
#[tokio::test]
async fn a_computer_harness_is_managed_by_its_team_admins_not_its_buyer() {
    let computer = || {
        Some(Harness {
            computer_id: Some(COMPUTER_ID),
            shared_team_ids: vec![TEAM_ID],
            ..harness(user_owner(OWNER_ID))
        })
    };

    // Another admin of the computer's team.
    let repo = FakeRepo {
        harness: computer(),
        access: HarnessAccess::Owner,
        ..FakeRepo::default()
    };
    service(repo.clone())
        .authorize_harness(
            caller(MEMBER_ID),
            HarnessId::TEST_A,
            HarnessPermission::Manage,
        )
        .await
        .unwrap();
    let patched = service(repo)
        .patch_harness(
            caller(MEMBER_ID),
            HarnessId::TEST_A,
            PatchHarnessRequest {
                name: Some("Team computer".to_owned()),
                allow_permission_bypass: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(patched.name, "Team computer");

    // The buyer, after leaving the team.
    let repo = FakeRepo {
        harness: computer(),
        access: HarnessAccess::None,
        ..FakeRepo::default()
    };
    let managed = service(repo.clone())
        .authorize_harness(
            caller(OWNER_ID),
            HarnessId::TEST_A,
            HarnessPermission::Manage,
        )
        .await;
    assert!(
        matches!(managed, Err(HarnessError::Unauthorized)),
        "{managed:?}"
    );
    let patched = service(repo.clone())
        .patch_harness(
            caller(OWNER_ID),
            HarnessId::TEST_A,
            PatchHarnessRequest {
                name: Some("Mine now".to_owned()),
                allow_permission_bypass: None,
            },
        )
        .await;
    assert!(
        matches!(patched, Err(HarnessError::Unauthorized)),
        "{patched:?}"
    );
    let deleted = service(repo.clone())
        .delete_harness(caller(OWNER_ID), HarnessId::TEST_A)
        .await;
    assert!(
        matches!(deleted, Err(HarnessError::Unauthorized)),
        "{deleted:?}"
    );
    assert!(repo.calls.lock().unwrap().updated.is_empty());
    assert!(repo.calls.lock().unwrap().deleted.is_empty());
}

#[tokio::test]
async fn an_account_login_on_an_unknown_harness_is_not_found() {
    let missing = service(FakeRepo::default())
        .record_account_login(
            HarnessId::TEST_A,
            AccountLoginChange::SignedOut {
                provider: AgentProvider::Claude,
            },
        )
        .await;
    assert!(matches!(missing, Err(HarnessError::NotFound(_))));
}

#[test]
fn hosted_pairing_redacts_its_credential() {
    let pairing = HostedPairing {
        pairing_id: PairingId::new_from_uuid(Uuid::now_v7()),
        device_secret: super::super::models::DeviceSecret::new("enrollment-credential".to_owned()),
    };
    assert!(!format!("{pairing:?}").contains(pairing.device_secret.expose()));
    assert_eq!(format!("{}", pairing.device_secret), "**redacted**");
    assert_eq!(format!("{:?}", pairing.device_secret), "**redacted**");
}

mod hosted_claim;
