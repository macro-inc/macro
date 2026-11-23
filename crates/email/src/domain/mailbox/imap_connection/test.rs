use super::*;
use imap_engine::domain::models::{Endpoint, Error, Secret, TlsMode};
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
struct Fake(Arc<Mutex<State>>);
#[derive(Default)]
struct State {
    enabled: bool,
    discoveries: Vec<String>,
    hint_mx: Option<String>,
    hint_error: bool,
    hints: u32,
    attempt: Option<ImapConnectionAttempt>,
    verifies: u32,
    promotions: u32,
    activations: u32,
    fail_next_promotion: bool,
    promotion_error: Option<Error>,
    pending: Vec<ImapConnectionAttempt>,
    deferred: Vec<chrono::Duration>,
    recovery_age: Option<chrono::Duration>,
    successful_link: Option<Uuid>,
    lease_held: bool,
    complete_during_lease: bool,
}
impl ImapConnectionEnrollment for Fake {
    async fn enabled(&self, _: &MacroUserIdStr<'_>) -> bool {
        self.0.lock().unwrap().enabled
    }
}
impl ImapConnectionGateway for Fake {
    async fn provider_hint(
        &self,
        email: &Email<ArcCowStr<'_>>,
    ) -> Result<Discovery, ImapConnectionError> {
        let mut state = self.0.lock().unwrap();
        state.hints += 1;
        if state.hint_error {
            return Err(Error::DnsUnavailable.into());
        }
        if let Some(mx) = &state.hint_mx {
            return Ok(imap_engine::domain::discovery::from_mx(email, mx)?
                .unwrap_or_else(imap_engine::domain::discovery::manual));
        }
        Ok(imap_engine::domain::discovery::discover(email)?)
    }
    async fn discover(
        &self,
        email: &Email<ArcCowStr<'_>>,
    ) -> Result<Discovery, ImapConnectionError> {
        self.0
            .lock()
            .unwrap()
            .discoveries
            .push(email.email_str().to_owned());
        Ok(imap_engine::domain::discovery::manual())
    }
    async fn verify(&self, request: &VerifyRequest) -> Result<Verification, ImapConnectionError> {
        assert_eq!(request.user_id, "macro|owner@example.com");
        assert_eq!(request.email.0.as_ref(), "owner@example.com");
        self.0.lock().unwrap().verifies += 1;
        Ok(Verification {
            id: Uuid::from_u128(2),
            expires_at: chrono::Utc::now() + chrono::Duration::minutes(15),
        })
    }
    async fn connect(
        &self,
        link: Uuid,
        request: &ConnectRequest,
    ) -> Result<Binding, ImapConnectionError> {
        let mut state = self.0.lock().unwrap();
        state.promotions += 1;
        if let Some(error) = &state.promotion_error
            && state.successful_link != Some(link)
        {
            return Err(error.clone().into());
        }
        if state.fail_next_promotion {
            state.fail_next_promotion = false;
            return Err(Error::ConnectionUnavailable.into());
        }
        assert_eq!(request.owner_user_id, "macro|owner@example.com");
        assert_eq!(request.verification_id, Uuid::from_u128(2));
        Ok(Binding {
            link_id: link,
            sync_generation: request.sync_generation,
            grant_generation: request.grant_generation,
        })
    }
}
impl ImapConnectionRepository for Fake {
    async fn attempt(
        &self,
        actor: &MacroUserIdStr<'_>,
        _: Uuid,
    ) -> Result<Option<ImapConnectionAttempt>, ImapConnectionError> {
        let state = self.0.lock().unwrap();
        Ok(state
            .attempt
            .clone()
            .filter(|attempt| attempt.owner.as_ref() == actor.as_ref()))
    }
    async fn reserve(
        &self,
        actor: &MacroUserIdStr<'_>,
        owner: &str,
        input: &ImapConnectRequest,
        verification: &Verification,
    ) -> Result<ImapConnectionAttempt, ImapConnectionError> {
        let attempt = ImapConnectionAttempt {
            id: input.request_id,
            owner: MacroUserIdStr::try_from(actor.to_string()).unwrap(),
            credential_owner: owner.into(),
            email: input.email.clone(),
            verification_id: verification.id,
            binding: Binding {
                link_id: Uuid::from_u128(3),
                sync_generation: 1,
                grant_generation: 1,
            },
            expected_generation: None,
            completed: false,
        };
        self.0.lock().unwrap().attempt = Some(attempt.clone());
        Ok(attempt)
    }
    async fn activate(&self, lease: &ImapConnectionLease) -> Result<Uuid, ImapConnectionError> {
        let attempt = &lease.attempt;
        let mut state = self.0.lock().unwrap();
        state.activations += 1;
        state.attempt.as_mut().unwrap().completed = true;
        Ok(attempt.binding.link_id)
    }
    async fn lease(
        &self,
        attempt: &ImapConnectionAttempt,
    ) -> Result<ImapConnectionLease, ImapConnectionError> {
        let mut state = self.0.lock().unwrap();
        if state.complete_during_lease {
            state.attempt.as_mut().unwrap().completed = true;
        }
        if state.lease_held {
            return Err(ImapConnectionError::Changed);
        }
        Ok(ImapConnectionLease {
            attempt: attempt.clone(),
            nonce: Uuid::from_u128(99),
            age: state.recovery_age.unwrap_or(chrono::Duration::zero()),
        })
    }
    async fn claim_pending(&self) -> Result<Option<ImapConnectionLease>, ImapConnectionError> {
        let mut state = self.0.lock().unwrap();
        let attempt = if !state.pending.is_empty() {
            Some(state.pending.remove(0))
        } else if state.deferred.is_empty() {
            state.attempt.clone().filter(|attempt| !attempt.completed)
        } else {
            None
        };
        Ok(attempt.map(|attempt| ImapConnectionLease {
            attempt,
            nonce: Uuid::from_u128(99),
            age: state.recovery_age.unwrap_or(chrono::Duration::minutes(2)),
        }))
    }
    async fn defer(
        &self,
        _: &ImapConnectionLease,
        delay: chrono::Duration,
    ) -> Result<(), ImapConnectionError> {
        self.0.lock().unwrap().deferred.push(delay);
        Ok(())
    }
    async fn abandon(&self, _: &ImapConnectionLease) -> Result<(), ImapConnectionError> {
        self.0.lock().unwrap().attempt = None;
        Ok(())
    }
    async fn owned_address_is_connected(
        &self,
        _: &MacroUserIdStr<'_>,
    ) -> Result<bool, ImapConnectionError> {
        Ok(false)
    }
}
fn request(email: &str) -> ImapConnectRequest {
    let login = Login {
        endpoint: Endpoint {
            host: "mail.example.com".into(),
            port: 993,
            tls: TlsMode::Implicit,
            username: "owner@example.com".into(),
        },
        password: Secret("secret".into()),
    };
    ImapConnectRequest {
        request_id: Uuid::from_u128(1),
        link_id: None,
        email: EmailStr::try_from(email.to_owned()).unwrap(),
        imap: login.clone(),
        smtp: login,
        confirmed_hosts: vec!["mail.example.com".into()],
    }
}
#[tokio::test]
async fn arbitrary_host_login_cannot_claim_someone_elses_address() {
    let fake = Fake::default();
    fake.0.lock().unwrap().enabled = true;
    let service = ImapConnectionService {
        repository: fake.clone(),
        gateway: fake.clone(),
        enrollment: fake.clone(),
    };
    let result = service
        .connect(
            MacroUserIdStr::try_from("macro|owner@example.com").unwrap(),
            "owner",
            request("victim@example.com"),
        )
        .await;
    assert!(matches!(
        result,
        Err(ImapConnectionError::AddressUnverified)
    ));
    assert_eq!(fake.0.lock().unwrap().verifies, 0);
}
#[tokio::test]
async fn disabled_rollout_does_not_attempt_credentials() {
    let fake = Fake::default();
    let service = ImapConnectionService {
        repository: fake.clone(),
        gateway: fake.clone(),
        enrollment: fake.clone(),
    };
    assert!(matches!(
        service
            .connect(
                MacroUserIdStr::try_from("macro|owner@example.com").unwrap(),
                "owner",
                request("owner@example.com")
            )
            .await,
        Err(ImapConnectionError::Disabled)
    ));
    assert_eq!(fake.0.lock().unwrap().verifies, 0);
}
#[tokio::test]
async fn interrupted_promotion_recovers_the_same_verified_binding_and_completed_retries_do_not_login()
 {
    let fake = Fake::default();
    {
        let mut state = fake.0.lock().unwrap();
        state.enabled = true;
        state.fail_next_promotion = true;
    }
    let service = ImapConnectionService {
        repository: fake.clone(),
        gateway: fake.clone(),
        enrollment: fake.clone(),
    };
    let actor = MacroUserIdStr::try_from("macro|owner@example.com").unwrap();
    assert!(matches!(
        service
            .connect(actor.clone(), "owner", request("owner@example.com"))
            .await,
        Err(ImapConnectionError::Provider(Error::ConnectionUnavailable))
    ));
    fake.0.lock().unwrap().deferred.clear();
    service.recover_once().await.unwrap();
    assert_eq!(
        service
            .connect(actor, "owner", request("owner@example.com"))
            .await
            .unwrap(),
        Uuid::from_u128(3)
    );
    let state = fake.0.lock().unwrap();
    assert_eq!(state.verifies, 1);
    assert_eq!(state.promotions, 2);
    assert_eq!(state.activations, 1);
}

