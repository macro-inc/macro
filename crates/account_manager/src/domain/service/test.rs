use std::sync::{Arc, Mutex};

use chrono::{DateTime, Duration, Utc};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use uuid::Uuid;

use super::*;
use crate::domain::ports::OpenedRequest;

fn user(id: &'static str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap()
}

#[derive(Debug, thiserror::Error)]
#[error("fake repository error")]
struct FakeError;

/// Keeps grants in memory with the same state rules as the SQL.
#[derive(Clone, Default)]
struct FakeRepo {
    grants: Arc<Mutex<Vec<AccountManagerGrant>>>,
}

impl FakeRepo {
    fn expire(&self, id: Uuid) {
        let mut grants = self.grants.lock().unwrap();
        let grant = grants.iter_mut().find(|grant| grant.id == id).unwrap();
        grant.expires_at = Some(Utc::now() - Duration::minutes(1));
    }
}

impl AccountManagerRepo for FakeRepo {
    type Err = FakeError;

    async fn is_agent(&self, user: &MacroUserIdStr<'_>) -> Result<Option<bool>, FakeError> {
        Ok(match user.as_ref() {
            "macro|agent@example.com" | "macro|agent2@example.com" => Some(true),
            "macro|person@example.com" | "macro|person2@example.com" => Some(false),
            _ => None,
        })
    }

    async fn open_request(
        &self,
        id: Uuid,
        managed: &MacroUserIdStr<'_>,
        manager: &MacroUserIdStr<'_>,
        requested_by: AccountManagerRole,
        expires_at: DateTime<Utc>,
    ) -> Result<OpenedRequest, FakeError> {
        let mut grants = self.grants.lock().unwrap();
        let pending = grants.iter().find(|grant| {
            grant.status == AccountManagerGrantStatus::Pending
                && grant.managed_user_id.as_ref() == managed.as_ref()
                && grant.manager_user_id.as_ref() == manager.as_ref()
        });
        if let Some(grant) = pending {
            return Ok(OpenedRequest {
                grant: grant.clone(),
                created: false,
            });
        }

        let grant = AccountManagerGrant {
            id,
            managed_user_id: MacroUserIdStr::parse_from_str(managed.as_ref())
                .unwrap()
                .into_owned(),
            manager_user_id: MacroUserIdStr::parse_from_str(manager.as_ref())
                .unwrap()
                .into_owned(),
            requested_by,
            status: AccountManagerGrantStatus::Pending,
            expires_at: Some(expires_at),
            created_at: Utc::now(),
            claimed_at: None,
            last_used_at: None,
        };
        grants.push(grant.clone());
        Ok(OpenedRequest {
            grant,
            created: true,
        })
    }

    async fn get(&self, id: Uuid) -> Result<Option<AccountManagerGrant>, FakeError> {
        let grants = self.grants.lock().unwrap();
        Ok(grants.iter().find(|grant| grant.id == id).cloned())
    }

    async fn list_for_managed(
        &self,
        managed: &MacroUserIdStr<'_>,
    ) -> Result<Vec<AccountManagerGrant>, FakeError> {
        let grants = self.grants.lock().unwrap();
        Ok(grants
            .iter()
            .filter(|grant| grant.managed_user_id.as_ref() == managed.as_ref())
            .filter(|grant| {
                matches!(
                    grant.status,
                    AccountManagerGrantStatus::Approved | AccountManagerGrantStatus::Active
                )
            })
            .cloned()
            .collect())
    }

    async fn respond(
        &self,
        id: Uuid,
        decision: AccountManagerDecision,
        claim_expires_at: DateTime<Utc>,
        now: DateTime<Utc>,
    ) -> Result<Option<AccountManagerGrant>, FakeError> {
        let mut grants = self.grants.lock().unwrap();
        let Some(grant) = grants.iter_mut().find(|grant| {
            grant.id == id
                && grant.status == AccountManagerGrantStatus::Pending
                && grant.expires_at.is_some_and(|expires_at| expires_at > now)
        }) else {
            return Ok(None);
        };
        match decision {
            AccountManagerDecision::Approve => {
                grant.status = AccountManagerGrantStatus::Approved;
                grant.expires_at = Some(claim_expires_at);
            }
            AccountManagerDecision::Decline => {
                grant.status = AccountManagerGrantStatus::Declined;
                grant.expires_at = None;
            }
        }
        Ok(Some(grant.clone()))
    }

    async fn claim(
        &self,
        id: Uuid,
        _key_hash: &[u8; 32],
        now: DateTime<Utc>,
    ) -> Result<Option<AccountManagerGrant>, FakeError> {
        let mut grants = self.grants.lock().unwrap();
        let Some(grant) = grants.iter_mut().find(|grant| {
            grant.id == id
                && grant.status == AccountManagerGrantStatus::Approved
                && grant.expires_at.is_some_and(|expires_at| expires_at > now)
        }) else {
            return Ok(None);
        };
        grant.status = AccountManagerGrantStatus::Active;
        grant.expires_at = None;
        grant.claimed_at = Some(now);
        Ok(Some(grant.clone()))
    }

