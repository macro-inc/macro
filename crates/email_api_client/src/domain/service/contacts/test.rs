use std::sync::{Arc, Mutex};

use std::collections::VecDeque;

use models_email::service::contact::Contact;
use uuid::Uuid;

use super::super::test_support::{Call, FakeGate, FakeTokenSource, call_log};
use super::*;
use crate::domain::models::{AccessToken, ContactPage, TokenFreshness};

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

    async fn list_contacts_page(
        &self,
        access_token: &AccessToken,
        link_id: Uuid,
        sync_token: Option<&str>,
        _: Option<&str>,
    ) -> Result<ContactPage, EmailApiError> {
        assert_eq!(access_token.expose_secret(), "token");
        *self.call.lock().unwrap() = Some(ContactCall::Contacts(
            link_id,
            sync_token.map(str::to_string),
        ));
        Err(expected_error())
    }

    async fn list_other_contacts_page(
        &self,
        access_token: &AccessToken,
        link_id: Uuid,
        sync_token: Option<&str>,
        _: Option<&str>,
    ) -> Result<ContactPage, EmailApiError> {
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
        &EmailApiClientServiceImpl<ContactsClient, FakeTokenSource, FakeGate>,
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
        FakeGate::new(calls.clone(), Ok(())),
    );

    assert_eq!(invoke(&service, link_id).await, Err(expected_error()));
    assert_eq!(
        *repository_call.lock().unwrap(),
        Some(expected_repository_call(link_id))
    );
    assert_eq!(
        *calls.lock().unwrap(),
        vec![
            Call::Acquire(link_id, operation),
            Call::Token(link_id, TokenFreshness::Cached),
            Call::Finish(link_id, Some(expected_error())),
        ]
    );
}

/// Answers a cached token the way Google answers a revoked or expired one.
struct RejectsCachedToken;

impl MailboxContactsClient for RejectsCachedToken {
    async fn get_self_contact(&self, _: &AccessToken, _: Uuid) -> Result<Contact, EmailApiError> {
        unreachable!("not used by this test")
    }

    async fn list_contacts_page(
        &self,
        access_token: &AccessToken,
        _: Uuid,
        _: Option<&str>,
        _: Option<&str>,
    ) -> Result<ContactPage, EmailApiError> {
        match access_token.expose_secret() {
            "cached" => Err(EmailApiError::AuthRequired),
            _ => Err(expected_error()),
        }
    }

    async fn list_other_contacts_page(
        &self,
        _: &AccessToken,
        _: Uuid,
        _: Option<&str>,
        _: Option<&str>,
    ) -> Result<ContactPage, EmailApiError> {
        unreachable!("not used by this test")
    }
}

#[tokio::test]
async fn a_rejected_cached_token_is_retried_fresh_for_contact_sync() {
    let calls = call_log();
    let link_id = Uuid::new_v4();
    let service = EmailApiClientServiceImpl::new(
        RejectsCachedToken,
        FakeTokenSource::new(calls.clone(), Ok(AccessToken::new("cached")))
            .with_fresh(Ok(AccessToken::new("fresh"))),
        FakeGate::new(calls.clone(), Ok(())),
    );

    let result = service.list_contacts(link_id, None).await;

    assert_eq!(result.err(), Some(expected_error()));
    assert_eq!(
        *calls.lock().unwrap(),
        vec![
            Call::Acquire(link_id, ApiOperationKind::ListContacts),
            Call::Token(link_id, TokenFreshness::Cached),
            Call::Finish(link_id, Some(EmailApiError::AuthRequired)),
            Call::Acquire(link_id, ApiOperationKind::ListContacts),
            Call::Token(link_id, TokenFreshness::Fresh),
            Call::Finish(link_id, Some(expected_error())),
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

/// Serves configured pages of other contacts and records the tokens it was given.
#[derive(Default)]
struct PagedContacts {
    pages: Mutex<VecDeque<ContactPage>>,
    requests: Mutex<Vec<(Option<String>, Option<String>)>>,
}

impl MailboxContactsClient for PagedContacts {
    async fn get_self_contact(&self, _: &AccessToken, _: Uuid) -> Result<Contact, EmailApiError> {
        unreachable!("not used by this test")
    }

    async fn list_contacts_page(
        &self,
        _: &AccessToken,
        _: Uuid,
        _: Option<&str>,
        _: Option<&str>,
    ) -> Result<ContactPage, EmailApiError> {
        unreachable!("not used by this test")
    }

    async fn list_other_contacts_page(
        &self,
        _: &AccessToken,
        _: Uuid,
        sync_token: Option<&str>,
        page_token: Option<&str>,
    ) -> Result<ContactPage, EmailApiError> {
        self.requests.lock().unwrap().push((
            sync_token.map(str::to_string),
            page_token.map(str::to_string),
        ));
        Ok(self
            .pages
            .lock()
            .unwrap()
            .pop_front()
            .expect("the test configures every page the service reads"))
    }
}

fn contact(link_id: Uuid, email: &str) -> Contact {
    Contact {
        id: Uuid::nil(),
        link_id,
        name: None,
        email_address: Some(email.to_string()),
        original_photo_url: None,
        sfs_photo_url: None,
    }
}

#[tokio::test]
async fn each_contacts_page_is_admitted_on_its_own_and_the_pages_are_combined() {
    let calls = call_log();
    let link_id = Uuid::new_v4();
    let repository = PagedContacts {
        pages: Mutex::new(VecDeque::from([
            ContactPage {
                contacts: vec![contact(link_id, "first@example.com")],
                next_sync_token: None,
                next_page_token: Some("page-2".into()),
            },
            ContactPage {
                contacts: vec![contact(link_id, "second@example.com")],
                next_sync_token: Some("new-sync".into()),
                next_page_token: None,
            },
        ])),
        ..PagedContacts::default()
    };
    let service = EmailApiClientServiceImpl::new(
        repository,
        FakeTokenSource::new(calls.clone(), Ok(AccessToken::new("token"))),
        FakeGate::new(calls.clone(), Ok(())),
    );

    let list = service
        .list_other_contacts(link_id, Some("old-sync"))
        .await
        .unwrap();

    assert_eq!(
        list.contacts
            .iter()
            .map(|contact| contact.email_address.as_deref())
            .collect::<Vec<_>>(),
        vec![Some("first@example.com"), Some("second@example.com")]
    );
    assert_eq!(list.next_sync_token, "new-sync");
    assert_eq!(
        *service.repository.requests.lock().unwrap(),
        vec![
            (Some("old-sync".into()), None),
            (Some("old-sync".into()), Some("page-2".into())),
        ]
    );
    let page = [
        Call::Acquire(link_id, ApiOperationKind::ListContacts),
        Call::Token(link_id, TokenFreshness::Cached),
        Call::Finish(link_id, None),
    ];
    assert_eq!(*calls.lock().unwrap(), [page.clone(), page].concat());
}

#[tokio::test]
async fn contacts_without_a_sync_token_on_the_last_page_fail() {
    let calls = call_log();
    let link_id = Uuid::new_v4();
    let service = EmailApiClientServiceImpl::new(
        PagedContacts {
            pages: Mutex::new(VecDeque::from([ContactPage {
                contacts: vec![],
                next_sync_token: None,
                next_page_token: None,
            }])),
            ..PagedContacts::default()
        },
        FakeTokenSource::new(calls.clone(), Ok(AccessToken::new("token"))),
        FakeGate::new(calls.clone(), Ok(())),
    );

    assert!(matches!(
        service.list_other_contacts(link_id, None).await,
        Err(EmailApiError::Permanent { .. })
    ));
}