#[tokio::test]
async fn live_discovery_does_not_disclose_unverified_addresses() {
    let fake = Fake::default();
    fake.0.lock().unwrap().enabled = true;
    let service = ImapConnectionService {
        repository: fake.clone(),
        gateway: fake.clone(),
        enrollment: fake.clone(),
    };
    let actor = MacroUserIdStr::try_from("macro|owner@example.com").unwrap();
    let submitted = EmailStr::parse_from_str("someone-else@example.com").unwrap();
    assert!(matches!(
        service.discover(&actor, &submitted.0).await,
        Err(ImapConnectionError::AddressUnverified)
    ));
    assert!(fake.0.lock().unwrap().discoveries.is_empty());
}

#[tokio::test]
async fn authorized_discovery_preserves_the_submitted_validated_spelling() {
    let fake = Fake::default();
    fake.0.lock().unwrap().enabled = true;
    let service = ImapConnectionService {
        repository: fake.clone(),
        gateway: fake.clone(),
        enrollment: fake.clone(),
    };
    let actor = MacroUserIdStr::try_from("macro|owner+tag@example.com").unwrap();
    let submitted = EmailStr::parse_from_str("Owner+Tag@Example.com").unwrap();
    assert_eq!(actor.email_str(), "owner+tag@example.com");
    service.discover(&actor, &submitted.0).await.unwrap();
    assert_eq!(
        fake.0.lock().unwrap().discoveries,
        ["Owner+Tag@Example.com"]
    );
}