    async fn revoke(&self, id: Uuid) -> Result<Option<AccountManagerGrant>, FakeError> {
        let mut grants = self.grants.lock().unwrap();
        let Some(grant) = grants.iter_mut().find(|grant| {
            grant.id == id
                && matches!(
                    grant.status,
                    AccountManagerGrantStatus::Pending
                        | AccountManagerGrantStatus::Approved
                        | AccountManagerGrantStatus::Active
                )
        }) else {
            return Ok(None);
        };
        grant.status = AccountManagerGrantStatus::Revoked;
        grant.expires_at = None;
        Ok(Some(grant.clone()))
    }
}

#[derive(Clone, Default)]
struct FakeDelivery {
    fail: Arc<Mutex<bool>>,
    posts: Arc<Mutex<Vec<(String, String, &'static str)>>>,
}

impl FakeDelivery {
    fn record(
        &self,
        sender: &MacroUserIdStr<'_>,
        recipient: &MacroUserIdStr<'_>,
        kind: &'static str,
    ) -> Result<(), rootcause::Report> {
        if *self.fail.lock().unwrap() {
            return Err(rootcause::report!("delivery failed"));
        }
        self.posts.lock().unwrap().push((
            sender.as_ref().to_string(),
            recipient.as_ref().to_string(),
            kind,
        ));
        Ok(())
    }
}

impl AccountManagerDelivery for FakeDelivery {
    async fn deliver_request(
        &self,
        sender: &MacroUserIdStr<'static>,
        recipient: &MacroUserIdStr<'static>,
        _grant_id: Uuid,
    ) -> Result<(), rootcause::Report> {
        self.record(sender, recipient, "request")
    }

