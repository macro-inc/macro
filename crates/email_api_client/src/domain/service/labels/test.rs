use std::sync::{Arc, Mutex};

use models_email::email::service::label::Label;
use uuid::Uuid;

use super::super::test_support::{Call, FakeRateLimiter, FakeTokenSource, call_log};
use super::*;
use crate::domain::models::{AccessToken, TokenFreshness};

#[derive(Clone, Default)]
struct LabelClient {
    arguments: Arc<Mutex<Option<(String, Uuid)>>>,
    created_label_name: Arc<Mutex<Option<String>>>,
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
        label_name: &str,
    ) -> Result<Label, EmailApiError> {
        *self.created_label_name.lock().unwrap() = Some(label_name.to_string());
        Err(expected_error())
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

#[tokio::test]
async fn list_labels_uses_list_labels_quota_and_forwards_link_id() {
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
        service.list_labels(link_id).await,
        Err(error) if error == expected_error()
    ));
    assert_eq!(*arguments.lock().unwrap(), Some(("token".into(), link_id)));
    assert_eq!(
        *calls.lock().unwrap(),
        vec![
            Call::RateLimit(link_id, ApiOperationKind::ListLabels),
            Call::Token(link_id, TokenFreshness::Cached),
        ]
    );
}

#[tokio::test]
async fn create_label_uses_create_quota_and_forwards_name() {
    let calls = call_log();
    let repository = LabelClient::default();
    let created_label_name = repository.created_label_name.clone();
    let link_id = Uuid::new_v4();
    let service = EmailApiClientServiceImpl::new(
        repository,
        FakeTokenSource::new(calls.clone(), Ok(AccessToken::new("token"))),
        FakeRateLimiter::new(calls.clone(), Ok(())),
    );

    assert!(matches!(
        service.create_label(link_id, "Projects").await,
        Err(error) if error == expected_error()
    ));
    assert_eq!(*created_label_name.lock().unwrap(), Some("Projects".into()));
    assert_eq!(
        *calls.lock().unwrap(),
        vec![
            Call::RateLimit(link_id, ApiOperationKind::CreateLabel),
            Call::Token(link_id, TokenFreshness::Cached),
        ]
    );
}

#[tokio::test]
async fn delete_label_uses_delete_quota_and_forwards_provider_id() {
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
        service.delete_label(link_id, "label").await,
        Err(expected_error())
    );
    assert_eq!(*deleted_label_id.lock().unwrap(), Some("label".into()));
    assert_eq!(
        *calls.lock().unwrap(),
        vec![
            Call::RateLimit(link_id, ApiOperationKind::DeleteLabel),
            Call::Token(link_id, TokenFreshness::Cached),
        ]
    );
}