#[tokio::test]
async fn private_relay_policy_remains_enforced_with_validated_domain_parts() {
    let fake = Fake::default();
    fake.0.lock().unwrap().enabled = true;
    let service = ImapConnectionService {
        repository: fake.clone(),
        gateway: fake.clone(),
        enrollment: fake.clone(),
    };
    let domain = "PRIVATERELAY.APPLEID.COM";
    let address = format!("owner@{domain}");
    let actor = MacroUserIdStr::try_from(format!("macro|{address}")).unwrap();
    assert!(matches!(
        service.suggestion(&actor).await.unwrap(),
        ImapConnectionOffer::None
    ));
    let submitted = EmailStr(actor.email_part());
    assert!(matches!(
        service.discover(&actor, &submitted.0).await,
        Err(ImapConnectionError::AddressUnverified)
    ));
    assert!(matches!(
        service
            .connect(actor.into_owned(), "owner", request(&address))
            .await,
        Err(ImapConnectionError::AddressUnverified)
    ));
    let state = fake.0.lock().unwrap();
    assert!(state.discoveries.is_empty());
    assert_eq!(state.verifies, 0);
}

#[tokio::test]
async fn passive_suggestions_use_mx_hints_without_address_bearing_discovery() {
    for (mx, dns_error, expected) in [
        (Some("aspmx.l.google.com"), false, "gmail"),
        (Some("tenant.mail.protection.outlook.com"), false, "outlook"),
        (Some("in1-smtp.messagingengine.com"), false, "imap"),
        (Some("mx.unknown.example.com"), false, "none"),
        (None, true, "none"),
    ] {
        let fake = Fake::default();
        {
            let mut state = fake.0.lock().unwrap();
            state.enabled = true;
            state.hint_mx = mx.map(str::to_owned);
            state.hint_error = dns_error;
        }
        let service = ImapConnectionService {
            repository: fake.clone(),
            gateway: fake.clone(),
            enrollment: fake.clone(),
        };
        let actor = MacroUserIdStr::try_from("macro|owner@custom.example.com").unwrap();
        let offer = service.suggestion(&actor).await.unwrap();
        assert_eq!(serde_json::to_value(offer).unwrap(), expected);
        let state = fake.0.lock().unwrap();
        assert_eq!(state.hints, 1);
        assert!(state.discoveries.is_empty());
        assert_eq!(state.verifies, 0);
    }
}

