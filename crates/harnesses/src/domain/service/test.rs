use std::sync::{Arc, Mutex};

use chrono::Duration;
use macro_user_id::user_id::MacroUserIdStr;

use super::*;
use crate::domain::{
    models::{PairingClaimFacts, RequestedHarnessScope},
    ports::{HostedPairingUpsert, OpenPairingCounts, PairingRow},
};

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
        capabilities: HarnessCapabilities::default(),
        computer_id: None,
        claude_mode: ClaudeMode::MacroCredits,
    }
}

fn pending_pairing() -> PairingRow {
    PairingRow {
        details: PairingDetails {
            requested_allow_permission_bypass: None,
            code: CODE.to_owned(),
            requested_name: "erics-macbook".to_owned(),
            host: Some("eric@macbook / darwin".to_owned()),
            requested_scope: Some(RequestedHarnessScope::Team),
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
    team_lookups: Vec<(String, Uuid)>,
    hosted_upserts: Vec<(NewPairing, NewHarness)>,
    capability_reports: Vec<(HarnessId, HarnessCapabilities)>,
    claude_modes: Vec<(HarnessId, ClaudeMode)>,
}

#[derive(Clone)]
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
    set_capabilities_result: bool,
    hosted_upsert: HostedPairingUpsert,
    calls: Arc<Mutex<Calls>>,
}

impl Default for FakeRepo {
    fn default() -> Self {
        Self {
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
            set_capabilities_result: false,
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

    async fn computer_harness(&self, _computer_id: Uuid) -> Result<Option<HarnessId>, Self::Err> {
        Ok(self.harness.as_ref().map(|harness| harness.id))
    }

    async fn harness_computer(&self, _harness_id: HarnessId) -> Result<Option<Uuid>, Self::Err> {
        Ok(self
            .harness
            .as_ref()
            .and_then(|harness| harness.computer_id))
    }

    async fn set_capabilities(
        &self,
        harness_id: HarnessId,
        capabilities: HarnessCapabilities,
    ) -> Result<bool, Self::Err> {
        self.calls
            .lock()
            .unwrap()
            .capability_reports
            .push((harness_id, capabilities));
        Ok(self.set_capabilities_result)
    }

    async fn set_claude_mode(
        &self,
        harness_id: HarnessId,
        mode: ClaudeMode,
    ) -> Result<bool, Self::Err> {
        self.calls
            .lock()
            .unwrap()
            .claude_modes
            .push((harness_id, mode));
        Ok(self.harness.is_some())
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
            allow_permission_bypass: None,
            name: "  erics-macbook  ".to_owned(),
            host: Some("eric@macbook".to_owned()),
            scope: Some(RequestedHarnessScope::Team),
        })
        .await
        .unwrap();

    assert_eq!(created.code.len(), 9);
    assert!(!created.device_secret.is_empty());
    assert!(created.expires_at > Utc::now());

    let calls = repo.calls.lock().unwrap();
    let inserted = &calls.inserted_pairings[0];
    assert_eq!(inserted.requested_name, "erics-macbook");
    assert_eq!(inserted.requested_scope, Some(RequestedHarnessScope::Team));
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
            allow_permission_bypass: None,
            name: "erics-macbook".to_owned(),
            host: None,
            scope: None,
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
            allow_permission_bypass: None,
            name: "erics-macbook".to_owned(),
            host: None,
            scope: None,
        })
        .await;
    assert!(matches!(result, Err(HarnessError::Throttled)));

    let result = service(FakeRepo::default())
        .create_pairing(CreatePairingRequest {
            allow_permission_bypass: None,
            name: "   ".to_owned(),
            host: None,
            scope: None,
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
async fn pairing_creation_preserves_the_daemons_permission_ceiling() {
    for allowed in [None, Some(false), Some(true)] {
        let repo = FakeRepo::default();
        service(repo.clone())
            .create_pairing(CreatePairingRequest {
                allow_permission_bypass: allowed,
                name: "laptop".to_owned(),
                host: None,
                scope: None,
            })
            .await
            .unwrap();
        assert_eq!(
            repo.calls.lock().unwrap().inserted_pairings[0].requested_allow_permission_bypass,
            allowed
        );
    }
}

#[tokio::test]
async fn approval_requires_daemon_consent_when_the_daemon_names_a_ceiling() {
    for requested in [None, Some(false), Some(true)] {
        for approved in [false, true] {
            let mut pairing = pending_pairing();
            pairing.details.requested_allow_permission_bypass = requested;
            let repo = FakeRepo {
                pairing: Some(pairing),
                approve_result: Some(harness(HarnessOwner::User {
                    user_id: OWNER_ID.to_owned(),
                })),
                ..FakeRepo::default()
            };
            let result = service(repo.clone())
                .approve_pairing(
                    caller(OWNER_ID),
                    CODE,
                    ApprovePairingRequest {
                        allow_permission_bypass: approved,
                        name: None,
                        team_id: None,
                    },
                )
                .await;
            let calls = repo.calls.lock().unwrap();
            if requested == Some(false) && approved {
                assert!(matches!(result, Err(HarnessError::BadRequest(_))));
                assert!(calls.approved.is_empty());
            } else {
                result.unwrap();
                assert_eq!(calls.approved[0].1.allow_permission_bypass, approved);
            }
        }
    }
}

const COMPUTER_ID: Uuid = Uuid::from_u128(42);

fn hosted_request() -> CreateHostedPairing {
    CreateHostedPairing {
        team_id: TEAM_ID,
        name: "  Standard computer  ".to_owned(),
        created_by: caller(OWNER_ID),
        allow_permission_bypass: true,
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

    assert!(!hosted.device_secret.is_empty());
    let calls = repo.calls.lock().unwrap();
    assert!(calls.inserted_pairings.is_empty());
    assert_eq!(calls.hosted_upserts.len(), 1);
    let (pairing, new_harness) = &calls.hosted_upserts[0];
    assert_eq!(pairing.id, hosted.pairing_id);
    assert_eq!(pairing.code, format!("hosted:{}", hosted.pairing_id));
    assert_eq!(
        pairing.device_secret_hash,
        harness_token::hash_token(&hosted.device_secret)
    );
    assert_eq!(pairing.requested_name, "Standard computer");
    assert_eq!(pairing.host, None);
    assert_eq!(pairing.requested_scope, Some(RequestedHarnessScope::Team));
    assert_eq!(pairing.requested_allow_permission_bypass, Some(true));
    assert!(pairing.expires_at > Utc::now());
    assert_eq!(new_harness.name, "Standard computer");
    assert_eq!(new_harness.owner, HarnessOwner::Team { team_id: TEAM_ID });
    assert_eq!(new_harness.created_by.as_ref(), OWNER_ID);
    assert!(new_harness.allow_permission_bypass);
    assert_eq!(new_harness.computer_id, Some(COMPUTER_ID));
}

#[tokio::test]
async fn hosted_pairing_retries_return_the_existing_pairing_until_it_is_claimed() {
    let existing = Uuid::from_u128(99);
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
    let calls = repo.calls.lock().unwrap();
    assert_eq!(
        calls.hosted_upserts[0].0.device_secret_hash,
        harness_token::hash_token(&hosted.device_secret)
    );

    let repo = FakeRepo {
        hosted_upsert: HostedPairingUpsert::Claimed,
        ..FakeRepo::default()
    };
    let result = service(repo).create_hosted_pairing(hosted_request()).await;
    assert!(matches!(result, Err(HarnessError::Gone(_))));
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
            ..harness(HarnessOwner::Team { team_id: TEAM_ID })
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
            ..harness(HarnessOwner::Team { team_id: TEAM_ID })
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
        harness: Some(harness(HarnessOwner::Team { team_id: TEAM_ID })),
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
async fn capability_reports_reach_the_repo_and_unknown_harnesses_are_not_found() {
    let repo = FakeRepo {
        set_capabilities_result: true,
        ..FakeRepo::default()
    };
    service(repo.clone())
        .report_capabilities(HarnessId::TEST_A, HarnessCapabilities { screen: true })
        .await
        .unwrap();
    assert_eq!(
        repo.calls.lock().unwrap().capability_reports,
        [(HarnessId::TEST_A, HarnessCapabilities { screen: true })]
    );

    let result = service(FakeRepo::default())
        .report_capabilities(HarnessId::TEST_A, HarnessCapabilities { screen: true })
        .await;
    assert!(matches!(result, Err(HarnessError::NotFound(_))));
}

#[tokio::test]
async fn team_members_view_a_team_harness_but_only_managers_manage_it() {
    let repo = FakeRepo {
        harness: Some(harness(HarnessOwner::Team { team_id: TEAM_ID })),
        user_has_team: true,
        ..FakeRepo::default()
    };
    service(repo.clone())
        .authorize_harness(caller(MEMBER_ID), HarnessId::TEST_A, HarnessAccess::View)
        .await
        .unwrap();
    let managed = service(repo.clone())
        .authorize_harness(caller(MEMBER_ID), HarnessId::TEST_A, HarnessAccess::Manage)
        .await;
    assert!(matches!(managed, Err(HarnessError::Unauthorized)));
    service(repo.clone())
        .authorize_harness(caller(OWNER_ID), HarnessId::TEST_A, HarnessAccess::Manage)
        .await
        .unwrap();

    let outsider = FakeRepo {
        harness: Some(harness(HarnessOwner::Team { team_id: TEAM_ID })),
        ..FakeRepo::default()
    };
    let viewed = service(outsider)
        .authorize_harness(caller(MEMBER_ID), HarnessId::TEST_A, HarnessAccess::View)
        .await;
    assert!(matches!(viewed, Err(HarnessError::Unauthorized)));
}

#[tokio::test]
async fn claude_mode_reaches_the_repo() {
    let repo = FakeRepo {
        harness: Some(harness(HarnessOwner::Team { team_id: TEAM_ID })),
        ..FakeRepo::default()
    };
    service(repo.clone())
        .set_claude_mode(HarnessId::TEST_A, ClaudeMode::OwnAccount)
        .await
        .unwrap();
    assert_eq!(
        repo.calls.lock().unwrap().claude_modes,
        [(HarnessId::TEST_A, ClaudeMode::OwnAccount)]
    );
    let missing = service(FakeRepo::default())
        .set_claude_mode(HarnessId::TEST_A, ClaudeMode::OwnAccount)
        .await;
    assert!(matches!(missing, Err(HarnessError::NotFound(_))));
}
