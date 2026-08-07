use std::sync::{Arc, Mutex};

use models_email::service::contact::{Contact, ContactList};
use uuid::Uuid;

use super::super::test_support::{Call, FakeRateLimiter, FakeTokenSource, call_log};
use super::*;
use crate::domain::models::{AccessToken, TokenFreshness};

#[derive(Debug, Clone, PartialEq, Eq)]
enum ContactCall {
    SelfContact(Uuid),
    Contacts(Uuid, Option<String>),
    OtherContacts(Uuid, Option<String>),
}

#[derive(Clone, Default)]
struct ContactsClient {
    call: Arc<Mutex<Option<ContactCall>>>,
}

impl MailboxContactsClient for ContactsClient {
    async fn get_self_contact(
        &self,
        access_token: &AccessToken,
        link_id: Uuid,
    ) -> Result<Contact, EmailApiError> {
        assert_eq!(access_token.expose_secret(), "token");
        *self.call.lock().unwrap() = Some(ContactCall::SelfContact(link_id));
        Err(expected_error())
    }

    async fn list_contacts(
        &self,
        access_token: &AccessToken,
        link_id: Uuid,
        sync_token: Option<&str>,
    ) -> Result<ContactList, EmailApiError> {
        assert_eq!(access_token.expose_secret(), "token");
        *self.call.lock().unwrap() = Some(ContactCall::Contacts(
            link_id,
            sync_token.map(str::to_string),
        ));
        Err(expected_error())
    }

    async fn list_other_contacts(
        &self,
        access_token: &AccessToken,
        link_id: Uuid,
        sync_token: Option<&str>,
    ) -> Result<ContactList, EmailApiError> {
        assert_eq!(access_token.expose_secret(), "token");
        *self.call.lock().unwrap() = Some(ContactCall::OtherContacts(
            link_id,
            sync_token.map(str::to_string),
        ));
        Err(expected_error())
    }
}

fn expected_error() -> EmailApiError {
    EmailApiError::Permanent {
        message: "provider error".to_string(),
    }
}

async fn assert_call<F, E>(operation: ApiOperationKind, expected_repository_call: E, invoke: F)
where
    E: FnOnce(Uuid) -> ContactCall,
    F: AsyncFnOnce(
        &EmailApiClientServiceImpl<ContactsClient, FakeTokenSource, FakeRateLimiter>,
        Uuid,
    ) -> Result<(), EmailApiError>,
{
    let calls = call_log();
    let repository = ContactsClient::default();
    let repository_call = repository.call.clone();
    let link_id = Uuid::new_v4();
    let service = EmailApiClientServiceImpl::new(
        repository,
        FakeTokenSource::new(calls.clone(), Ok(AccessToken::new("token"))),
        FakeRateLimiter::new(calls.clone(), Ok(())),
    );

    assert_eq!(invoke(&service, link_id).await, Err(expected_error()));
    assert_eq!(
        *repository_call.lock().unwrap(),
        Some(expected_repository_call(link_id))
    );
    assert_eq!(
        *calls.lock().unwrap(),
        vec![
            Call::RateLimit(link_id, operation),
            Call::Token(link_id, TokenFreshness::Cached),
        ]
    );
}

#[tokio::test]
async fn contact_reads_use_correct_operation_kinds_and_forward_sync_tokens() {
    assert_call(
        ApiOperationKind::ListContacts,
        ContactCall::SelfContact,
        async |service, link_id| service.get_self_contact(link_id).await.map(|_| ()),
    )
    .await;

    assert_call(
        ApiOperationKind::ListContacts,
        |link_id| ContactCall::Contacts(link_id, Some("primary-token".into())),
        async |service, link_id| {
            service
                .list_contacts(link_id, Some("primary-token"))
                .await
                .map(|_| ())
        },
    )
    .await;

    assert_call(
        ApiOperationKind::ListContacts,
        |link_id| ContactCall::OtherContacts(link_id, Some("other-token".into())),
        async |service, link_id| {
            service
                .list_other_contacts(link_id, Some("other-token"))
                .await
                .map(|_| ())
        },
    )
    .await;
}