#[tokio::test]
async fn recovery_yields_after_bounded_work_even_when_old_attempts_keep_failing() {
    let fake = Fake::default();
    let input = request("owner@example.com");
    let actor = MacroUserIdStr::try_from("macro|owner@example.com").unwrap();
    let verification = Verification {
        id: Uuid::from_u128(2),
        expires_at: chrono::Utc::now() + chrono::Duration::minutes(15),
    };
    let attempt = fake
        .reserve(&actor, "owner", &input, &verification)
        .await
        .unwrap();
    {
        let mut state = fake.0.lock().unwrap();
        state.promotion_error = Some(Error::ConnectionUnavailable);
        state.pending = (1..=100)
            .map(|id| ImapConnectionAttempt {
                id: Uuid::from_u128(id),
                ..attempt.clone()
            })
            .collect();
    }
    let service = ImapConnectionService {
        repository: fake.clone(),
        gateway: fake.clone(),
        enrollment: fake.clone(),
    };
    service.recover_once().await.unwrap();
    assert_eq!(fake.0.lock().unwrap().promotions, 32);
}

#[tokio::test]
async fn proven_invalid_promotion_is_abandoned_instead_of_poisoning_recovery() {
    let fake = Fake::default();
    let input = request("owner@example.com");
    let actor = MacroUserIdStr::try_from("macro|owner@example.com").unwrap();
    let verification = Verification {
        id: Uuid::from_u128(2),
        expires_at: chrono::Utc::now() + chrono::Duration::minutes(15),
    };
    fake.reserve(&actor, "owner", &input, &verification)
        .await
        .unwrap();
    fake.0.lock().unwrap().promotion_error = Some(Error::Invalid);
    let service = ImapConnectionService {
        repository: fake.clone(),
        gateway: fake.clone(),
        enrollment: fake.clone(),
    };
    service.recover_once().await.unwrap();
    assert!(fake.0.lock().unwrap().attempt.is_none());
}

