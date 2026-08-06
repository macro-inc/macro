use std::sync::{Arc, Mutex};

use models_email::email::service::label::Label;
use uuid::Uuid;

use super::super::test_support::{Call, FakeRateLimiter, FakeTokenSource, block_on, call_log};
use super::*;
use crate::domain::models::{AccessToken, TokenFreshness};

#[derive(Clone, Default)]
struct LabelClient {
    arguments: Arc<Mutex<Option<(String, Uuid)>>>,
    deleted_label_id: Arc<Mutex<Option<String>>>,
}

impl MailboxLabelClient for LabelClient {
    async fn list_labels(
        &self,
        access_token: &AccessToken,
        link_id: Uuid,
    ) -> Result<Vec<Label>, EmailApiError> {
        *self.arguments.lock().unwrap() = Some((access_token.expose_secret().to_string(), link_id));
        Err(expected_error())
    }

    async fn create_label(
        &self,
        _: &AccessToken,
        _: Uuid,
        _: &str,
    ) -> Result<Label, EmailApiError> {
        unreachable!()
    }

    async fn delete_label(
        &self,
        _: &AccessToken,
        provider_label_id: &str,
    ) -> Result<(), EmailApiError> {
        *self.deleted_label_id.lock().unwrap() = Some(provider_label_id.to_string());
        Err(expected_error())
    }
}

fn expected_error() -> EmailApiError {
    EmailApiError::Permanent {
        message: "provider error".to_string(),
    }
}

#[test]
fn list_labels_uses_list_labels_quota_and_forwards_link_id() {
    let calls = call_log();
    let repository = LabelClient::default();
    let arguments = repository.arguments.clone();
    let link_id = Uuid::new_v4();
    let service = EmailApiClientServiceImpl::new(
        repository,
        FakeTokenSource::new(calls.clone(), Ok(AccessToken::new("token"))),
        FakeRateLimiter::new(calls.clone(), Ok(())),
    );

    assert!(matches!(
        block_on(service.list_labels(link_id)),
        Err(error) if error == expected_error()
    ));
    assert_eq!(*arguments.lock().unwrap(), Some(("token".into(), link_id)));
    assert_eq!(
        *calls.lock().unwrap(),
        vec![
            Call::Token(link_id, TokenFreshness::Cached),
            Call::RateLimit(link_id, ApiOperationKind::ListLabels),
        ]
    );
}

#[test]
fn delete_label_uses_delete_quota_and_forwards_provider_id() {
    let calls = call_log();
    let repository = LabelClient::default();
    let deleted_label_id = repository.deleted_label_id.clone();
    let link_id = Uuid::new_v4();
    let service = EmailApiClientServiceImpl::new(
        repository,
        FakeTokenSource::new(calls.clone(), Ok(AccessToken::new("token"))),
        FakeRateLimiter::new(calls.clone(), Ok(())),
    );

    assert_eq!(
        block_on(service.delete_label(link_id, "label")),
        Err(expected_error())
    );
    assert_eq!(*deleted_label_id.lock().unwrap(), Some("label".into()));
    assert_eq!(
        *calls.lock().unwrap(),
        vec![
            Call::Token(link_id, TokenFreshness::Cached),
            Call::RateLimit(link_id, ApiOperationKind::DeleteLabel),
        ]
    );
}
