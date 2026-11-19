use super::*;
use imap_engine::domain::models::{Endpoint, Error, Secret, TlsMode};
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
struct Fake(Arc<Mutex<State>>);
#[derive(Default)]
struct State {
    enabled: bool,
    attempt: Option<ImapConnectionAttempt>,
    verifies: u32,
    promotions: u32,
    activations: u32,
    fail_next_promotion: bool,
}
impl ImapConnectionEnrollment for Fake {
    async fn enabled(&self, _: &MacroUserIdStr<'_>) -> bool {
        self.0.lock().unwrap().enabled
    }
}
impl ImapConnectionGateway for Fake {
    async fn discover(&self, _: &str) -> Result<Discovery, ImapConnectionError> {
        unreachable!()
    }
    async fn verify(&self, request: &VerifyRequest) -> Result<Verification, ImapConnectionError> {
        assert_eq!(request.user_id, "macro|owner@example.com");
        assert_eq!(request.email, "owner@example.com");
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
    async fn activate(&self, attempt: &ImapConnectionAttempt) -> Result<Uuid, ImapConnectionError> {
        let mut state = self.0.lock().unwrap();
        state.activations += 1;
        state.attempt.as_mut().unwrap().completed = true;
        Ok(attempt.binding.link_id)
    }
    async fn pending(&self) -> Result<Vec<ImapConnectionAttempt>, ImapConnectionError> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .attempt
            .iter()
            .filter(|attempt| !attempt.completed)
            .cloned()
            .collect())
    }
    async fn abandon(&self, _: &ImapConnectionAttempt) -> Result<(), ImapConnectionError> {
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
        email: email.into(),
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
        enrollment: fake,
    };
    let actor = MacroUserIdStr::try_from("macro|owner@example.com").unwrap();
    // The fake gateway's discover method panics if the boundary is bypassed.
    assert!(matches!(
        service.discover(&actor, "someone-else@example.com").await,
        Err(ImapConnectionError::AddressUnverified)
    ));
}