#[tokio::test]
async fn unproven_auth_failure_defers_with_age_then_expires_at_the_cap() {
    for (age, delay) in [(2, 1), (40, 10), (180, 30), (1_440, 0)] {
        let fake = Fake::default();
        let actor = MacroUserIdStr::try_from("macro|owner@example.com").unwrap();
        let verification = Verification {
            id: Uuid::from_u128(2),
            expires_at: chrono::Utc::now() - chrono::Duration::minutes(1),
        };
        fake.reserve(
            &actor,
            "owner",
            &request("owner@example.com"),
            &verification,
        )
        .await
        .unwrap();
        {
            let mut state = fake.0.lock().unwrap();
            state.recovery_age = Some(chrono::Duration::minutes(age));
            // HTTP auth rejection is normalized by the client before the gateway.
            // The token may already have been consumed; expiry alone proves nothing.
            state.promotion_error = Some(Error::ConnectionUnavailable);
        }
        let service = ImapConnectionService {
            repository: fake.clone(),
            gateway: fake.clone(),
            enrollment: fake.clone(),
        };
        service.recover_once().await.unwrap();
        let state = fake.0.lock().unwrap();
        if delay == 0 {
            assert!(state.attempt.is_none());
            assert_eq!(state.promotions, 0);
        } else {
            assert!(state.attempt.is_some());
            assert_eq!(state.deferred, [chrono::Duration::minutes(delay)]);
            assert_eq!(state.promotions, 1);
        }
    }
}

#[tokio::test]
async fn one_hundred_deferred_attempts_do_not_hide_a_healthy_promotion() {
    let fake = Fake::default();
    let actor = MacroUserIdStr::try_from("macro|owner@example.com").unwrap();
    let verification = Verification {
        id: Uuid::from_u128(2),
        expires_at: chrono::Utc::now() + chrono::Duration::minutes(15),
    };
    let attempt = fake
        .reserve(
            &actor,
            "owner",
            &request("owner@example.com"),
            &verification,
        )
        .await
        .unwrap();
    {
        let mut state = fake.0.lock().unwrap();
        state.promotion_error = Some(Error::ConnectionUnavailable);
        state.successful_link = Some(Uuid::from_u128(101));
        state.pending = (1..=101)
            .map(|id| ImapConnectionAttempt {
                id: Uuid::from_u128(id),
                binding: Binding {
                    link_id: Uuid::from_u128(id),
                    ..attempt.binding
                },
                ..attempt.clone()
            })
            .collect();
    }
    let service = ImapConnectionService {
        repository: fake.clone(),
        gateway: fake.clone(),
        enrollment: fake.clone(),
    };
    for _ in 0..3 {
        assert_eq!(
            service.recover_once().await.unwrap(),
            ConnectionRecoveryTick::Progress
        );
    }
    assert_eq!(
        service.recover_once().await.unwrap(),
        ConnectionRecoveryTick::Idle
    );
    let state = fake.0.lock().unwrap();
    assert_eq!(state.promotions, 101);
    assert_eq!(state.deferred.len(), 100);
    assert_eq!(state.activations, 1);
}

#[tokio::test]
async fn lease_contention_is_retryable_and_a_concurrent_completion_returns_its_receipt() {
    let mut outcomes = Vec::new();
    for completed in [true, false] {
        let fake = Fake::default();
        let actor = MacroUserIdStr::try_from("macro|owner@example.com").unwrap();
        let verification = Verification {
            id: Uuid::from_u128(2),
            expires_at: chrono::Utc::now() + chrono::Duration::minutes(15),
        };
        let attempt = fake
            .reserve(
                &actor,
                "owner",
                &request("owner@example.com"),
                &verification,
            )
            .await
            .unwrap();
        {
            let mut state = fake.0.lock().unwrap();
            state.enabled = true;
            state.lease_held = true;
            // The repository read returns an incomplete receipt; completion
            // races its later conditional lease UPDATE, with no wall-clock wait.
            state.complete_during_lease = completed;
        }
        let service = ImapConnectionService {
            repository: fake.clone(),
            gateway: fake.clone(),
            enrollment: fake.clone(),
        };
        let result = service
            .connect(actor, "owner", request("owner@example.com"))
            .await;
        outcomes.push((
            matches!(&result, Ok(id) if *id == attempt.binding.link_id),
            matches!(
                &result,
                Err(ImapConnectionError::Provider(Error::AccountBusy))
            ),
        ));
        let state = fake.0.lock().unwrap();
        assert_eq!(state.verifies, 0);
        assert_eq!(state.promotions, 0);
        assert!(state.attempt.is_some());
    }
    assert_eq!(outcomes, [(true, false), (false, true)]);
}