    async fn deliver_approval(
        &self,
        sender: &MacroUserIdStr<'static>,
        recipient: &MacroUserIdStr<'static>,
        _grant_id: Uuid,
    ) -> Result<(), rootcause::Report> {
        self.record(sender, recipient, "approval")
    }
}

fn service() -> (
    AccountManagerServiceImpl<FakeRepo, FakeDelivery>,
    FakeRepo,
    FakeDelivery,
) {
    let repo = FakeRepo::default();
    let delivery = FakeDelivery::default();
    (
        AccountManagerServiceImpl::new(repo.clone(), delivery.clone()),
        repo,
        delivery,
    )
}

const AGENT: &str = "macro|agent@example.com";
const AGENT_2: &str = "macro|agent2@example.com";
const PERSON: &str = "macro|person@example.com";
const PERSON_2: &str = "macro|person2@example.com";

#[tokio::test]
async fn an_agent_can_ask_to_manage_a_person() {
    let (service, _, delivery) = service();

    let grant = service
        .request(&user(AGENT), &user(PERSON), AccountManagerRole::Manager)
        .await
        .unwrap();

    assert_eq!(grant.manager_user_id.as_ref(), AGENT);
    assert_eq!(grant.managed_user_id.as_ref(), PERSON);
    assert_eq!(grant.requested_by, AccountManagerRole::Manager);
    assert_eq!(
        delivery.posts.lock().unwrap().as_slice(),
        [(AGENT.to_string(), PERSON.to_string(), "request")]
    );
}

#[tokio::test]
async fn a_person_can_ask_an_agent_to_manage_them() {
    let (service, _, _) = service();

    let grant = service
        .request(&user(PERSON), &user(AGENT), AccountManagerRole::Managed)
        .await
        .unwrap();

    assert_eq!(grant.manager_user_id.as_ref(), AGENT);
    assert_eq!(grant.requested_by, AccountManagerRole::Managed);
}

#[tokio::test]
async fn an_agent_can_never_be_managed() {
    let (service, _, delivery) = service();

    let offered = service
        .request(&user(AGENT), &user(AGENT_2), AccountManagerRole::Manager)
        .await;
    let asked = service
        .request(&user(AGENT), &user(AGENT_2), AccountManagerRole::Managed)
        .await;

    assert!(matches!(offered, Err(AccountManagerError::BadRequest(_))));
    assert!(matches!(asked, Err(AccountManagerError::BadRequest(_))));
    assert!(delivery.posts.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_person_can_never_be_the_manager() {
    let (service, _, delivery) = service();

    let offered = service
        .request(&user(PERSON), &user(PERSON_2), AccountManagerRole::Manager)
        .await;
    let asked = service
        .request(&user(AGENT), &user(PERSON), AccountManagerRole::Managed)
        .await;

    assert!(matches!(offered, Err(AccountManagerError::BadRequest(_))));
    assert!(matches!(asked, Err(AccountManagerError::BadRequest(_))));
    assert!(delivery.posts.lock().unwrap().is_empty());
}

#[tokio::test]
async fn asking_again_returns_the_pending_request_without_reposting() {
    let (service, _, delivery) = service();

    let first = service
        .request(&user(AGENT), &user(PERSON), AccountManagerRole::Manager)
        .await
        .unwrap();
    let second = service
        .request(&user(AGENT), &user(PERSON), AccountManagerRole::Manager)
        .await
        .unwrap();

    assert_eq!(first.id, second.id);
    assert_eq!(delivery.posts.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn a_request_that_could_not_be_delivered_does_not_block_a_retry() {
    let (service, _, delivery) = service();
    *delivery.fail.lock().unwrap() = true;

    let failed = service
        .request(&user(AGENT), &user(PERSON), AccountManagerRole::Manager)
        .await;
    assert!(matches!(failed, Err(AccountManagerError::Internal(_))));

    *delivery.fail.lock().unwrap() = false;
    service
        .request(&user(AGENT), &user(PERSON), AccountManagerRole::Manager)
        .await
        .unwrap();

    assert_eq!(delivery.posts.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn only_the_side_that_did_not_ask_can_respond() {
    let (service, _, _) = service();
    let grant = service
        .request(&user(AGENT), &user(PERSON), AccountManagerRole::Manager)
        .await
        .unwrap();

    let by_requester = service
        .respond(&user(AGENT), grant.id, AccountManagerDecision::Approve)
        .await;
    let by_stranger = service
        .respond(&user(PERSON_2), grant.id, AccountManagerDecision::Approve)
        .await;

    assert!(matches!(
        by_requester,
        Err(AccountManagerError::Forbidden(_))
    ));
    assert!(matches!(by_stranger, Err(AccountManagerError::NotFound)));
}

#[tokio::test]
async fn an_expired_request_cannot_be_approved_and_reads_as_expired() {
    let (service, repo, _) = service();
    let grant = service
        .request(&user(AGENT), &user(PERSON), AccountManagerRole::Manager)
        .await
        .unwrap();
    repo.expire(grant.id);

    let response = service
        .respond(&user(PERSON), grant.id, AccountManagerDecision::Approve)
        .await;
    let read = service.get(&user(PERSON), grant.id).await.unwrap();

    assert!(matches!(response, Err(AccountManagerError::Conflict(_))));
    assert_eq!(read.status, AccountManagerGrantStatus::Expired);
}

#[tokio::test]
async fn approval_posts_the_link_to_the_manager_and_only_the_manager_can_claim_once() {
    let (service, _, delivery) = service();
    let grant = service
        .request(&user(AGENT), &user(PERSON), AccountManagerRole::Manager)
        .await
        .unwrap();
    service
        .respond(&user(PERSON), grant.id, AccountManagerDecision::Approve)
        .await
        .unwrap();

    assert_eq!(
        delivery.posts.lock().unwrap().last().unwrap(),
        &(PERSON.to_string(), AGENT.to_string(), "approval")
    );

    let by_managed = service.claim(&user(PERSON), grant.id).await;
    let by_stranger = service.claim(&user(AGENT_2), grant.id).await;
    let claimed = service.claim(&user(AGENT), grant.id).await.unwrap();
    let again = service.claim(&user(AGENT), grant.id).await;

    assert!(matches!(by_managed, Err(AccountManagerError::Forbidden(_))));
    assert!(matches!(by_stranger, Err(AccountManagerError::NotFound)));
    assert_eq!(claimed.grant.status, AccountManagerGrantStatus::Active);
    assert!(claimed.key.expose().starts_with("mak_"));
    assert!(matches!(again, Err(AccountManagerError::Conflict(_))));
}

#[tokio::test]
async fn a_declined_request_cannot_be_claimed() {
    let (service, _, _) = service();
    let grant = service
        .request(&user(PERSON), &user(AGENT), AccountManagerRole::Managed)
        .await
        .unwrap();
    service
        .respond(&user(AGENT), grant.id, AccountManagerDecision::Decline)
        .await
        .unwrap();

    let claim = service.claim(&user(AGENT), grant.id).await;

    assert!(matches!(claim, Err(AccountManagerError::Conflict(_))));
}

#[tokio::test]
async fn a_failed_approval_message_does_not_undo_the_approval() {
    let (service, _, delivery) = service();
    let grant = service
        .request(&user(AGENT), &user(PERSON), AccountManagerRole::Manager)
        .await
        .unwrap();
    *delivery.fail.lock().unwrap() = true;

    let approved = service
        .respond(&user(PERSON), grant.id, AccountManagerDecision::Approve)
        .await
        .unwrap();

    assert_eq!(approved.status, AccountManagerGrantStatus::Approved);
    service.claim(&user(AGENT), grant.id).await.unwrap();
}

#[tokio::test]
async fn either_side_can_revoke_but_a_stranger_cannot() {
    let (service, _, _) = service();
    let grant = service
        .request(&user(AGENT), &user(PERSON), AccountManagerRole::Manager)
        .await
        .unwrap();

    let by_stranger = service.revoke(&user(PERSON_2), grant.id).await;
    assert!(matches!(by_stranger, Err(AccountManagerError::NotFound)));

    let revoked = service.revoke(&user(PERSON), grant.id).await.unwrap();
    assert_eq!(revoked.status, AccountManagerGrantStatus::Revoked);

    let again = service.revoke(&user(AGENT), grant.id).await;
    assert!(matches!(again, Err(AccountManagerError::Conflict(_))));
}
